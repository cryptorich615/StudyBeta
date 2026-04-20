import { Router } from 'express';
import { db } from '../../lib/db';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { normalizeReminderStatus, normalizeReminderType, presentReminderStatus } from '../../lib/reminder-types';

export const remindersRouter = Router();
remindersRouter.use(requireAuth);

function presentReminderRow(row: Record<string, any>) {
  return {
    ...row,
    status: presentReminderStatus(row.status),
    remind_at: row.reminder_at ?? row.remind_at ?? null,
  };
}

remindersRouter.get('/', async (req: AuthedRequest, res) => {
  const result = await db.query(`select * from reminders where user_id = $1 order by reminder_at asc`, [req.user!.id]);
  res.json({ reminders: result.rows.map((row) => presentReminderRow(row)) });
});

remindersRouter.post('/', async (req: AuthedRequest, res) => {
  const { title, reminderAt, type, metadata } = req.body as any;
  if (!title || !reminderAt || !type) {
    return res.status(400).json({ error: 'bad_request', message: 'title, reminderAt, and type are required' });
  }

  const normalizedType = normalizeReminderType(String(type));
  const nextMetadata = {
    ...(metadata ?? {}),
    ...(normalizedType.preservedRequestedType ? { requestedType: normalizedType.preservedRequestedType } : {}),
  };

  const result = await db.query(
    `insert into reminders (user_id, title, reminder_at, type, metadata_json)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [req.user!.id, title, reminderAt, normalizedType.normalizedType, JSON.stringify(nextMetadata)]
  );
  res.status(201).json(presentReminderRow(result.rows[0]));
});

remindersRouter.patch('/:reminderId', async (req: AuthedRequest, res) => {
  const { title, type, status, reminderAt, metadata } = req.body as {
    title?: string;
    type?: string;
    status?: string;
    reminderAt?: string;
    metadata?: Record<string, unknown>;
  };

  const normalizedType = type ? normalizeReminderType(String(type)).normalizedType : null;
  const normalizedTypeDetails = type ? normalizeReminderType(String(type)) : null;
  const normalizedStatus = status ? normalizeReminderStatus(String(status)) : null;
  const nextMetadata =
    metadata || normalizedTypeDetails?.preservedRequestedType
      ? {
          ...(metadata ?? {}),
          ...(normalizedTypeDetails?.preservedRequestedType ? { requestedType: normalizedTypeDetails.preservedRequestedType } : {}),
        }
      : null;

  const result = await db.query(
    `update reminders
     set
       title = coalesce($3, title),
       type = coalesce($4, type),
       status = coalesce($5, status),
       reminder_at = coalesce($6, reminder_at),
       metadata_json = coalesce($7::jsonb, metadata_json),
       updated_at = now()
     where id = $1 and user_id = $2
     returning *`,
    [
      req.params.reminderId,
      req.user!.id,
      title?.trim() || null,
      normalizedType,
      normalizedStatus,
      reminderAt || null,
      nextMetadata ? JSON.stringify(nextMetadata) : null,
    ]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'not_found', message: 'Reminder not found' });
  }

  res.json(presentReminderRow(result.rows[0]));
});

remindersRouter.delete('/:reminderId', async (req: AuthedRequest, res) => {
  const result = await db.query(
    `delete from reminders
     where id = $1 and user_id = $2
     returning id`,
    [req.params.reminderId, req.user!.id]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'not_found', message: 'Reminder not found' });
  }

  res.json({ ok: true });
});
