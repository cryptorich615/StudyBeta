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

function parseJsonBlock(value: string) {
  const cleaned = value
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  return JSON.parse(cleaned);
}

export const coachRouter = Router();

coachRouter.use(requireAuth);

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
      transcript: parsed.transcript || text.trim(),
      summary: parsed.summary || text.trim().slice(0, 280),
      actionItems: parsed.actionItems ?? [],
      knowledge: parsed.knowledge ?? [],
    });
  } catch {
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
      transcript: text.trim(),
      summary: text.trim().slice(0, 280),
      actionItems: [
        'Review the cleaned note and split it into one due item and one study block.',
        'Save any course rule, schedule, or exam detail into coach knowledge.',
      ],
      knowledge: [],
    });
  }
});
