import { randomUUID } from 'node:crypto';
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
import {
  ManagedUsageLimitError,
  finalizeManagedUsageEvent,
  reserveManagedUsageEvent,
} from '../../lib/managed-usage';
import {
  buildBackpackActionReminder,
  normalizeActionItemText,
  normalizeSchedulePreset,
} from '../../lib/backpack-action-items';
import { upsertCalendarEventForReminder } from '../../lib/google-service';
import {
  recordStudyEvent,
  updateTopicMastery,
  upsertAssignmentFromReminder,
  writeMemorySummary,
} from '../../lib/student-memory';

const openclaw = new OpenClawClient();
const ADMIN_COACH_PROFILE = {
  openclaw_agent_id: 'main',
  model_key: 'minimax/MiniMax-M2.7',
  system_prompt: [
    'You are StudyClaw Admin, the platform administrator agent.',
    'Help organize, summarize, and process uploaded materials with operational clarity.',
    'Prefer structured outputs and do not act like an unconfigured assistant.',
  ].join(' '),
  persona_name: 'StudyClaw Admin',
} as const;

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

coachRouter.post('/assets/:assetId/action-items/reminder', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  try {
    const { actionItem, schedulePreset } = req.body as {
      actionItem?: string;
      schedulePreset?: string;
    };

    const normalizedActionItem = normalizeActionItemText(actionItem);
    if (!normalizedActionItem) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'actionItem is required',
      });
    }

    const assetResult = await db.query(
      `select id, title, metadata_json
       from study_assets
       where id = $1
         and user_id = $2
       limit 1`,
      [req.params.assetId, req.user!.id]
    );

    const asset = assetResult.rows[0] as
      | { id: string; title: string; metadata_json?: { actionItems?: unknown; sectionName?: string } | null }
      | undefined;
    if (!asset) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Saved note not found',
      });
    }

    const savedActionItems = Array.isArray(asset.metadata_json?.actionItems)
      ? asset.metadata_json?.actionItems.map((item) => normalizeActionItemText(item)).filter(Boolean)
      : [];
    const matchedActionItem = savedActionItems.find((item) => item === normalizedActionItem);
    if (!matchedActionItem) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'That action item is no longer attached to this saved note',
      });
    }

    const profileResult = await db.query(
      `select timezone
       from student_profiles
       where user_id = $1
       limit 1`,
      [req.user!.id]
    );
    const timeZone = String(profileResult.rows[0]?.timezone ?? 'America/New_York');
    const normalizedPreset = normalizeSchedulePreset(schedulePreset);
    const reminderPlan = buildBackpackActionReminder({
      actionItem: matchedActionItem,
      schedulePreset: normalizedPreset,
      timeZone,
    });

    const duplicateResult = await db.query(
      `select id, title, reminder_at, status, metadata_json
       from reminders
       where user_id = $1
         and title = $2
         and type = 'study_session'
         and coalesce(metadata_json->>'source', '') = 'backpack_action_item'
         and coalesce(metadata_json->>'sourceAssetId', '') = $3
         and coalesce(metadata_json->>'actionItem', '') = $4
         and status <> 'completed'
       order by reminder_at asc
       limit 1`,
      [req.user!.id, reminderPlan.title, asset.id, matchedActionItem]
    );

    if (duplicateResult.rows[0]) {
      return res.status(200).json({
        ok: true,
        duplicate: true,
        reminder: duplicateResult.rows[0],
        message: 'This Backpack action item is already on your task list.',
      });
    }

    const reminderResult = await db.query(
      `insert into reminders (user_id, title, reminder_at, type, delivered, metadata_json)
       values ($1, $2, $3, 'study_session', false, $4)
       returning *`,
      [
        req.user!.id,
        reminderPlan.title,
        reminderPlan.reminderAt.toISOString(),
        JSON.stringify({
          source: 'backpack_action_item',
          sourceAssetId: asset.id,
          assetTitle: asset.title,
          sectionName: asset.metadata_json?.sectionName ?? 'Unsorted',
          actionItem: matchedActionItem,
          schedulePreset: normalizedPreset,
        }),
      ]
    );
    const reminder = reminderResult.rows[0];
    const syncedEvent = await upsertCalendarEventForReminder({
      userId: req.user!.id,
      title: reminder.title,
      reminderAt: reminder.reminder_at,
      type: reminder.type,
      metadata: reminder.metadata_json ?? {},
      timeZone,
    });
    const persistedReminder = syncedEvent
      ? (
          await db.query(
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
          )
        ).rows[0] ?? reminder
      : reminder;

    await recordStudyEvent({
      userId: req.user!.id,
      eventKey: `backpack-action:${asset.id}:${matchedActionItem}`,
      eventType: 'backpack_action_scheduled',
      sourceType: 'study_asset',
      sourceId: asset.id,
      payload: {
        actionItem: matchedActionItem,
        reminderId: persistedReminder.id,
        schedulePreset: normalizedPreset,
      },
    });
    await upsertAssignmentFromReminder({
      userId: req.user!.id,
      reminderId: persistedReminder.id,
      title: persistedReminder.title,
      type: persistedReminder.type,
      reminderAt: persistedReminder.reminder_at,
      status: persistedReminder.status,
      metadata: persistedReminder.metadata_json ?? {},
    });

    const studentAgent = await getStudentAgentRecord(req.user!.id);
    if (studentAgent) {
      await db.query(
        `insert into agent_actions (agent_id, action_type, summary, payload)
         values ($1, $2, $3, $4)`,
        [
          studentAgent.id,
          'coach_action_item_scheduled',
          `Scheduled Backpack action item "${reminderPlan.title}".`,
          JSON.stringify({
            assetId: asset.id,
            actionItem: matchedActionItem,
            schedulePreset: normalizedPreset,
            reminderAt: reminderPlan.reminderAt.toISOString(),
          }),
        ]
      );
    }

    return res.status(201).json({
      ok: true,
      duplicate: false,
      reminder: persistedReminder,
      message: 'Added to your task list.',
    });
  } catch (error) {
    console.error('[coach] failed to add action item to reminders', {
      userId: req.user!.id,
      assetId: req.params.assetId,
      message: error instanceof Error ? error.message : 'Unknown action-item reminder error',
    });
    return res.status(500).json({
      error: 'task_handoff_failed',
      message: 'StudyClaw could not add that action item to your task list right now. Please try again.',
    });
  }
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

  const isAdmin = req.user?.role === 'admin';
  const agent = isAdmin ? ADMIN_COACH_PROFILE : await loadAgentProfile(req.user!.id);
  const studentAgent = isAdmin ? null : await getStudentAgentRecord(req.user!.id);
  if (!agent || (!isAdmin && !studentAgent)) {
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

  const context = isAdmin
    ? { profile: null, subjects: [], reminders: [], memory: { courses: [], topics: [], assignments: [], matchedCourseIds: [], matchedTopicIds: [], memories: [], snapshots: [] }, calendar: { status: 'not_connected' as const, items: [] } }
    : await buildStudyContext(req.user!.id, { query: `${title}\n\n${text.slice(0, 600)}` });
  const usageReservation = isAdmin
    ? { eventId: null as string | null }
    : await reserveManagedUsageEvent({
        userId: req.user!.id,
        feature: 'coach-process',
        modelKey: agent.model_key,
        eventKey: `coach-process:${title}:${randomUUID()}`,
        metadata: {
          sourceType,
          attachmentCount: attachments.length,
        },
      });
  const usageEventId = usageReservation.eventId;

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
    if (studentAgent) {
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
    }
    const noteEvent = await recordStudyEvent({
      userId: req.user!.id,
      eventKey: `coach-process:${savedAsset.rows[0]?.id ?? title}`,
      eventType: 'note_processed',
      sourceType: 'study_asset',
      sourceId: savedAsset.rows[0]?.id ?? null,
      courseId: subject?.id ?? null,
      payload: {
        sectionName,
        sourceType,
        actionItemsCount: actionItems.length,
        knowledgeCount: knowledge.length,
      },
    });
    await updateTopicMastery({
      userId: req.user!.id,
      topicName: sectionName,
      courseId: subject?.id ?? null,
      delta: 0.02,
      sourceEventId: noteEvent.id,
      notes: 'Captured and processed Backpack note',
    });
    await writeMemorySummary({
      userId: req.user!.id,
      summaryType: 'note_processed',
      summary: `${sectionName === 'Unsorted' ? 'Student added a new study note' : `Student added new notes for ${sectionName}`}: ${summary}`,
      courseId: subject?.id ?? null,
      sourceEventId: noteEvent.id,
      summaryKey: `note:${savedAsset.rows[0]?.id ?? noteEvent.id}`,
      importance: 3,
    });
    for (const item of knowledge) {
      const titleText = String(item?.title ?? '').trim();
      const detailText = String(item?.detail ?? '').trim();
      const kindText = String(item?.kind ?? '').trim().toLowerCase();
      if (!titleText || !detailText) {
        continue;
      }

      if (kindText === 'preference' || kindText === 'logistics') {
        await writeMemorySummary({
          userId: req.user!.id,
          summaryType: kindText,
          summary: `${titleText}: ${detailText}`,
          courseId: subject?.id ?? null,
          sourceEventId: noteEvent.id,
          summaryKey: `knowledge:${savedAsset.rows[0]?.id ?? noteEvent.id}:${kindText}:${titleText.toLowerCase()}`,
          importance: kindText === 'preference' ? 5 : 4,
        });
      }
    }
    await finalizeManagedUsageEvent({
      eventId: usageEventId,
      success: true,
      metadata: {
        outcome: 'coach_processed',
        sectionName,
        assetId: savedAsset.rows[0]?.id ?? null,
      },
    });
    res.json({
      assetId: savedAsset.rows[0]?.id ?? null,
      sectionName,
      transcript,
      summary,
      actionItems,
      knowledge,
    });
  } catch (error) {
    await finalizeManagedUsageEvent({
      eventId: usageEventId,
      success: false,
      metadata: {
        error: error instanceof Error ? error.message : 'Coach processing failed',
      },
    });
    if (error instanceof ManagedUsageLimitError) {
      return res.status(error.statusCode).json({
        error: error.code,
        message: error.message,
        detail: error.detail,
      });
    }
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
    if (studentAgent) {
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
    }
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
