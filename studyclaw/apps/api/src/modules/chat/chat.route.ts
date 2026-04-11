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

export const chatRouter = Router();
chatRouter.use(requireAuth);

const openclaw = new OpenClawClient();

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
  const { threadId, message } = req.body as { threadId?: string; message?: string };

  if (!message?.trim()) {
    return res.status(400).json({ error: 'bad_request', message: 'message is required' });
  }

  // Guard: block chat until onboarding is complete
  const credentialCheck = await db.query(
    `select api_key
     from user_model_credentials
     where user_id = $1
     limit 1`,
    [req.user!.id]
  );
  if (!credentialCheck.rows[0]?.api_key) {
    return res.status(403).json({ error: 'onboarding_required', message: 'Complete onboarding first: choose your tier, companion, and model.' });
  }

  const agent = await loadAgentProfile(req.user!.id);
  const studentAgentResult = await db.query(`select * from agents where user_id = $1`, [req.user!.id]);
  const studentAgent = studentAgentResult.rows[0];

  if (!agent || !studentAgent) {
    return res.status(400).json({ error: 'missing_agent', message: 'Complete onboarding first' });
  }

  // Rolling 5-hour credit window check
  const profileResult = await db.query(
    `select tier, messages_sent, window_start from student_profiles where user_id = $1`,
    [req.user!.id]
  );
  const profile = profileResult.rows[0];
  const tierLimits: Record<number, number> = {
    1: Number(process.env.STUDYCLAW_TIER1_LIMIT ?? 1000),
    2: Number(process.env.STUDYCLAW_TIER2_LIMIT ?? 3000),
    3: Number(process.env.STUDYCLAW_TIER3_LIMIT ?? 5000),
  };
  const limit = tierLimits[profile?.tier ?? 1] ?? 1000;
  const resetHours = Number(process.env.STUDYCLAW_RESET_INTERVAL_HOURS ?? 5);
  const windowStart = profile?.window_start ? new Date(profile.window_start) : null;
  const now = new Date();
  const windowExpired = !windowStart || (now.getTime() - windowStart.getTime()) > resetHours * 60 * 60 * 1000;
  const messagesSent = windowExpired ? 0 : (profile?.messages_sent ?? 0);

  if (messagesSent >= limit) {
    const resetAt = windowStart
      ? new Date(windowStart.getTime() + resetHours * 60 * 60 * 1000)
      : null;
    const minutesLeft = resetAt ? Math.max(0, Math.ceil((resetAt.getTime() - now.getTime()) / 60000)) : resetHours * 60;
    return res.status(429).json({
      error: 'quota_reached',
      message: `Out of credits — your window resets in ${minutesLeft} minutes. Consider upgrading your tier for more credits.`,
      minutesLeft,
      resetAt: resetAt?.toISOString() ?? null,
    });
  }

  // Increment message counter (reset window if expired)
  if (windowExpired) {
    await db.query(
      `update student_profiles set messages_sent = 1, window_start = now() where user_id = $1`,
      [req.user!.id]
    );
  } else {
    await db.query(
      `update student_profiles set messages_sent = messages_sent + 1 where user_id = $1`,
      [req.user!.id]
    );
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
      [req.user!.id, `resp_${Date.now()}`, message.trim().slice(0, 60)]
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

  await db.query(`insert into chat_messages (thread_id, role, content) values ($1, 'user', $2)`, [activeThreadId, message]);

  try {
    const context = await buildStudyContext(req.user!.id);
    const reply = await openclaw.sendMessage({
      agentId: agent.openclaw_agent_id,
      instructions: buildStudyInstructions(agent.system_prompt, context),
      sessionId: openclawSessionId,
      message: buildChatTranscript(historyResult.rows, message),
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

    if (!context.profile?.onboarding_complete) {
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
    return res.status(502).json({ error: 'openclaw_error', message: messageText });
  }
});
