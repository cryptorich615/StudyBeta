import { OAuth2Client } from 'google-auth-library';
import { db } from './db';
import { decryptToken, encryptToken } from './token-crypto';

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar.readonly',
];

type StoredGoogleToken = {
  user_id: string;
  google_subject: string;
  google_email: string | null;
  access_token: string;
  refresh_token: string | null;
  scope: string;
  token_type: string;
  expires_at: string;
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

async function getStoredGoogleToken(userId: string) {
  const result = await db.query(`select * from user_google_tokens where user_id = $1`, [userId]);
  return (result.rows[0] as StoredGoogleToken | undefined) ?? null;
}

async function getAccessToken(userId: string) {
  const stored = await getStoredGoogleToken(userId);
  if (!stored) {
    return null;
  }

  const client = getGoogleClient();
  client.setCredentials({
    access_token: decryptToken(stored.access_token) ?? undefined,
    refresh_token: decryptToken(stored.refresh_token) ?? undefined,
    expiry_date: new Date(stored.expires_at).getTime(),
  });

  const result = await client.getAccessToken();
  const token = result.token ?? stored.access_token;
  const { access_token, refresh_token, expiry_date, token_type } = client.credentials;

  await db.query(
    `update user_google_tokens
     set access_token = $2,
         refresh_token = coalesce($3, refresh_token),
         token_type = coalesce($4, token_type),
         expires_at = $5,
         updated_at = now()
     where user_id = $1`,
    [
      userId,
      access_token ? encryptToken(access_token) : stored.access_token,
      refresh_token ? encryptToken(refresh_token) : null,
      token_type ?? stored.token_type,
      expiry_date ? new Date(expiry_date) : new Date(stored.expires_at),
    ]
  );

  return token;
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

export function buildGoogleAuthUrl() {
  return getGoogleClient().generateAuthUrl({
    access_type: 'offline',
    include_granted_scopes: true,
    prompt: 'consent select_account',
    scope: GOOGLE_SCOPES,
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

export async function getGoogleConnectionStatus(userId: string) {
  const stored = await getStoredGoogleToken(userId);
  return {
    connected: Boolean(stored),
    googleEmail: stored?.google_email ?? null,
    scopes: stored?.scope?.split(/\s+/).filter(Boolean) ?? [],
  };
}

export async function listUpcomingCalendarEvents(userId: string, maxResults = 5) {
  const now = encodeURIComponent(new Date().toISOString());
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
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${now}&maxResults=${maxResults}`
  );

  return (payload.items ?? []).map((item) => ({
    id: item.id,
    title: item.summary ?? 'Untitled event',
    startsAt: item.start?.dateTime ?? item.start?.date ?? null,
    endsAt: item.end?.dateTime ?? item.end?.date ?? null,
    htmlLink: item.htmlLink ?? null,
  }));
}

export async function listRecentDriveFiles(userId: string, pageSize = 5) {
  const payload = await googleApiFetch<{
    files?: Array<{ id: string; name: string; mimeType?: string; modifiedTime?: string; webViewLink?: string }>;
  }>(
    userId,
    `https://www.googleapis.com/drive/v3/files?pageSize=${pageSize}&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime,webViewLink)`
  );

  return payload.files ?? [];
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
