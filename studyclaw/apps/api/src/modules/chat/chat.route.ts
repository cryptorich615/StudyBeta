import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../../lib/db';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { OpenClawClient } from '../../integrations/openclaw/openclaw.client';
import {
  buildChatTranscript,
  buildStudyContext,
  buildStudyInstructions,
  loadAgentProfile,
} from '../../lib/study-context';
import { buildBootstrapExtractionPrompt } from '../../lib/bootstrap';
import { syncGoogleSkillForUser, upsertCalendarEventForReminder } from '../../lib/google-service';
import { syncUserWorkspaceProfile } from '../../lib/user-agent';
import { ensurePlatformSchema } from '../../lib/platform-schema';
import { syncUserModelRuntimeConfig } from '../../lib/model-settings';
import {
  ManagedUsageLimitError,
  finalizeManagedUsageEvent,
  reserveManagedUsageEvent,
} from '../../lib/managed-usage';
import {
  recordStudyEvent,
  upsertAssignmentFromReminder,
  writeMemorySummary,
} from '../../lib/student-memory';

export const chatRouter = Router();
chatRouter.use(requireAuth);

const openclaw = new OpenClawClient();
const MAX_ATTACHMENT_TEXT_LENGTH = 20_000;
const MAX_ATTACHMENT_COUNT = 3;

type ReminderIntentResult = {
  shouldCreate?: boolean;
  title?: string;
  reminderType?: 'exam' | 'assignment' | 'study_session' | 'meeting' | 'custom';
  reminderAtIso?: string;
  assumedTimezone?: string;
  confirmation?: string;
  missingFields?: string[];
};

type ResearchSource = {
  label: string;
  url: string;
  hostname: string;
};

type ResearchResultCard = {
  kind: 'research_result';
  title: string;
  summary: string;
  sources: ResearchSource[];
  pageTitle: string | null;
  checkedAt: string;
  screenshots: string[];
  screenshotUrl: string | null;
  screenshotAlt: string;
  savedToBackpack?: boolean;
  savedAssetId?: string | null;
};

type AssistantCapabilityBadge = {
  key: string;
  label: string;
};

const TIMEZONE_ABBREVIATION_TO_OFFSET_MINUTES: Record<string, number> = {
  UTC: 0,
  EST: -5 * 60,
  EDT: -4 * 60,
  CST: -6 * 60,
  CDT: -5 * 60,
  MST: -7 * 60,
  MDT: -6 * 60,
  PST: -8 * 60,
  PDT: -7 * 60,
};

const ADMIN_CHAT_PROFILE = {
  openclaw_agent_id: 'main',
  model_key: 'minimax/MiniMax-M2.7',
  system_prompt: [
    'You are StudyClaw Admin, the platform administrator agent.',
    'You have full administrative authority within StudyClaw and OpenClaw operations.',
    'Focus on diagnosis, repair, verification, safety, and clear operational reporting.',
    'Do not behave like a student tutor unless directly helping inspect the tutoring stack.',
  ].join(' '),
  persona_name: 'StudyClaw Admin',
  tone: 'precise',
  verbosity: 'concise',
  teaching_style: 'operational',
  reminder_style: 'n/a',
} as const;

function parseJsonBlock(value: string) {
  const cleaned = value
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }

    throw new Error('invalid_json');
  }
}

function extractUrlsFromString(value: string) {
  const matches = value.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  return matches
    .map((match) => match.replace(/[),.;]+$/, ''))
    .filter(Boolean);
}

function collectNestedStrings(value: unknown, bucket: string[], depth = 0) {
  if (depth > 6 || value === null || value === undefined) {
    return;
  }

  if (typeof value === 'string') {
    bucket.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectNestedStrings(item, bucket, depth + 1);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectNestedStrings(item, bucket, depth + 1);
    }
  }
}

function findNestedStringByKey(value: unknown, candidateKeys: string[], depth = 0): string | null {
  if (depth > 6 || value === null || value === undefined || typeof value !== 'object') {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findNestedStringByKey(item, candidateKeys, depth + 1);
      if (match) {
        return match;
      }
    }
    return null;
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (candidateKeys.includes(key) && typeof item === 'string' && item.trim()) {
      return item.trim();
    }

    const nested = findNestedStringByKey(item, candidateKeys, depth + 1);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function sanitizeScreenshotPreview(value: string | null) {
  if (!value) {
    return null;
  }

  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value)) {
    return value.length <= 250_000 ? value : null;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return null;
}

function buildSourceLabel(url: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '') || '/';

    if (path === '/') {
      return hostname;
    }

    return `${hostname}${path.length > 32 ? `${path.slice(0, 32)}…` : path}`;
  } catch {
    return url;
  }
}

function summarizeResearchText(text: string) {
  const cleaned = text.replace(/\[(\d+)\]/g, '').trim();
  const firstParagraph = cleaned.split(/\n\s*\n/).find((part) => part.trim()) ?? cleaned;
  return firstParagraph.slice(0, 320).trim();
}

function buildResearchTitle(text: string, sources: ResearchSource[]) {
  const firstSentence =
    text
      .split(/\n+/)
      .map((line) => line.trim())
      .find(Boolean)
      ?.replace(/^[-*#\s]+/, '')
      .replace(/^here('|’)s what i found[:, -]*/i, '')
      .replace(/^summary[:, -]*/i, '') ?? '';

  const normalized = firstSentence.replace(/\s+/g, ' ').trim();
  if (normalized) {
    return normalized.length > 88 ? `${normalized.slice(0, 88).trim()}…` : normalized;
  }

  if (sources[0]) {
    return `Research from ${sources[0].hostname}`;
  }

  return 'Research result';
}

function buildResearchResultCard(assistantText: string, raw: unknown): ResearchResultCard {
  const nestedStrings: string[] = [];
  collectNestedStrings(raw, nestedStrings);

  const sourceUrls = Array.from(
    new Set(
      [...extractUrlsFromString(assistantText), ...nestedStrings.flatMap((value) => extractUrlsFromString(value))]
        .map((value) => value.trim())
        .filter((value) => /^https?:\/\//i.test(value))
        .filter((value) => !/localhost|127\.0\.0\.1|openclaw/i.test(value))
    )
  );

  const sources = sourceUrls.slice(0, 5).map((url) => {
    let hostname = '';

    try {
      hostname = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      hostname = url;
    }

    return {
      label: buildSourceLabel(url),
      url,
      hostname,
    };
  });

  const screenshotCandidates = Array.from(
    new Set(
      nestedStrings
        .filter(
          (value) =>
            /^data:image\//i.test(value) ||
            /^https?:\/\/\S+\.(png|jpe?g|webp)(\?\S*)?$/i.test(value) ||
            (/screenshot/i.test(value) && /^https?:\/\//i.test(value))
        )
        .map((value) => sanitizeScreenshotPreview(value))
        .filter((value): value is string => Boolean(value))
    )
  ).slice(0, 3);

  const pageTitle =
    findNestedStringByKey(raw, ['pageTitle', 'page_title', 'documentTitle']) ??
    findNestedStringByKey(raw, ['title'])?.replace(/\s+/g, ' ').trim() ??
    null;

  return {
    kind: 'research_result',
    title: buildResearchTitle(assistantText, sources),
    summary: summarizeResearchText(assistantText),
    sources,
    pageTitle: pageTitle && pageTitle.length <= 120 && !/^https?:\/\//i.test(pageTitle) ? pageTitle : null,
    checkedAt: new Date().toISOString(),
    screenshots: screenshotCandidates,
    screenshotUrl: screenshotCandidates[0] ?? null,
    screenshotAlt: pageTitle ? `${pageTitle} preview` : 'Research browser preview',
  };
}

function buildAssistantCapabilityBadges(input: {
  isResearchRequest?: boolean;
  hasAttachments?: boolean;
  reminderCreated?: boolean;
  reminderLookup?: boolean;
  researchResult?: ResearchResultCard | null;
}) {
  const badges: AssistantCapabilityBadge[] = [];

  if (input.isResearchRequest) {
    badges.push({ key: 'browser', label: 'Used browser research' });
  }

  if (input.researchResult?.sources.length) {
    badges.push({ key: 'sources', label: `Checked ${input.researchResult.sources.length} source${input.researchResult.sources.length === 1 ? '' : 's'}` });
  }

  const screenshotCount = input.researchResult?.screenshots.length ?? 0;
  if (screenshotCount) {
    badges.push({ key: 'screenshots', label: `${screenshotCount} screenshot${screenshotCount === 1 ? '' : 's'} captured` });
  }

  if (input.hasAttachments) {
    badges.push({ key: 'notes', label: 'Used uploaded notes' });
  }

  if (input.reminderCreated) {
    badges.push({ key: 'reminder', label: 'Created a reminder' });
  }

  if (input.reminderLookup) {
    badges.push({ key: 'reminder_lookup', label: 'Checked reminders' });
  }

  return badges;
}

function looksLikeReminderStatusQuestion(message: string) {
  const normalized = message.toLowerCase();
  if (!normalized.includes('reminder')) {
    return false;
  }

  return (
    /\b(why|where|when|didn'?t|did not|not get|did not get|didn't get|did not receive|didn't receive|missed)\b/.test(
      normalized
    ) || /\b(status|show|check|find)\b/.test(normalized)
  );
}

function looksLikeReminderIntent(message: string) {
  const normalized = message.toLowerCase();
  return /\b(remind me|remind us|set a reminder|set reminder|create a reminder|schedule a reminder|reminder for|notify me|ping me)\b/.test(
    normalized
  );
}

function formatReminderTime(reminderAtIso: string, timezone: string | null | undefined) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone || 'America/New_York',
    }).format(new Date(reminderAtIso));
  } catch {
    return new Date(reminderAtIso).toISOString();
  }
}

function getOffsetMinutesForTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const timeZoneName = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = timeZoneName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);

  if (!match) {
    return 0;
  }

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

function getLocalDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = Number(parts.find((part) => part.type === 'year')?.value ?? '0');
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? '1');
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? '1');

  return { year, month, day };
}

function addDaysToDateParts(parts: { year: number; month: number; day: number }, days: number) {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function zonedLocalTimeToUtc(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone?: string;
  offsetMinutes?: number;
}) {
  if (typeof input.offsetMinutes === 'number') {
    return new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute) - input.offsetMinutes * 60_000);
  }

  let guess = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute);
  for (let index = 0; index < 4; index += 1) {
    const offsetMinutes = getOffsetMinutesForTimeZone(new Date(guess), input.timeZone || 'America/New_York');
    const nextGuess = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute) - offsetMinutes * 60_000;
    if (nextGuess === guess) {
      break;
    }
    guess = nextGuess;
  }

  return new Date(guess);
}

function inferReminderTitle(message: string) {
  const normalized = message.toLowerCase();

  const roomMatch = message.match(/\broom\s+([a-z0-9-]+)/i);
  const roomSuffix = roomMatch ? ` Room ${roomMatch[1].toUpperCase()}` : '';

  const subjectTestMatch = message.match(
    /\b(?:a|an|my)\s+([a-z][a-z0-9&/+\-\s]{0,30}?)\s+(test|exam|quiz)\b/i
  );
  if (subjectTestMatch) {
    const subject = subjectTestMatch[1]
      .trim()
      .replace(/\b(math|english|history|biology|chemistry|physics|science)\b/gi, (part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase());
    const eventType = subjectTestMatch[2][0]!.toUpperCase() + subjectTestMatch[2].slice(1).toLowerCase();
    return `${subject} ${eventType}${roomSuffix}`;
  }

  const simpleEventMatch = message.match(/\b(test|exam|quiz|assignment|homework|meeting|study session)\b/i);
  if (simpleEventMatch) {
    const eventType = simpleEventMatch[1]
      .replace(/\bstudy session\b/i, 'Study Session')
      .replace(/\b\w/g, (part) => part.toUpperCase());
    return `${eventType}${roomSuffix}`;
  }

  if (normalized.includes('study')) return 'Study Reminder';
  if (normalized.includes('assignment') || normalized.includes('homework')) return 'Assignment Reminder';
  if (normalized.includes('meeting')) return 'Meeting Reminder';
  return 'Reminder';
}

function inferReminderType(message: string): ReminderIntentResult['reminderType'] {
  const normalized = message.toLowerCase();
  if (normalized.includes('study')) return 'study_session';
  if (normalized.includes('exam') || normalized.includes('test') || normalized.includes('quiz')) return 'exam';
  if (normalized.includes('assignment') || normalized.includes('homework') || normalized.includes('essay')) return 'assignment';
  if (normalized.includes('meeting') || normalized.includes('call') || normalized.includes('office hours')) return 'meeting';
  return 'custom';
}

function looksLikeReminderCreateQuestion(message: string) {
  return looksLikeReminderIntent(message);
}

function buildReminderConfirmation(title: string, reminderAtIso: string, timezone: string | null | undefined) {
  return `Got it! I have set a reminder for "${title}" at ${formatReminderTime(reminderAtIso, timezone)}. Check your dashboard!`;
}

function buildMissingReminderTimeReply() {
  return 'I can set that reminder. Tell me the date or time you want, for example "remind me tomorrow at 7:59 PM".';
}

function tryParseReminderIntentFallback(input: {
  message: string;
  timezone?: string | null;
}): ReminderIntentResult | null {
  if (!looksLikeReminderCreateQuestion(input.message)) {
    return null;
  }

  const timeMatch = input.message.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!timeMatch) {
    return {
      shouldCreate: false,
      missingFields: ['time'],
    };
  }

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] ?? '0');
  const meridiem = timeMatch[3].toLowerCase();

  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return null;
  }

  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  const explicitTimezone = input.message.match(/\b(UTC|EST|EDT|CST|CDT|MST|MDT|PST|PDT)\b/i)?.[1]?.toUpperCase();
  const timeZone = explicitTimezone ? undefined : input.timezone || 'America/New_York';
  const offsetMinutes = explicitTimezone ? TIMEZONE_ABBREVIATION_TO_OFFSET_MINUTES[explicitTimezone] : undefined;
  const assumedTimezone = explicitTimezone || timeZone || 'America/New_York';
  const now = new Date();
  const localParts = timeZone ? getLocalDateParts(now, timeZone) : getLocalDateParts(new Date(now.getTime() + (offsetMinutes ?? 0) * 60_000), 'UTC');
  let targetDate = localParts;
  let reminderAt = zonedLocalTimeToUtc({
    ...targetDate,
    hour,
    minute,
    timeZone,
    offsetMinutes,
  });

  if (reminderAt.getTime() <= now.getTime()) {
    targetDate = addDaysToDateParts(targetDate, 1);
    reminderAt = zonedLocalTimeToUtc({
      ...targetDate,
      hour,
      minute,
      timeZone,
      offsetMinutes,
    });
  }

  return {
    shouldCreate: true,
    title: inferReminderTitle(input.message),
    reminderType: inferReminderType(input.message),
    reminderAtIso: reminderAt.toISOString(),
    assumedTimezone,
    confirmation: buildReminderConfirmation(inferReminderTitle(input.message), reminderAt.toISOString(), assumedTimezone),
    missingFields: [],
  };
}

async function createReminderRecord(input: {
  userId: string;
  title: string;
  reminderType: NonNullable<ReminderIntentResult['reminderType']>;
  reminderAtIso: string;
  assumedTimezone?: string;
  originalMessage: string;
  sourceThreadId?: string;
}) {
  const reminderAt = new Date(input.reminderAtIso);
  if (Number.isNaN(reminderAt.getTime())) {
    return null;
  }

  const created = await db.query(
    `insert into reminders (user_id, title, reminder_at, type, metadata_json)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [
      input.userId,
      input.title,
      reminderAt.toISOString(),
      input.reminderType,
      JSON.stringify({
        source: 'chat',
        assumedTimezone: input.assumedTimezone ?? 'America/New_York',
        originalMessage: input.originalMessage,
        sourceThreadId: input.sourceThreadId ?? null,
      }),
    ]
  );
  const reminder = created.rows[0] ?? null;
  if (!reminder) {
    return null;
  }

  const syncedEvent = await upsertCalendarEventForReminder({
    userId: input.userId,
    title: input.title,
    reminderAt: reminder.reminder_at,
    type: input.reminderType,
    metadata: reminder.metadata_json ?? {},
    timeZone: input.assumedTimezone ?? 'America/New_York',
  });
  if (!syncedEvent) {
    return reminder;
  }

  const updated = await db.query(
    `update reminders
     set metadata_json = metadata_json || $2::jsonb
     where id = $1
     returning *`,
    [
      reminder.id,
      JSON.stringify({
        calendarSource: 'google',
        googleCalendarEventId: syncedEvent.id,
        googleCalendarHtmlLink: syncedEvent.htmlLink,
      }),
    ]
  );

  return updated.rows[0] ?? reminder;
}

function normalizeAssistantIdentity(replyText: string, personaName: string) {
  const trimmedPersona = personaName.trim();
  if (!trimmedPersona || trimmedPersona === 'StudyClaw') {
    return replyText;
  }

  return replyText
    .replace(/\b(My name is|I(?:'| a)m)\s+StudyClaw\b/gi, (match, prefix: string) => `${prefix} ${trimmedPersona}`)
    .replace(/\bcall me\s+StudyClaw\b/gi, `call me ${trimmedPersona}`)
    .replace(/\bStudyClaw\b/g, trimmedPersona);
}

function inferWeakAreaSummary(message: string) {
  const match = message.match(/\b(?:i\s+struggle\s+with|i'?m\s+struggling\s+with|i\s+keep\s+missing|i'?m\s+confused\s+about|i\s+need\s+help\s+with)\s+(.+?)(?:[.?!]|$)/i);
  if (!match?.[1]) {
    return null;
  }

  const topic = match[1].trim().replace(/\s+/g, ' ');
  if (!topic || topic.length < 3) {
    return null;
  }

  return `Student struggles with ${topic.length > 90 ? `${topic.slice(0, 90).trim()}...` : topic}.`;
}

function inferPreferenceSummary(message: string) {
  const match = message.match(
    /\b(?:i\s+prefer|i\s+learn\s+best\s+with|i\s+study\s+best\s+with|i\s+study\s+better\s+with|i\s+study\s+better\s+in|i\s+retain\s+more\s+when)\s+(.+?)(?:[.?!]|$)/i
  );
  if (!match?.[1]) {
    return null;
  }

  const preference = match[1].trim().replace(/\s+/g, ' ');
  if (!preference || preference.length < 4) {
    return null;
  }

  return `Student prefers ${preference.length > 110 ? `${preference.slice(0, 110).trim()}...` : preference}.`;
}

type ChatAttachment = {
  name?: string;
  type?: string;
  extractedText?: string;
};

function normalizeAttachments(attachments: ChatAttachment[] | undefined) {
  return (attachments ?? [])
    .slice(0, MAX_ATTACHMENT_COUNT)
    .map((attachment) => ({
      name: attachment.name?.trim() || 'document',
      type: attachment.type?.trim() || 'application/octet-stream',
      extractedText: attachment.extractedText?.trim().slice(0, MAX_ATTACHMENT_TEXT_LENGTH) || '',
    }))
    .filter((attachment) => attachment.extractedText);
}

function buildAttachmentPrompt(attachments: Array<{ name: string; type: string; extractedText: string }>) {
  if (!attachments.length) {
    return '';
  }

  return attachments
    .map(
      (attachment, index) =>
        `Document ${index + 1}: ${attachment.name}\nType: ${attachment.type}\nContent:\n${attachment.extractedText}`
    )
    .join('\n\n');
}

async function tryHandleReminderIntent(input: {
  userId: string;
  message: string;
  modelKey?: string;
  timezone?: string | null;
  threadId: string;
}) {
  const extractionPrompt = [
    'You extract reminder scheduling intents for StudyClaw.',
    'Return valid JSON only.',
    'Schema:',
    '{',
    '  "shouldCreate": true,',
    '  "title": "short reminder title",',
    '  "reminderType": "exam|assignment|study_session|meeting|custom",',
    '  "reminderAtIso": "UTC ISO timestamp",',
    '  "assumedTimezone": "timezone used to interpret the request",',
    '  "confirmation": "one sentence confirming what was scheduled",',
    '  "missingFields": []',
    '}',
    'Rules:',
    '- Only set shouldCreate to true if the user is clearly asking to create, set, or schedule a reminder.',
    '- If the request lacks a date, choose the next occurrence of that time.',
    '- Respect explicit timezone mentions like EST or EDT over the profile timezone.',
    '- reminderAtIso must be a full UTC ISO timestamp.',
    '- title should be concise and study-focused when appropriate.',
    '- Never return prose, markdown, or explanations outside the JSON object.',
    `Student profile timezone: ${input.timezone ?? 'America/New_York'}`,
    `Current UTC time: ${new Date().toISOString()}`,
    '',
    `User message: ${input.message}`,
  ].join('\n');

  const extraction = await openclaw.sendMessage({
    model: input.modelKey,
    instructions: 'Return valid JSON only with no markdown.',
    message: extractionPrompt,
    metadata: {
      feature: 'chat-reminder-intent',
      threadId: input.threadId,
    },
    userId: input.userId,
  });

  let parsed: ReminderIntentResult | null = null;
  try {
    parsed = parseJsonBlock(extraction.text) as ReminderIntentResult;
  } catch {
    return null;
  }

  if (!parsed?.shouldCreate || !parsed.title || !parsed.reminderType || !parsed.reminderAtIso) {
    return parsed;
  }

  const createdReminder = await createReminderRecord({
    userId: input.userId,
    title: parsed.title,
    reminderType: parsed.reminderType,
    reminderAtIso: parsed.reminderAtIso,
    assumedTimezone: parsed.assumedTimezone ?? input.timezone ?? 'America/New_York',
    originalMessage: input.message,
    sourceThreadId: input.threadId,
  });

  if (!createdReminder) {
    return null;
  }

  return {
    ...parsed,
    reminderAtIso: createdReminder.reminder_at,
    confirmation: buildReminderConfirmation(
      parsed.title,
      createdReminder.reminder_at,
      parsed.assumedTimezone ?? input.timezone ?? 'America/New_York'
    ),
    createdReminder,
  } as ReminderIntentResult & { createdReminder: any };
}

async function tryHandleReminderStatusQuestion(input: {
  userId: string;
  message: string;
  timezone?: string | null;
}) {
  if (!looksLikeReminderStatusQuestion(input.message)) {
    return null;
  }

  const reminders = await db.query(
    `select id, title, reminder_at, status, type, metadata_json, created_at
     from reminders
     where user_id = $1
     order by reminder_at desc
     limit 3`,
    [input.userId]
  );

  const latest = reminders.rows[0];
  if (!latest) {
    return {
      assistantText:
        'I could not find any reminders on your account yet. If you want, ask me to schedule one with the exact date and time.',
      metadata: {
        reminderLookup: true,
        found: false,
      },
    };
  }

  const friendlyTime = formatReminderTime(latest.reminder_at, input.timezone);
  let assistantText = `I found your latest reminder, "${latest.title}", scheduled for ${friendlyTime}.`;

  if (latest.status === 'scheduled') {
    assistantText +=
      ' It looks like it was saved, but automatic reminder delivery is not firing yet in this workspace, so you would not have received a push or timed notification.';
  } else {
    assistantText += ` Its current status is ${latest.status}.`;
  }

  return {
    assistantText,
    metadata: {
      reminderLookup: true,
      found: true,
      reminderId: latest.id,
      reminderAtIso: latest.reminder_at,
      reminderStatus: latest.status,
      reminderType: latest.type,
    },
  };
}

async function syncBootstrapProfile(userId: string, threadId: string, modelKey?: string) {
  const userResult = await db.query(`select email from users where id = $1`, [userId]);
  const userEmail = userResult.rows[0]?.email ?? `${userId}@local.invalid`;
  const messagesResult = await db.query(
    `select role, content from chat_messages where thread_id = $1 order by created_at asc`,
    [threadId]
  );

  const transcript = messagesResult.rows
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
    .join('\n\n');

  if (!transcript.trim()) {
    return;
  }

  const extracted = await openclaw.sendMessage({
    model: modelKey,
    instructions: 'Return valid JSON only.',
    message: buildBootstrapExtractionPrompt(transcript),
    metadata: {
      feature: 'bootstrap_extract',
      threadId,
    },
    userId,
  });

  let parsed:
    | {
        studentName?: string | null;
        schoolName?: string | null;
        schoolLevel?: string | null;
        gradeYear?: string | null;
        timezone?: string | null;
        learningStyle?: string | null;
        subjects?: string[];
        complete?: boolean;
      }
    | null = null;

  try {
    parsed = JSON.parse(
      extracted.text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/, '')
        .trim()
    );
  } catch {
    return;
  }

  if (!parsed) {
    return;
  }

  await db.query(
    `insert into student_profiles (user_id, school_name, school_level, grade_year, timezone, learning_style, onboarding_complete)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id) do update set
       school_name = coalesce(excluded.school_name, student_profiles.school_name),
       school_level = coalesce(excluded.school_level, student_profiles.school_level),
       grade_year = coalesce(excluded.grade_year, student_profiles.grade_year),
       timezone = coalesce(excluded.timezone, student_profiles.timezone),
       learning_style = coalesce(excluded.learning_style, student_profiles.learning_style),
       onboarding_complete = excluded.onboarding_complete`,
    [
      userId,
      parsed.schoolName ?? null,
      parsed.schoolLevel ?? 'other',
      parsed.gradeYear ?? null,
      parsed.timezone ?? 'America/New_York',
      parsed.learningStyle ?? null,
      !!parsed.complete,
    ]
  );

  for (const subject of parsed.subjects ?? []) {
    if (!subject?.trim()) continue;
    await db.query(`insert into subjects (user_id, name) values ($1, $2) on conflict (user_id, name) do nothing`, [
      userId,
      subject.trim(),
    ]);
  }

  await syncUserWorkspaceProfile({
    userId,
    email: userEmail,
    studentName: parsed.studentName,
    schoolName: parsed.schoolName,
    gradeYear: parsed.gradeYear,
    timezone: parsed.timezone,
    learningStyle: parsed.learningStyle,
    subjects: parsed.subjects ?? [],
  });
}

chatRouter.get('/threads', async (req: AuthedRequest, res) => {
  const result = await db.query(
    `select * from chat_threads where user_id = $1 order by last_message_at desc`,
    [req.user!.id]
  );
  res.json(result.rows);
});

chatRouter.get('/threads/:threadId', async (req: AuthedRequest, res) => {
  const thread = await db.query(`select * from chat_threads where id = $1 and user_id = $2`, [
    req.params.threadId,
    req.user!.id,
  ]);

  if (!thread.rows[0]) {
    return res.status(404).json({ error: 'not_found', message: 'Thread not found' });
  }

  const messages = await db.query(`select * from chat_messages where thread_id = $1 order by created_at asc`, [
    req.params.threadId,
  ]);

  res.json({ thread: thread.rows[0], messages: messages.rows });
});

chatRouter.post('/research-note', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();

  const { threadId, messageId } = req.body as {
    threadId?: string;
    messageId?: string;
  };

  if (!threadId || !messageId) {
    return res.status(400).json({ error: 'bad_request', message: 'threadId and messageId are required' });
  }

  const threadResult = await db.query(`select id from chat_threads where id = $1 and user_id = $2 limit 1`, [
    threadId,
    req.user!.id,
  ]);

  if (!threadResult.rows[0]) {
    return res.status(404).json({ error: 'not_found', message: 'Study session not found' });
  }

  const messageResult = await db.query(
    `select id, role, content, metadata_json
     from chat_messages
     where id = $1
       and thread_id = $2
     limit 1`,
    [messageId, threadId]
  );

  const messageRow = messageResult.rows[0] as
    | {
        id: string;
        role: string;
        content: string;
        metadata_json?: {
          researchResult?: ResearchResultCard;
          savedToBackpack?: boolean;
          savedAssetId?: string | null;
        } | null;
      }
    | undefined;

  if (!messageRow || messageRow.role !== 'assistant') {
    return res.status(404).json({ error: 'not_found', message: 'Research message not found' });
  }

  const researchResult = messageRow.metadata_json?.researchResult;
  if (!researchResult || researchResult.kind !== 'research_result') {
    return res.status(400).json({
      error: 'bad_request',
      message: 'Only browser-backed research replies can be saved to notes.',
    });
  }

  if (messageRow.metadata_json?.savedAssetId) {
    return res.status(200).json({
      ok: true,
      duplicate: true,
      assetId: messageRow.metadata_json.savedAssetId,
      message: 'This research is already saved in Backpack.',
    });
  }

  const existingAsset = await db.query(
    `select id
     from study_assets
     where user_id = $1
       and coalesce(metadata_json->>'source', '') = 'chat_research'
       and coalesce(metadata_json->>'sourceMessageId', '') = $2
     limit 1`,
    [req.user!.id, messageId]
  );

  if (existingAsset.rows[0]?.id) {
    await db.query(
      `update chat_messages
       set metadata_json = coalesce(metadata_json, '{}'::jsonb) || $3::jsonb
       where id = $1
         and thread_id = $2`,
      [
        messageId,
        threadId,
        JSON.stringify({
          savedToBackpack: true,
          savedAssetId: existingAsset.rows[0].id,
          researchResult: {
            ...researchResult,
            savedToBackpack: true,
            savedAssetId: existingAsset.rows[0].id,
          },
        }),
      ]
    );

    return res.status(200).json({
      ok: true,
      duplicate: true,
      assetId: existingAsset.rows[0].id,
      message: 'This research is already saved in Backpack.',
    });
  }

  const noteTitle = `Research · ${researchResult.title}`.slice(0, 140);
  const processedText = [
    researchResult.summary,
    researchResult.sources.length
      ? `Sources\n${researchResult.sources.map((source) => `- ${source.label}: ${source.url}`).join('\n')}`
      : '',
    researchResult.screenshotUrl && !researchResult.screenshotUrl.startsWith('data:')
      ? `Screenshot preview\n${researchResult.screenshotUrl}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const createdAsset = await db.query(
    `insert into study_assets (user_id, subject_id, asset_type, title, original_text, processed_text, metadata_json)
     values ($1, null, 'typed_note', $2, $3, $4, $5)
     returning id, title`,
    [
      req.user!.id,
      noteTitle,
      messageRow.content,
      processedText,
      JSON.stringify({
        source: 'chat_research',
        sourceThreadId: threadId,
        sourceMessageId: messageId,
        sectionName: 'Research',
        researchResult: {
          ...researchResult,
          screenshotUrl: researchResult.screenshotUrl?.startsWith('data:') ? null : researchResult.screenshotUrl,
          savedToBackpack: true,
        },
      }),
    ]
  );

  await db.query(
    `update chat_messages
     set metadata_json = coalesce(metadata_json, '{}'::jsonb) || $3::jsonb
     where id = $1
       and thread_id = $2`,
    [
      messageId,
      threadId,
      JSON.stringify({
        savedToBackpack: true,
        savedAssetId: createdAsset.rows[0].id,
        researchResult: {
          ...researchResult,
          savedToBackpack: true,
          savedAssetId: createdAsset.rows[0].id,
        },
      }),
    ]
  );

  return res.status(201).json({
    ok: true,
    duplicate: false,
    assetId: createdAsset.rows[0].id,
    message: 'Saved to Backpack.',
  });
});

chatRouter.post('/send', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const { threadId, message, attachments, studyMode } = req.body as {
    threadId?: string;
    message?: string;
    attachments?: ChatAttachment[];
    studyMode?: string;
  };
  const normalizedAttachments = normalizeAttachments(attachments);
  const trimmedMessage = message?.trim() ?? '';
  const isResearchRequest =
    studyMode === 'research' || /use the browser tool to research|research this on the web/i.test(trimmedMessage);

  if (!trimmedMessage && !normalizedAttachments.length) {
    return res.status(400).json({ error: 'bad_request', message: 'message or document text is required' });
  }

  const isAdmin = req.user?.role === 'admin';

  const agent = isAdmin
    ? ADMIN_CHAT_PROFILE
    : await loadAgentProfile(req.user!.id);
  const studentAgent = isAdmin
    ? null
    : (await db.query(`select * from agents where user_id = $1`, [req.user!.id])).rows[0];

  if (!agent || (!isAdmin && !studentAgent)) {
    return res.status(400).json({ error: 'missing_agent', message: 'Complete onboarding first' });
  }

  if (!isAdmin) {
    await syncUserModelRuntimeConfig({
      userId: req.user!.id,
      email: req.user!.email ?? `${req.user!.id}@local.invalid`,
      modelKey: agent.model_key,
    });
  }

  let activeThreadId = threadId;
  let openclawSessionId: string | undefined;
  let managedUsageEventId: string | null = null;

  if (threadId) {
    const thread = await db.query(`select * from chat_threads where id = $1 and user_id = $2`, [
      threadId,
      req.user!.id,
    ]);

    if (!thread.rows[0]) {
      return res.status(404).json({ error: 'not_found', message: 'Thread not found' });
    }

    openclawSessionId = thread.rows[0].openclaw_session_id;
  } else {
    const created = await db.query(
      `insert into chat_threads (user_id, openclaw_session_id, title) values ($1, $2, $3) returning *`,
      [req.user!.id, `resp_${Date.now()}`, (trimmedMessage || normalizedAttachments[0]?.name || 'Document summary').slice(0, 60)]
    );
    activeThreadId = created.rows[0].id;
    openclawSessionId = created.rows[0].openclaw_session_id;
  }

  const historyResult = await db.query(
    `select role, content
     from chat_messages
     where thread_id = $1
     order by created_at asc`,
    [activeThreadId]
  );

  const attachmentSummary = normalizedAttachments.length
    ? `Attached ${normalizedAttachments.length} document${normalizedAttachments.length === 1 ? '' : 's'}: ${normalizedAttachments.map((attachment) => attachment.name).join(', ')}`
    : '';
  const storedUserMessage = [trimmedMessage || (normalizedAttachments.length ? 'Summarize this document.' : ''), attachmentSummary]
    .filter(Boolean)
    .join('\n\n');
  const effectiveMessage = [
    trimmedMessage || 'Please summarize the attached document and highlight the most important points for studying.',
    normalizedAttachments.length ? `Use the following uploaded document content in your answer.\n\n${buildAttachmentPrompt(normalizedAttachments)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  await db.query(`insert into chat_messages (thread_id, role, content, metadata_json) values ($1, 'user', $2, $3)`, [
    activeThreadId,
    storedUserMessage,
    JSON.stringify({
      studyMode: studyMode ?? 'general',
      attachments: normalizedAttachments.map((attachment) => ({ name: attachment.name, type: attachment.type })),
    }),
  ]);

  async function ensureManagedUsageReservation(feature: string, metadata: Record<string, unknown> = {}) {
    if (isAdmin || managedUsageEventId) {
      return;
    }

    if (!agent) {
      throw new Error('StudyClaw agent profile is unavailable for quota tracking.');
    }

    const reservation = await reserveManagedUsageEvent({
      userId: req.user!.id,
      feature,
      modelKey: agent.model_key,
      eventKey: `chat:${activeThreadId}:${feature}:${randomUUID()}`,
      metadata: {
        threadId: activeThreadId,
        ...metadata,
      },
    });
    managedUsageEventId = reservation.eventId;
  }

  async function completeManagedUsage(success: boolean, metadata: Record<string, unknown> = {}) {
    if (!managedUsageEventId) {
      return;
    }

    const eventId = managedUsageEventId;
    managedUsageEventId = null;
    await finalizeManagedUsageEvent({
      eventId,
      success,
      metadata: {
        threadId: activeThreadId,
        ...metadata,
      },
    });
  }

  try {
    const context = isAdmin
      ? { profile: null, subjects: [], reminders: [], memory: { courses: [], topics: [], assignments: [], matchedCourseIds: [], matchedTopicIds: [], memories: [], snapshots: [] }, calendar: { status: 'not_connected' as const, items: [] } }
      : await buildStudyContext(req.user!.id, { query: effectiveMessage });
    const reminderStatusReply = trimmedMessage
      ? await tryHandleReminderStatusQuestion({
          userId: req.user!.id,
          message: trimmedMessage,
          timezone: context.profile?.timezone ?? null,
        }).catch(() => null)
      : null;

    if (reminderStatusReply?.assistantText) {
      const assistantText = normalizeAssistantIdentity(reminderStatusReply.assistantText, agent.persona_name);

      await db.query(
        `insert into chat_messages (thread_id, role, content, metadata_json) values ($1, 'assistant', $2, $3)`,
        [
          activeThreadId,
          assistantText,
          JSON.stringify({
            ...(reminderStatusReply.metadata ?? {}),
            capabilityBadges: buildAssistantCapabilityBadges({
              reminderLookup: true,
            }),
          }),
        ]
      );
      await db.query(`update chat_threads set last_message_at = now() where id = $1`, [activeThreadId]);

      return res.json({
        threadId: activeThreadId,
        openclawSessionId,
        assistantMessage: assistantText,
      });
    }

    const reminderIntent = trimmedMessage
      ? await (async () => {
          await ensureManagedUsageReservation('chat-reminder-intent', {
            attachmentCount: normalizedAttachments.length,
          });
          return tryHandleReminderIntent({
            userId: req.user!.id,
            message: trimmedMessage,
            modelKey: agent.model_key,
            timezone: context.profile?.timezone ?? null,
            threadId: activeThreadId!,
          }).catch(() => null);
        })()
      : null;

    const fallbackReminderIntent =
      !reminderIntent?.shouldCreate && trimmedMessage
        ? tryParseReminderIntentFallback({
            message: trimmedMessage,
            timezone: context.profile?.timezone ?? null,
          })
        : null;

    if (
      looksLikeReminderIntent(trimmedMessage) &&
      !reminderIntent?.shouldCreate &&
      !fallbackReminderIntent?.shouldCreate
    ) {
      const assistantText = normalizeAssistantIdentity(buildMissingReminderTimeReply(), agent.persona_name);

      await db.query(
        `insert into chat_messages (thread_id, role, content, metadata_json) values ($1, 'assistant', $2, $3)`,
        [
          activeThreadId,
          assistantText,
          JSON.stringify({
            reminderRequested: true,
            reminderCreated: false,
            missingFields: ['time'],
            capabilityBadges: buildAssistantCapabilityBadges({}),
          }),
        ]
      );
      await db.query(`update chat_threads set last_message_at = now() where id = $1`, [activeThreadId]);

      return res.json({
        threadId: activeThreadId,
        openclawSessionId,
        assistantMessage: assistantText,
        artifacts: [],
      });
    }

    const resolvedReminderIntent =
      reminderIntent?.shouldCreate && reminderIntent.reminderAtIso && reminderIntent.title
        ? reminderIntent
        : fallbackReminderIntent?.shouldCreate &&
            fallbackReminderIntent.reminderAtIso &&
            fallbackReminderIntent.title &&
            fallbackReminderIntent.reminderType
          ? {
              ...fallbackReminderIntent,
              createdReminder: await createReminderRecord({
                userId: req.user!.id,
                title: fallbackReminderIntent.title,
                reminderType: fallbackReminderIntent.reminderType,
                reminderAtIso: fallbackReminderIntent.reminderAtIso,
                assumedTimezone: fallbackReminderIntent.assumedTimezone ?? context.profile?.timezone ?? 'America/New_York',
                originalMessage: trimmedMessage,
                sourceThreadId: activeThreadId!,
              }),
            }
          : null;

    if (resolvedReminderIntent?.shouldCreate && resolvedReminderIntent.reminderAtIso && resolvedReminderIntent.title) {
      const assistantText = normalizeAssistantIdentity(
        resolvedReminderIntent.confirmation ||
          `I scheduled "${resolvedReminderIntent.title}" for ${new Date(resolvedReminderIntent.reminderAtIso).toISOString()}.`,
        agent.persona_name
      );

      await db.query(
        `insert into chat_messages (thread_id, role, content, metadata_json) values ($1, 'assistant', $2, $3)`,
        [
          activeThreadId,
          assistantText,
          JSON.stringify({
            reminderCreated: true,
            reminderAtIso: resolvedReminderIntent.reminderAtIso,
            reminderType: resolvedReminderIntent.reminderType,
            capabilityBadges: buildAssistantCapabilityBadges({
              reminderCreated: true,
            }),
          }),
        ]
      );
      await db.query(`update chat_threads set last_message_at = now() where id = $1`, [activeThreadId]);
      if (studentAgent) {
        await db.query(
          `insert into agent_actions (agent_id, action_type, summary, payload)
           values ($1, $2, $3, $4)`,
          [
            studentAgent.id,
            'reminder_created',
            `Created reminder "${resolvedReminderIntent.title}" from chat.`,
            JSON.stringify({
              threadId: activeThreadId,
              reminderAtIso: resolvedReminderIntent.reminderAtIso,
              reminderType: resolvedReminderIntent.reminderType,
            }),
          ]
        );
      }
      if ((resolvedReminderIntent as any).createdReminder?.id) {
        const createdReminder = (resolvedReminderIntent as any).createdReminder;
        await recordStudyEvent({
          userId: req.user!.id,
          eventKey: `chat-reminder:${createdReminder.id}`,
          eventType: 'reminder_created',
          sourceType: 'reminder',
          sourceId: createdReminder.id,
          payload: {
            title: createdReminder.title,
            reminderType: createdReminder.type,
          },
        });
        const assignment = await upsertAssignmentFromReminder({
          userId: req.user!.id,
          reminderId: createdReminder.id,
          title: createdReminder.title,
          type: createdReminder.type,
          reminderAt: createdReminder.reminder_at,
          status: createdReminder.status,
          metadata: createdReminder.metadata_json ?? {},
        });
        if (assignment) {
          await writeMemorySummary({
            userId: req.user!.id,
            summaryType: 'assignment_tracking',
            summary: `Student is tracking ${assignment.title} as ${assignment.status}.`,
            courseId: assignment.course_id ?? null,
            summaryKey: `assignment:${assignment.id}:tracking`,
            importance: 4,
          });
        }
      }
      await completeManagedUsage(true, {
        outcome: 'reminder_created',
      });

      return res.json({
        threadId: activeThreadId,
        openclawSessionId,
        assistantMessage: assistantText,
        artifacts: [
          {
            type: 'reminder',
            title: resolvedReminderIntent.title,
            reminderAt: resolvedReminderIntent.reminderAtIso,
            reminderType: resolvedReminderIntent.reminderType,
          },
        ],
      });
    }

    await ensureManagedUsageReservation('chat', {
      attachmentCount: normalizedAttachments.length,
    });
    if (!isAdmin) {
      await syncGoogleSkillForUser(req.user!.id).catch(() => undefined);
    }
    const reply = await openclaw.sendMessage({
      agentId: agent.openclaw_agent_id,
      instructions: buildStudyInstructions(agent.system_prompt, context),
      sessionId: openclawSessionId,
      message: buildChatTranscript(historyResult.rows, effectiveMessage),
      model: agent.model_key,
      metadata: {
        feature: 'chat',
        threadId: activeThreadId,
      },
      userId: req.user!.id,
    });
    const assistantText = normalizeAssistantIdentity(reply.text, agent.persona_name);
    const researchResult = isResearchRequest ? buildResearchResultCard(assistantText, reply.raw) : null;
    const assistantMetadata = {
      openclaw: reply.raw,
      capabilityBadges: buildAssistantCapabilityBadges({
        isResearchRequest,
        hasAttachments: normalizedAttachments.length > 0,
        researchResult,
      }),
      ...(researchResult ? { researchResult } : {}),
    };

    await db.query(
      `insert into chat_messages (thread_id, role, content, metadata_json) values ($1, 'assistant', $2, $3)`,
      [activeThreadId, assistantText, JSON.stringify(assistantMetadata)]
    );
    const assistantMessageResult = await db.query(
      `select id, role, content, metadata_json
       from chat_messages
       where thread_id = $1
       order by created_at desc
       limit 1`,
      [activeThreadId]
    );
    await db.query(`update chat_threads set last_message_at = now(), openclaw_session_id = $2 where id = $1`, [
      activeThreadId,
      reply.sessionId,
    ]);
    if (studentAgent) {
      await db.query(
        `insert into agent_actions (agent_id, action_type, summary, payload)
         values ($1, $2, $3, $4)`,
        [
          studentAgent.id,
          'chat_reply',
          `Replied in chat thread ${activeThreadId}.`,
          JSON.stringify({
            threadId: activeThreadId,
            openclawSessionId: reply.sessionId,
          }),
        ]
      );
    }
    await recordStudyEvent({
      userId: req.user!.id,
      eventKey: `chat:${activeThreadId}:${assistantMessageResult.rows[0]?.id ?? reply.sessionId}`,
      eventType: isResearchRequest ? 'research_chat_reply' : 'chat_reply',
      sourceType: 'chat_thread',
      sourceId: activeThreadId,
      payload: {
        studyMode: studyMode ?? 'general',
        usedResearch: isResearchRequest,
        attachmentCount: normalizedAttachments.length,
      },
    });
    const weakAreaSummary = trimmedMessage ? inferWeakAreaSummary(trimmedMessage) : null;
    if (weakAreaSummary) {
      await writeMemorySummary({
        userId: req.user!.id,
        summaryType: 'weak_area',
        summary: weakAreaSummary,
        summaryKey: `weak-area:${req.user!.id}:${weakAreaSummary.toLowerCase()}`,
        importance: 5,
      });
    }
    const preferenceSummary = trimmedMessage ? inferPreferenceSummary(trimmedMessage) : null;
    if (preferenceSummary) {
      await writeMemorySummary({
        userId: req.user!.id,
        summaryType: 'learning_preference',
        summary: preferenceSummary,
        summaryKey: `preference:${req.user!.id}:${preferenceSummary.toLowerCase()}`,
        importance: 5,
      });
    }

    if (!isAdmin && !context.profile?.onboarding_complete) {
      await syncBootstrapProfile(req.user!.id, activeThreadId!, agent.model_key);
    }
    await completeManagedUsage(true, {
      outcome: 'chat_reply',
      openclawSessionId: reply.sessionId,
    });

    return res.json({
      threadId: activeThreadId,
      openclawSessionId: reply.sessionId,
      assistantMessage: assistantText,
      assistantEntry: assistantMessageResult.rows[0] ?? null,
      raw: reply.raw,
      artifacts: researchResult
        ? [
            {
              type: 'research_result',
              title: researchResult.title,
              sourceCount: researchResult.sources.length,
              hasScreenshot: Boolean(researchResult.screenshotUrl),
            },
          ]
        : [],
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Unknown OpenClaw error';
    await completeManagedUsage(false, {
      error: messageText,
    });
    if (studentAgent) {
      await db.query(
        `insert into agent_actions (agent_id, action_type, summary, payload)
         values ($1, $2, $3, $4)`,
        [
          studentAgent.id,
          'chat_error',
          'OpenClaw chat request failed.',
          JSON.stringify({ error: messageText }),
        ]
      );
    }
    if (error instanceof ManagedUsageLimitError) {
      return res.status(error.statusCode).json({
        error: error.code,
        message: error.message,
        detail: error.detail,
      });
    }
    return res.status(502).json({ error: 'openclaw_error', message: messageText });
  }
});
