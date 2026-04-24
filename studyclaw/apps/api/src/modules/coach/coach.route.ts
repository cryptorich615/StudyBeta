import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { db } from '../../lib/db';
import { OpenClawClient } from '../../integrations/openclaw/openclaw.client';
import {
  buildStudyContext,
  buildStudyInstructions,
  loadAgentProfile,
} from '../../lib/study-context';
import { ensurePlatformSchema } from '../../lib/platform-schema';

const openclaw = new OpenClawClient();
const COACH_PROCESS_TIMEOUT_MS = 15_000;

async function ensureCoachKnowledgeTable() {
  await db.query(`
    create table if not exists coach_knowledge_items (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      title text not null,
      detail text not null,
      source_type text not null default 'note',
      metadata_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )
  `);
}

function parseJsonBlock(value: string) {
  const cleaned = value
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  return JSON.parse(cleaned);
}

function resolveActionItemReminderAt(preset: string) {
  const now = new Date();
  const target = new Date(now);

  if (preset === 'tomorrow_evening') {
    target.setDate(target.getDate() + 1);
    target.setHours(18, 0, 0, 0);
    return target.toISOString();
  }

  if (preset === 'this_weekend') {
    const day = target.getDay();
    const daysUntilSaturday = (6 - day + 7) % 7 || 7;
    target.setDate(target.getDate() + daysUntilSaturday);
    target.setHours(10, 0, 0, 0);
    return target.toISOString();
  }

  target.setHours(18, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.toISOString();
}

async function persistCoachAsset(input: {
  userId: string;
  title: string;
  originalText: string;
  processedText: string;
  sourceType: string;
  summary?: string | null;
  actionItems?: string[];
  knowledge?: Array<Record<string, unknown>>;
  attachments?: Array<{ name?: string; type?: string }>;
}) {
  const result = await db.query(
    `insert into study_assets (user_id, title, original_text, processed_text, asset_type, metadata_json)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      input.userId,
      input.title,
      input.originalText,
      input.processedText,
      'typed_note',
      JSON.stringify({
        source: 'coach_process',
        sourceType: input.sourceType,
        summary: input.summary ?? null,
        actionItems: input.actionItems ?? [],
        knowledge: input.knowledge ?? [],
        attachments: input.attachments ?? [],
      }),
    ]
  );

  return String(result.rows[0]?.id ?? '');
}

export const coachRouter = Router();

coachRouter.use(requireAuth);

coachRouter.get('/assets', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();

  const [assetResult, nativeFilesResult] = await Promise.all([
    db.query(
      `select
         sa.id,
         sa.title,
         sa.original_text,
         sa.processed_text,
         sa.asset_type,
         sa.metadata_json,
         sa.created_at,
         sa.updated_at,
         sa.subject_id,
         coalesce(s.name, sa.section_name, 'Unsorted') as section_name
       from study_assets sa
       left join subjects s on s.id = sa.subject_id
       where sa.user_id = $1
       order by sa.updated_at desc, sa.created_at desc`,
      [req.user!.id]
    ).catch(async () => {
      // Older databases may not have every newer column. Fall back to a narrower shape.
      return db.query(
        `select
           sa.id,
           sa.title,
           sa.original_text,
           sa.processed_text,
           sa.asset_type,
           sa.metadata_json,
           sa.created_at,
           sa.updated_at,
           sa.subject_id,
           'Unsorted'::text as section_name
         from study_assets sa
         where sa.user_id = $1
         order by sa.updated_at desc nulls last, sa.created_at desc`,
        [req.user!.id]
      );
    }),
    db.query(
      `select id, name, file_type, content, metadata_json, created_at, updated_at
       from studyclaw_files
       where user_id = $1
       order by updated_at desc, created_at desc`,
      [req.user!.id]
    ),
  ]);

  res.json({
    assets: assetResult.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title ?? 'Untitled note'),
      originalText: String(row.original_text ?? ''),
      processedText: String(row.processed_text ?? ''),
      assetType: String(row.asset_type ?? 'typed_note'),
      metadata: (row.metadata_json ?? {}) as Record<string, unknown>,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      subjectId: row.subject_id ?? null,
      sectionName: String(row.section_name ?? 'Unsorted'),
      source: 'backpack' as const,
    })),
    nativeFiles: nativeFilesResult.rows.map((row) => ({
      id: String(row.id),
      title: String(row.name ?? 'Untitled file'),
      originalText: String(row.content ?? ''),
      processedText: String(row.content ?? ''),
      assetType: `studyclaw_${String(row.file_type ?? 'note')}`,
      metadata: (row.metadata_json ?? {}) as Record<string, unknown>,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      subjectId: null,
      sectionName: 'StudyClaw Drive',
      source: 'native-file' as const,
      fileType: String(row.file_type ?? 'note'),
    })),
  });
});

coachRouter.get('/knowledge', async (req: AuthedRequest, res) => {
  await ensureCoachKnowledgeTable();
  const result = await db.query(
    `select id, title, detail, source_type, metadata_json, created_at
     from coach_knowledge_items
     where user_id = $1
     order by created_at desc
     limit 20`,
    [req.user!.id]
  );

  res.json(result.rows);
});

coachRouter.post('/knowledge', async (req: AuthedRequest, res) => {
  await ensureCoachKnowledgeTable();
  const { title, detail, sourceType = 'note', metadata = {} } = req.body as {
    title?: string;
    detail?: string;
    sourceType?: string;
    metadata?: Record<string, unknown>;
  };

  if (!title || !detail) {
    return res.status(400).json({ error: 'bad_request', message: 'title and detail are required' });
  }

  const result = await db.query(
    `insert into coach_knowledge_items (user_id, title, detail, source_type, metadata_json)
     values ($1, $2, $3, $4, $5)
     returning id, title, detail, source_type, metadata_json, created_at`,
    [req.user!.id, title, detail, sourceType, JSON.stringify(metadata)]
  );

  res.status(201).json(result.rows[0]);
});

coachRouter.post('/process', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const { title, text, sourceType = 'document', attachments = [] } = req.body as {
    title?: string;
    text?: string;
    sourceType?: string;
    attachments?: Array<{ name?: string; type?: string }>;
  };

  if (!title || !text?.trim()) {
    return res.status(400).json({ error: 'bad_request', message: 'title and text are required' });
  }

  const agent = await loadAgentProfile(req.user!.id);
  const studentAgentResult = await db.query(`select id from agents where user_id = $1`, [req.user!.id]);
  const studentAgent = studentAgentResult.rows[0];
  if (!agent || !studentAgent) {
    return res.status(400).json({ error: 'missing_agent', message: 'Complete onboarding first' });
  }

  const prompt = `
You are StudyClaw's academic coach.
Take the uploaded student note content and return valid JSON only in this format:
{
  "transcript": "cleaned transcript or extracted text",
  "summary": "one concise paragraph",
  "actionItems": ["next step"],
  "knowledge": [
    { "title": "knowledge title", "detail": "short detail", "kind": "logistics|preference|fact" }
  ]
}

Preserve meaning, remove noise, and emphasize organization.
If the text already looks like a transcript, clean it rather than rewriting it heavily.
Create between 2 and 5 action items.
Create between 1 and 4 knowledge items.

Source type: ${sourceType}
Attachments: ${attachments.map((item) => `${item.name ?? 'unknown'} (${item.type ?? 'unknown'})`).join(', ') || 'none'}

Student content:
${text}
`;

  const context = await buildStudyContext(req.user!.id);

  try {
    const reply = await Promise.race([
      openclaw.sendMessage({
        agentId: agent.openclaw_agent_id,
        instructions: buildStudyInstructions(agent.system_prompt, context),
        message: prompt,
        model: agent.model_key,
        metadata: {
          feature: 'coach-process',
          sourceType,
          attachmentCount: attachments.length,
          googleConnected: context.workspace.googleConnected,
          workspaceCalendarBackend: context.workspace.calendarBackend,
          workspaceDocumentBackend: context.workspace.documentBackend,
          nativeCalendarEvents: context.workspace.nativeCalendarEvents,
          nativeFiles: context.workspace.nativeFiles,
        },
        userId: req.user!.id,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Coach processing timed out after ${COACH_PROCESS_TIMEOUT_MS}ms`));
        }, COACH_PROCESS_TIMEOUT_MS);
      }),
    ]);

    const parsed = parseJsonBlock(reply.text);
    const transcript = parsed.transcript || text.trim();
    const summary = parsed.summary || text.trim().slice(0, 280);
    const actionItems = parsed.actionItems ?? [];
    const knowledge = parsed.knowledge ?? [];
    const assetId = await persistCoachAsset({
      userId: req.user!.id,
      title,
      originalText: text.trim(),
      processedText: transcript,
      sourceType,
      summary,
      actionItems,
      knowledge,
      attachments,
    });
    await db.query(
      `insert into agent_actions (agent_id, action_type, summary, payload)
       values ($1, $2, $3, $4)`,
      [
        studentAgent.id,
        'coach_processed_note',
        `Processed coach note ${title}.`,
        JSON.stringify({ sourceType, attachmentCount: attachments.length }),
      ]
    );
    res.json({
      assetId,
      transcript,
      summary,
      actionItems,
      knowledge,
    });
  } catch {
    const transcript = text.trim();
    const summary = text.trim().slice(0, 280);
    const actionItems = [
      'Review the cleaned note and split it into one due item and one study block.',
      'Save any course rule, schedule, or exam detail into coach knowledge.',
    ];
    const assetId = await persistCoachAsset({
      userId: req.user!.id,
      title,
      originalText: text.trim(),
      processedText: transcript,
      sourceType,
      summary,
      actionItems,
      knowledge: [],
      attachments,
    });
    await db.query(
      `insert into agent_actions (agent_id, action_type, summary, payload)
       values ($1, $2, $3, $4)`,
      [
        studentAgent.id,
        'coach_process_fallback',
        `Coach processing fell back for ${title}.`,
        JSON.stringify({ sourceType, attachmentCount: attachments.length }),
      ]
    );
    res.json({
      assetId,
      transcript,
      summary,
      actionItems,
      knowledge: [],
    });
  }
});

coachRouter.post('/assets/:assetId/action-items/reminder', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();

  const assetId = String(req.params.assetId ?? '').trim();
  const actionItem = String(req.body?.actionItem ?? '').trim();
  const schedulePreset = String(req.body?.schedulePreset ?? 'today_evening').trim();

  if (!assetId || !actionItem) {
    return res.status(400).json({ error: 'bad_request', message: 'assetId and actionItem are required' });
  }

  const assetResult = await db.query(
    `select id, title
     from study_assets
     where id = $1 and user_id = $2
     limit 1`,
    [assetId, req.user!.id]
  );

  if (!assetResult.rows[0]) {
    return res.status(404).json({ error: 'not_found', message: 'Backpack asset not found' });
  }

  const reminderAt = resolveActionItemReminderAt(schedulePreset);
  const reminderResult = await db.query(
    `insert into reminders (user_id, title, reminder_at, type, metadata_json)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [
      req.user!.id,
      actionItem,
      reminderAt,
      'assignment',
      JSON.stringify({
        source: 'coach_action_item',
        sourceAssetId: assetId,
        sourceAssetTitle: assetResult.rows[0].title,
        schedulePreset,
      }),
    ]
  );

  res.status(201).json({
    ok: true,
    reminderId: reminderResult.rows[0]?.id ?? null,
    reminderAt,
    message: 'Added to your task list.',
  });
});
