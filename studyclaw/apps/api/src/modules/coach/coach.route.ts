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

function normalizeSectionName(value: unknown) {
  const cleaned = String(value ?? '').trim();
  return cleaned || 'Unsorted';
}

function inferAssetType(
  sourceType: string | undefined,
  title: string | undefined,
  attachments: Array<{ name?: string; type?: string }>
) {
  const normalizedSource = String(sourceType ?? '').toLowerCase();
  const attachmentTypes = attachments.map((item) => String(item.type ?? '').toLowerCase());
  const attachmentNames = attachments.map((item) => String(item.name ?? '').toLowerCase());
  const titleName = String(title ?? '').toLowerCase();

  if (
    normalizedSource === 'audio' ||
    attachmentTypes.some((value) => value.startsWith('audio/')) ||
    attachmentNames.some((value) => /\.(mp3|m4a|wav|aac|ogg)$/.test(value))
  ) {
    return 'audio_note';
  }

  if (
    normalizedSource === 'photo' ||
    attachmentTypes.some((value) => value.startsWith('image/')) ||
    attachmentNames.some((value) => /\.(png|jpg|jpeg|gif|webp|heic)$/.test(value))
  ) {
    return 'image_note';
  }

  if (
    attachmentTypes.some((value) => value.includes('pdf')) ||
    attachmentNames.some((value) => value.endsWith('.pdf')) ||
    titleName.endsWith('.pdf')
  ) {
    return 'uploaded_pdf';
  }

  return 'typed_note';
}

async function getStudentAgentRecord(userId: string) {
  const result = await db.query(`select id from agents where user_id = $1`, [userId]);
  return result.rows[0] ?? null;
}

async function findOrCreateSubject(userId: string, sectionName: string) {
  if (sectionName === 'Unsorted') {
    return null;
  }

  const existing = await db.query(
    `select id, name
     from subjects
     where user_id = $1 and lower(name) = lower($2)
     limit 1`,
    [userId, sectionName]
  );

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const inserted = await db.query(
    `insert into subjects (user_id, name)
     values ($1, $2)
     on conflict (user_id, name) do update set name = excluded.name
     returning id, name`,
    [userId, sectionName]
  );

  return inserted.rows[0] ?? null;
}

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

export const coachRouter = Router();

coachRouter.use(requireAuth);

coachRouter.get('/knowledge', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
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
  await ensurePlatformSchema();
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

coachRouter.get('/assets', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();

  const result = await db.query(
    `select sa.id,
            sa.title,
            sa.original_text,
            sa.processed_text,
            sa.asset_type,
            sa.metadata_json,
            sa.created_at,
            sa.updated_at,
            sa.subject_id,
            s.name as subject_name
     from study_assets sa
     left join subjects s on s.id = sa.subject_id
     where sa.user_id = $1
       and sa.asset_type in ('typed_note', 'image_note', 'audio_note', 'uploaded_pdf')
     order by coalesce(s.name, sa.metadata_json->>'sectionName', 'Unsorted') asc, sa.created_at desc`,
    [req.user!.id]
  );

  res.json(
    result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      originalText: row.original_text ?? '',
      processedText: row.processed_text ?? '',
      assetType: row.asset_type,
      metadata: row.metadata_json ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      subjectId: row.subject_id,
      sectionName: row.subject_name || row.metadata_json?.sectionName || 'Unsorted',
    }))
  );
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
  const studentAgent = await getStudentAgentRecord(req.user!.id);
  if (!agent || !studentAgent) {
    return res.status(400).json({ error: 'missing_agent', message: 'Complete onboarding first' });
  }

  const prompt = `
You are StudyClaw's academic coach.
Take the uploaded student note content and return valid JSON only in this format:
{
  "section": "best-fit course, class, or section name",
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
Infer the best section or course name from the content. If you cannot tell, use "Unsorted".

Source type: ${sourceType}
Attachments: ${attachments.map((item) => `${item.name ?? 'unknown'} (${item.type ?? 'unknown'})`).join(', ') || 'none'}

Student content:
${text}
`;

  const context = await buildStudyContext(req.user!.id);

  try {
    const reply = await openclaw.sendMessage({
      agentId: agent.openclaw_agent_id,
      instructions: buildStudyInstructions(agent.system_prompt, context),
      message: prompt,
      model: agent.model_key,
      metadata: {
        feature: 'coach-process',
        sourceType,
        attachmentCount: attachments.length,
      },
      userId: req.user!.id,
    });

    const parsed = parseJsonBlock(reply.text);
    const sectionName = normalizeSectionName(parsed.section);
    const subject = await findOrCreateSubject(req.user!.id, sectionName);
    const assetType = inferAssetType(sourceType, title, attachments);
    const transcript = parsed.transcript || text.trim();
    const summary = parsed.summary || text.trim().slice(0, 280);
    const actionItems = Array.isArray(parsed.actionItems) ? parsed.actionItems : [];
    const knowledge = Array.isArray(parsed.knowledge) ? parsed.knowledge : [];
    const savedAsset = await db.query(
      `insert into study_assets (user_id, subject_id, asset_type, title, original_text, processed_text, metadata_json)
       values ($1, $2, $3::asset_type, $4, $5, $6, $7)
       returning id, title, original_text, processed_text, asset_type, metadata_json, created_at, updated_at, subject_id`,
      [
        req.user!.id,
        subject?.id ?? null,
        assetType,
        title,
        text.trim(),
        transcript,
        JSON.stringify({
          sourceType,
          attachments,
          sectionName,
          summary,
          actionItems,
          knowledge,
        }),
      ]
    );
    await db.query(
      `insert into agent_actions (agent_id, action_type, summary, payload)
       values ($1, $2, $3, $4)`,
      [
        studentAgent.id,
        'coach_processed_note',
        `Processed coach note ${title}.`,
        JSON.stringify({
          sourceType,
          attachmentCount: attachments.length,
          sectionName,
          assetId: savedAsset.rows[0]?.id ?? null,
        }),
      ]
    );
    res.json({
      assetId: savedAsset.rows[0]?.id ?? null,
      sectionName,
      transcript,
      summary,
      actionItems,
      knowledge,
    });
  } catch {
    const sectionName = 'Unsorted';
    const assetType = inferAssetType(sourceType, title, attachments);
    const fallbackTranscript = text.trim();
    const fallbackSummary = text.trim().slice(0, 280);
    const fallbackActionItems = [
      'Review the cleaned note and split it into one due item and one study block.',
      'Save any course rule, schedule, or exam detail into coach knowledge.',
    ];
    const savedAsset = await db.query(
      `insert into study_assets (user_id, subject_id, asset_type, title, original_text, processed_text, metadata_json)
       values ($1, $2, $3::asset_type, $4, $5, $6, $7)
       returning id`,
      [
        req.user!.id,
        null,
        assetType,
        title,
        fallbackTranscript,
        fallbackTranscript,
        JSON.stringify({
          sourceType,
          attachments,
          sectionName,
          summary: fallbackSummary,
          actionItems: fallbackActionItems,
          knowledge: [],
        }),
      ]
    );
    await db.query(
      `insert into agent_actions (agent_id, action_type, summary, payload)
       values ($1, $2, $3, $4)`,
      [
        studentAgent.id,
        'coach_process_fallback',
        `Coach processing fell back for ${title}.`,
        JSON.stringify({
          sourceType,
          attachmentCount: attachments.length,
          sectionName,
          assetId: savedAsset.rows[0]?.id ?? null,
        }),
      ]
    );
    res.json({
      assetId: savedAsset.rows[0]?.id ?? null,
      sectionName,
      transcript: fallbackTranscript,
      summary: fallbackSummary,
      actionItems: fallbackActionItems,
      knowledge: [],
    });
  }
});
