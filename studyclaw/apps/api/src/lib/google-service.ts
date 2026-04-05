import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { db } from './db';
import { updateOpenClawSkillToggle } from './openclaw-control';
import { decryptToken, encryptToken } from './token-crypto';

export type GoogleAuthPurpose = 'signin' | 'connect';

const GOOGLE_SIGNIN_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/userinfo.email',
];

const GOOGLE_CONNECT_SCOPES = [
  ...GOOGLE_SIGNIN_SCOPES,
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/presentations.readonly',
];

const CALENDAR_READ_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const CALENDAR_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const DRIVE_READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DOCS_SCOPE = 'https://www.googleapis.com/auth/documents';
const SHEETS_READ_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const SLIDES_READ_SCOPE = 'https://www.googleapis.com/auth/presentations.readonly';
const TOKEN_REFRESH_BUFFER_MS = 60_000;

type GoogleAuthState = {
  purpose: GoogleAuthPurpose;
  userId?: string;
  returnTo?: string;
  frontendOrigin?: string;
};

type StoredGoogleToken = {
  user_id: string;
  google_subject: string;
  google_email: string | null;
  access_token: string;
  refresh_token: string | null;
  scope: string;
  token_type: string;
  expires_at: string;
  updated_at?: string | null;
};

export type GoogleIntegrationState = 'not_connected' | 'connected' | 'reconnect_required';

export type GoogleIntegrationStatus = {
  status: GoogleIntegrationState;
  connected: boolean;
  needsReconnect: boolean;
  googleEmail: string | null;
  scopes: string[];
  grantedScopes: string[];
  expiresAt: string | null;
  canReadCalendar: boolean;
  canWriteCalendar: boolean;
  canReadDrive: boolean;
  canUseDocs: boolean;
  canUseSheets: boolean;
  canUseSlides: boolean;
  canUseWorkspaceSkill: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  lastSyncAt: string | null;
  error: string | null;
};

export type GoogleCalendarEvent = {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  htmlLink: string | null;
};

export type GoogleWorkspacePreview = {
  id: string;
  title: string;
  mimeType: string;
  modifiedTime: string | null;
  webViewLink: string | null;
  supported: boolean;
  supportMessage: string;
  format: 'text' | 'html' | 'unknown';
  content: string;
  summary: string | null;
};

function getGoogleClient() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL ||
    process.env.GOOGLE_OAUTH_REDIRECT_URI ||
      `${process.env.API_BASE_URL || 'http://localhost:4000'}/api/auth/google/callback`
  );
}

function getStateSecret() {
  return process.env.JWT_SECRET || process.env.GOOGLE_CLIENT_SECRET || 'studyclaw-google-state';
}

function signState(value: string) {
  return crypto.createHmac('sha256', getStateSecret()).update(value).digest('base64url');
}

function encodeState(state: GoogleAuthState) {
  const payload = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
  return `${payload}.${signState(payload)}`;
}

export function decodeGoogleAuthState(rawState: string | undefined) {
  if (!rawState) {
    return null;
  }

  const [payload, signature] = rawState.split('.');
  if (!payload || !signature) {
    return null;
  }

  const expected = signState(payload);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GoogleAuthState;
  } catch {
    return null;
  }
}

async function getStoredGoogleToken(userId: string) {
  const result = await db.query(`select * from user_google_tokens where user_id = $1`, [userId]);
  return (result.rows[0] as StoredGoogleToken | undefined) ?? null;
}

function parseStoredScopes(scope: string | null | undefined) {
  return String(scope ?? '')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function hasScope(scopes: string[], scope: string) {
  return scopes.includes(scope);
}

function tokenIsExpired(expiresAt: string | Date | null | undefined, bufferMs = TOKEN_REFRESH_BUFFER_MS) {
  if (!expiresAt) {
    return true;
  }

  return new Date(expiresAt).getTime() <= Date.now() + bufferMs;
}

function buildIntegrationStatus(input: {
  status: GoogleIntegrationState;
  googleEmail?: string | null;
  scopes?: string[];
  expiresAt?: string | null;
  hasAccessToken?: boolean;
  hasRefreshToken?: boolean;
  lastSyncAt?: string | null;
  error?: string | null;
}) {
  const scopes = input.scopes ?? [];
  const canReadCalendar = hasScope(scopes, CALENDAR_READ_SCOPE) || hasScope(scopes, CALENDAR_WRITE_SCOPE);
  const canWriteCalendar = hasScope(scopes, CALENDAR_WRITE_SCOPE);
  const canReadDrive = hasScope(scopes, DRIVE_READ_SCOPE);
  const canUseDocs = hasScope(scopes, DOCS_SCOPE);
  const canUseSheets = hasScope(scopes, SHEETS_READ_SCOPE);
  const canUseSlides = hasScope(scopes, SLIDES_READ_SCOPE);

  return {
    status: input.status,
    connected: input.status === 'connected',
    needsReconnect: input.status === 'reconnect_required',
    googleEmail: input.googleEmail ?? null,
    scopes,
    grantedScopes: scopes,
    expiresAt: input.expiresAt ?? null,
    canReadCalendar,
    canWriteCalendar,
    canReadDrive,
    canUseDocs,
    canUseSheets,
    canUseSlides,
    canUseWorkspaceSkill: canReadCalendar || canReadDrive || canUseDocs || canUseSheets || canUseSlides,
    hasAccessToken: input.hasAccessToken ?? false,
    hasRefreshToken: input.hasRefreshToken ?? false,
    lastSyncAt: input.lastSyncAt ?? null,
    error: input.error ?? null,
  } satisfies GoogleIntegrationStatus;
}

export function dedupeCalendarEvents(events: GoogleCalendarEvent[]) {
  const seen = new Set<string>();
  const deduped: GoogleCalendarEvent[] = [];

  for (const event of events) {
    const key = [
      event.id || 'unknown',
      event.startsAt || 'no-start',
      event.endsAt || 'no-end',
      event.title || 'untitled',
    ].join('|');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(event);
  }

  return deduped.sort((left, right) => {
    const leftTime = left.startsAt ? new Date(left.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = right.startsAt ? new Date(right.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime;
  });
}

export function buildCalendarWindow(windowDays = 30, now = new Date()) {
  const safeWindowDays = Math.min(Math.max(Number(windowDays) || 30, 1), 365);
  const timeMin = new Date(now);
  const timeMax = new Date(now.getTime() + safeWindowDays * 24 * 60 * 60 * 1000);

  return {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
  };
}

export function getGoogleScopesForPurpose(purpose: GoogleAuthPurpose) {
  return purpose === 'connect' ? GOOGLE_CONNECT_SCOPES : GOOGLE_SIGNIN_SCOPES;
}

export function deriveGoogleIntegrationStatus(input: {
  googleEmail?: string | null;
  scopes?: string[];
  expiresAt?: string | null;
  hasStoredToken?: boolean;
  hasAccessToken?: boolean;
  hasRefreshToken?: boolean;
  lastSyncAt?: string | null;
  refreshSucceeded?: boolean;
}) {
  if (!input.hasStoredToken) {
    return buildIntegrationStatus({ status: 'not_connected' });
  }

  const scopes = input.scopes ?? [];
  const expiresAt = input.expiresAt ?? null;
  const hasAccessToken = input.hasAccessToken ?? false;
  const hasRefreshToken = input.hasRefreshToken ?? false;
  const canReadCalendar = hasScope(scopes, CALENDAR_READ_SCOPE) || hasScope(scopes, CALENDAR_WRITE_SCOPE);
  const isExpired = tokenIsExpired(expiresAt, 0);

  let error: string | null = null;
  if (!hasAccessToken) {
    error = 'missing_access_token';
  } else if (!canReadCalendar) {
    error = 'missing_calendar_scope';
  } else if (isExpired && !hasRefreshToken) {
    error = 'missing_refresh_token';
  } else if (isExpired && input.refreshSucceeded === false) {
    error = 'token_refresh_failed';
  }

  return buildIntegrationStatus({
    status: error ? 'reconnect_required' : 'connected',
    googleEmail: input.googleEmail,
    scopes,
    expiresAt,
    hasAccessToken,
    hasRefreshToken,
    lastSyncAt: input.lastSyncAt,
    error,
  });
}

async function googleApiFetch<T>(userId: string, url: string, init?: RequestInit) {
  const accessToken = await getAccessToken(userId);
  if (!accessToken) {
    throw new Error('Google Drive and Calendar are not connected for this user.');
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Google API request failed with ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as T;
}

async function googleApiFetchText(userId: string, url: string, init?: RequestInit) {
  const accessToken = await getAccessToken(userId);
  if (!accessToken) {
    throw new Error('Google Drive and Calendar are not connected for this user.');
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Google API request failed with ${response.status}: ${await response.text()}`);
  }

  return response.text();
}

export function buildGoogleAuthUrl(input: GoogleAuthState) {
  return getGoogleClient().generateAuthUrl({
    access_type: 'offline',
    include_granted_scopes: true,
    prompt: 'consent select_account',
    scope: getGoogleScopesForPurpose(input.purpose),
    state: encodeState(input),
  });
}

export async function exchangeGoogleCode(code: string) {
  const client = getGoogleClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const userInfo = await client.request<{ email: string; name?: string; sub: string }>({
    url: 'https://www.googleapis.com/oauth2/v3/userinfo',
  });

  return {
    tokens,
    userInfo: userInfo.data,
  };
}

export async function saveUserGoogleTokens(input: {
  userId: string;
  googleSubject: string;
  googleEmail?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  scope: string;
  tokenType?: string | null;
  expiresAt: Date;
}) {
  await db.query(
    `insert into user_google_tokens
      (user_id, google_subject, google_email, access_token, refresh_token, scope, token_type, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (user_id) do update set
       google_subject = excluded.google_subject,
       google_email = excluded.google_email,
       access_token = excluded.access_token,
       refresh_token = coalesce(excluded.refresh_token, user_google_tokens.refresh_token),
       scope = excluded.scope,
       token_type = excluded.token_type,
       expires_at = excluded.expires_at,
       updated_at = now()`,
    [
      input.userId,
      input.googleSubject,
      input.googleEmail ?? null,
      encryptToken(input.accessToken),
      input.refreshToken ? encryptToken(input.refreshToken) : null,
      input.scope,
      input.tokenType ?? 'Bearer',
      input.expiresAt,
    ]
  );
}

export async function refreshGoogleTokenIfNeeded(userId: string) {
  const stored = await getStoredGoogleToken(userId);
  if (!stored) {
    return null;
  }

  const accessToken = decryptToken(stored.access_token);
  if (accessToken && !tokenIsExpired(stored.expires_at)) {
    return {
      accessToken,
      scopes: parseStoredScopes(stored.scope),
      expiresAt: stored.expires_at,
      refreshed: false,
    };
  }

  const refreshToken = decryptToken(stored.refresh_token);
  if (!refreshToken) {
    return null;
  }

  const client = getGoogleClient();
  client.setCredentials({
    access_token: accessToken ?? undefined,
    refresh_token: refreshToken,
    expiry_date: new Date(stored.expires_at).getTime(),
  });

  try {
    console.info('[google] refreshing token', {
      userId,
      hasRefreshToken: true,
      expiresAt: stored.expires_at,
    });
    await client.refreshAccessToken();
    const { access_token, refresh_token, expiry_date, token_type, scope } = client.credentials;
    if (!access_token) {
      return null;
    }

    await db.query(
      `update user_google_tokens
       set access_token = $2,
           refresh_token = coalesce($3, refresh_token),
           token_type = coalesce($4, token_type),
           scope = coalesce($5, scope),
           expires_at = $6,
           updated_at = now()
       where user_id = $1`,
      [
        userId,
        encryptToken(access_token),
        refresh_token ? encryptToken(refresh_token) : null,
        token_type ?? stored.token_type,
        scope ?? stored.scope,
        expiry_date ? new Date(expiry_date) : new Date(stored.expires_at),
      ]
    );

    return {
      accessToken: access_token,
      scopes: parseStoredScopes(scope ?? stored.scope),
      expiresAt: expiry_date ? new Date(expiry_date).toISOString() : stored.expires_at,
      refreshed: true,
    };
  } catch (error) {
    console.warn('[google] token refresh failed', {
      userId,
      message: error instanceof Error ? error.message : 'Unknown refresh error',
    });
    return null;
  }
}

export async function getGoogleIntegration(userId: string): Promise<GoogleIntegrationStatus> {
  const stored = await getStoredGoogleToken(userId);
  if (!stored) {
    return buildIntegrationStatus({ status: 'not_connected' });
  }

  const refreshed = await refreshGoogleTokenIfNeeded(userId);
  const scopes = refreshed?.scopes ?? parseStoredScopes(stored.scope);
  const expiresAt = refreshed?.expiresAt ?? stored.expires_at;
  const status = deriveGoogleIntegrationStatus({
    googleEmail: stored.google_email,
    hasStoredToken: true,
    hasAccessToken: !!decryptToken(stored.access_token) || !!refreshed?.accessToken,
    hasRefreshToken: !!decryptToken(stored.refresh_token),
    scopes,
    expiresAt,
    lastSyncAt: stored.updated_at ?? null,
    refreshSucceeded: refreshed ? true : tokenIsExpired(expiresAt, 0) ? false : undefined,
  });

  if (status.status !== 'connected') {
    console.warn('[google] integration requires reconnect', {
      userId,
      error: status.error,
      canReadCalendar: status.canReadCalendar,
      canWriteCalendar: status.canWriteCalendar,
      hasRefreshToken: status.hasRefreshToken,
      expiresAt: status.expiresAt,
    });
  }

  return status;
}

export async function getGoogleConnectionStatus(userId: string) {
  return getGoogleIntegration(userId);
}

export async function isGoogleConnected(userId: string) {
  const status = await getGoogleIntegration(userId);
  return status.connected;
}

export async function getAccessToken(userId: string) {
  const refreshed = await refreshGoogleTokenIfNeeded(userId);
  if (!refreshed?.accessToken) {
    return null;
  }

  return refreshed.accessToken;
}

export async function disconnectGoogleIntegration(userId: string) {
  await db.query(`delete from user_google_tokens where user_id = $1`, [userId]);
  await syncGoogleSkillForUser(userId).catch(() => undefined);
}

export async function syncGoogleSkillForUser(userId: string) {
  const status = await getGoogleIntegration(userId);

  try {
    await updateOpenClawSkillToggle({
      userId,
      skillName: 'gog',
      enabled: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (!/Personal agent .* not found/i.test(message) && !/Unknown skill:\s*gog/i.test(message)) {
      throw error;
    }
  }

  try {
    await updateOpenClawSkillToggle({
      userId,
      skillName: 'google-workspace',
      enabled: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (
      /Personal agent .* not found/i.test(message) ||
      /Unknown skill:\s*google-workspace/i.test(message)
    ) {
      return status;
    }

    throw error;
  }

  return status;
}

export async function listUpcomingCalendarEvents(
  userId: string,
  maxResults = 5,
  options?: { windowDays?: number }
) {
  const { timeMin, timeMax } = buildCalendarWindow(options?.windowDays ?? 30);
  const payload = await googleApiFetch<{
    items?: Array<{
      id: string;
      summary?: string;
      htmlLink?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;
  }>(
    userId,
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=${maxResults}`
  );

  return dedupeCalendarEvents((payload.items ?? []).map((item) => ({
    id: item.id,
    title: item.summary ?? 'Untitled event',
    startsAt: item.start?.dateTime ?? item.start?.date ?? null,
    endsAt: item.end?.dateTime ?? item.end?.date ?? null,
    htmlLink: item.htmlLink ?? null,
  })));
}

export async function getUpcomingCalendarItemsForStudent(userId: string, options?: {
  maxResults?: number;
}) {
  const integration = await getGoogleIntegration(userId);
  if (!integration.connected || !integration.canReadCalendar) {
    return {
      status: integration.status,
      items: [],
    };
  }

  try {
    return {
      status: integration.status,
      items: await listUpcomingCalendarEvents(userId, Math.min(Math.max(Number(options?.maxResults ?? 5), 1), 12)),
    };
  } catch (error) {
    console.warn('[google] calendar fetch failed', {
      userId,
      message: error instanceof Error ? error.message : 'Unknown calendar error',
    });
    return {
      status: 'reconnect_required' as const,
      items: [],
    };
  }
}

export async function listRecentDriveFiles(
  userId: string,
  pageSize = 5,
  kind: 'all' | 'docs' | 'sheets' | 'slides' = 'all'
) {
  const query =
    kind === 'docs'
      ? "mimeType='application/vnd.google-apps.document'"
      : kind === 'sheets'
        ? "mimeType='application/vnd.google-apps.spreadsheet'"
        : kind === 'slides'
          ? "mimeType='application/vnd.google-apps.presentation'"
          : '';
  const payload = await googleApiFetch<{
    files?: Array<{ id: string; name: string; mimeType?: string; modifiedTime?: string; webViewLink?: string }>;
  }>(
    userId,
    `https://www.googleapis.com/drive/v3/files?pageSize=${pageSize}&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime,webViewLink)${
      query ? `&q=${encodeURIComponent(query)}` : ''
    }`
  );

  return payload.files ?? [];
}

function summarizeGoogleWorkspaceContent(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 280);
}

export async function getGoogleWorkspacePreview(userId: string, fileId: string): Promise<GoogleWorkspacePreview> {
  const file = await googleApiFetch<{
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
    webViewLink?: string;
  }>(
    userId,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,webViewLink`
  );

  if (file.mimeType === 'application/vnd.google-apps.document') {
    const content = await googleApiFetchText(
      userId,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent('text/plain')}`
    );

    return {
      id: file.id,
      title: file.name,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime ?? null,
      webViewLink: file.webViewLink ?? null,
      supported: true,
      supportMessage: 'Ready to read',
      format: 'text',
      content,
      summary: summarizeGoogleWorkspaceContent(content),
    };
  }

  if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
    const spreadsheet = await googleApiFetch<{
      sheets?: Array<{ properties?: { title?: string } }>;
    }>(
      userId,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}?fields=sheets.properties.title`
    );

    const firstSheetTitle = spreadsheet.sheets?.[0]?.properties?.title;
    if (!firstSheetTitle) {
      return {
        id: file.id,
        title: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime ?? null,
        webViewLink: file.webViewLink ?? null,
        supported: false,
        supportMessage: 'This spreadsheet does not have a readable preview yet.',
        format: 'unknown',
        content: '',
        summary: null,
      };
    }

    const values = await googleApiFetch<{
      values?: string[][];
    }>(
      userId,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}/values/${encodeURIComponent(`${firstSheetTitle}!A1:Z200`)}`
    );

    const rows = (values.values ?? []).map((row) => row.join(' | ')).join('\n');
    const content = [`Sheet: ${firstSheetTitle}`, rows].filter(Boolean).join('\n\n');

    return {
      id: file.id,
      title: file.name,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime ?? null,
      webViewLink: file.webViewLink ?? null,
      supported: true,
      supportMessage: 'Ready to read',
      format: 'text',
      content,
      summary: summarizeGoogleWorkspaceContent(content),
    };
  }

  if (file.mimeType === 'application/vnd.google-apps.presentation') {
    const presentation = await googleApiFetch<{
      slides?: Array<{
        objectId?: string;
        pageElements?: Array<{
          shape?: {
            text?: {
              textElements?: Array<{
                textRun?: {
                  content?: string;
                };
              }>;
            };
          };
        }>;
      }>;
    }>(
      userId,
      `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(fileId)}`
    );

    const slidesText = (presentation.slides ?? [])
      .map((slide, index) => {
        const parts = (slide.pageElements ?? [])
          .flatMap((element) => element.shape?.text?.textElements ?? [])
          .map((item) => item.textRun?.content ?? '')
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        return `Slide ${index + 1}\n${parts || 'No extracted text'}`;
      })
      .join('\n\n');

    return {
      id: file.id,
      title: file.name,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime ?? null,
      webViewLink: file.webViewLink ?? null,
      supported: true,
      supportMessage: 'Ready to read',
      format: 'text',
      content: slidesText,
      summary: summarizeGoogleWorkspaceContent(slidesText),
    };
  }

  return {
    id: file.id,
    title: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime ?? null,
    webViewLink: file.webViewLink ?? null,
    supported: false,
    supportMessage: 'This Google file type is not previewable in the reader yet.',
    format: 'unknown',
    content: '',
    summary: null,
  };
}

export async function createGoogleDoc(userId: string, title: string, bodyText: string) {
  const doc = await googleApiFetch<{ documentId: string; title: string }>(
    userId,
    'https://docs.googleapis.com/v1/documents',
    {
      method: 'POST',
      body: JSON.stringify({ title }),
    }
  );

  if (bodyText.trim()) {
    await googleApiFetch(
      userId,
      `https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: bodyText,
              },
            },
          ],
        }),
      }
    );
  }

  return doc;
}

export async function createCalendarEvent(userId: string, input: {
  title: string;
  startsAt: string;
  endsAt?: string | null;
  description?: string | null;
  timeZone?: string | null;
}) {
  const integration = await getGoogleIntegration(userId);
  if (!integration.connected || !integration.canWriteCalendar) {
    throw new Error('Google Calendar needs to be connected again before StudyClaw can schedule events.');
  }

  const startDate = new Date(input.startsAt);
  if (Number.isNaN(startDate.getTime())) {
    throw new Error('startsAt must be a valid ISO timestamp');
  }

  const endDate =
    input.endsAt && !Number.isNaN(new Date(input.endsAt).getTime())
      ? new Date(input.endsAt)
      : new Date(startDate.getTime() + 60 * 60 * 1000);

  return googleApiFetch<{
    id: string;
    summary?: string;
    htmlLink?: string;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
  }>(userId, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify({
      summary: input.title,
      description: input.description ?? '',
      start: {
        dateTime: startDate.toISOString(),
        timeZone: input.timeZone ?? 'UTC',
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: input.timeZone ?? 'UTC',
      },
    }),
  });
}

function shouldSyncReminderType(type: string) {
  return /assignment|exam|quiz|test|project|paper|essay|lab|study_session|meeting/i.test(type);
}

export async function upsertCalendarEventForReminder(input: {
  userId: string;
  title: string;
  reminderAt: string | Date;
  type: string;
  metadata?: Record<string, unknown> | null;
  timeZone?: string | null;
}) {
  if (!shouldSyncReminderType(input.type)) {
    return null;
  }

  const integration = await getGoogleIntegration(input.userId);
  if (!integration.connected || !integration.canWriteCalendar) {
    return null;
  }

  const startAt = input.reminderAt instanceof Date ? input.reminderAt : new Date(input.reminderAt);
  if (Number.isNaN(startAt.getTime())) {
    return null;
  }

  const existingEventId =
    typeof input.metadata?.googleCalendarEventId === 'string' && input.metadata.googleCalendarEventId.trim()
      ? input.metadata.googleCalendarEventId.trim()
      : null;
  const eventPayload = {
    summary: input.title,
    description: `Synced by StudyClaw (${input.type.replace(/_/g, ' ')})`,
    start: {
      dateTime: startAt.toISOString(),
      timeZone: input.timeZone ?? 'UTC',
    },
    end: {
      dateTime: new Date(startAt.getTime() + 60 * 60 * 1000).toISOString(),
      timeZone: input.timeZone ?? 'UTC',
    },
  };

  try {
    const event = await googleApiFetch<{
      id: string;
      htmlLink?: string;
      summary?: string;
      start?: { dateTime?: string };
      end?: { dateTime?: string };
    }>(
      input.userId,
      existingEventId
        ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${existingEventId}`
        : 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: existingEventId ? 'PATCH' : 'POST',
        body: JSON.stringify(eventPayload),
      }
    );

    return {
      id: event.id,
      htmlLink: event.htmlLink ?? null,
      title: event.summary ?? input.title,
      startsAt: event.start?.dateTime ?? startAt.toISOString(),
      endsAt: event.end?.dateTime ?? null,
    };
  } catch (error) {
    console.warn('[google] reminder calendar sync failed', {
      userId: input.userId,
      title: input.title,
      type: input.type,
      message: error instanceof Error ? error.message : 'Unknown reminder sync error',
    });
    return null;
  }
}
