import { Router } from 'express';
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
import { syncUserWorkspaceProfile } from '../../lib/user-agent';
import { ensurePlatformSchema } from '../../lib/platform-schema';
import { syncUserModelRuntimeConfig } from '../../lib/model-settings';

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

  return created.rows[0] ?? null;
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

chatRouter.post('/send', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const { threadId, message, attachments } = req.body as {
    threadId?: string;
    message?: string;
    attachments?: ChatAttachment[];
  };
  const normalizedAttachments = normalizeAttachments(attachments);
  const trimmedMessage = message?.trim() ?? '';

  if (!trimmedMessage && !normalizedAttachments.length) {
    return res.status(400).json({ error: 'bad_request', message: 'message or document text is required' });
  }

  const isAdmin = req.user?.role === 'admin';

  if (!isAdmin) {
    const credentialCheck = await db.query(
      `select api_key
       from user_model_credentials
       where user_id = $1
       limit 1`,
      [req.user!.id]
    );
    if (!credentialCheck.rows[0]?.api_key) {
      return res.status(403).json({ error: 'onboarding_required', message: 'Complete onboarding first: choose Dixie or Willow and enter your API key.' });
    }
  }

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

  if (!isAdmin && studentAgent) {
    const quotaResult = await db.query(
      `select count(*)::int as count
       from agent_actions aa
       where aa.agent_id = $1
         and aa.created_at >= date_trunc('day', now())`,
      [studentAgent.id]
    );
    const usedToday = quotaResult.rows[0]?.count ?? 0;
    const dailyQuota = Number(process.env.STUDYCLAW_STUDENT_DAILY_AGENT_ACTIONS ?? 150);
    if (usedToday >= dailyQuota) {
      return res.status(429).json({
        error: 'quota_reached',
        message: `Daily agent quota reached (${usedToday}/${dailyQuota}).`,
      });
    }
  }

  let activeThreadId = threadId;
  let openclawSessionId: string | undefined;

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
      attachments: normalizedAttachments.map((attachment) => ({ name: attachment.name, type: attachment.type })),
    }),
  ]);

  try {
    const context = isAdmin
      ? { profile: null, subjects: [], reminders: [] }
      : await buildStudyContext(req.user!.id);
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
        [activeThreadId, assistantText, JSON.stringify(reminderStatusReply.metadata ?? {})]
      );
      await db.query(`update chat_threads set last_message_at = now() where id = $1`, [activeThreadId]);

      return res.json({
        threadId: activeThreadId,
        openclawSessionId,
        assistantMessage: assistantText,
      });
    }

    const reminderIntent = trimmedMessage
      ? await tryHandleReminderIntent({
          userId: req.user!.id,
          message: trimmedMessage,
          modelKey: agent.model_key,
          timezone: context.profile?.timezone ?? null,
          threadId: activeThreadId!,
        }).catch(() => null)
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

    await db.query(
      `insert into chat_messages (thread_id, role, content, metadata_json) values ($1, 'assistant', $2, $3)`,
      [activeThreadId, assistantText, JSON.stringify({ openclaw: reply.raw })]
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

    if (!isAdmin && !context.profile?.onboarding_complete) {
      await syncBootstrapProfile(req.user!.id, activeThreadId!, agent.model_key);
    }

    return res.json({
      threadId: activeThreadId,
      openclawSessionId: reply.sessionId,
      assistantMessage: assistantText,
      raw: reply.raw,
      artifacts: [],
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Unknown OpenClaw error';
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
    return res.status(502).json({ error: 'openclaw_error', message: messageText });
  }
});
