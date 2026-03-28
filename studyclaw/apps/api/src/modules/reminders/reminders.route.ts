import { Router } from 'express';
import { db } from '../../lib/db';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { ensurePlatformSchema } from '../../lib/platform-schema';

export const remindersRouter = Router();
remindersRouter.use(requireAuth);

remindersRouter.get('/', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();

  const result = await db.query(
    `select *
     from reminders
     where user_id = $1
     order by reminder_at asc`,
    [req.user!.id]
  );

  res.json(result.rows);
});

remindersRouter.post('/', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();

  const { title, reminderAt, type, metadata } = req.body as {
    title?: string;
    reminderAt?: string;
    type?: string;
    metadata?: Record<string, unknown>;
  };

  if (!title || !reminderAt || !type) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'title, reminderAt, and type are required',
    });
  }

  const parsedReminderAt = new Date(reminderAt);
  if (Number.isNaN(parsedReminderAt.getTime())) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'reminderAt must be a valid ISO timestamp',
    });
  }

  const result = await db.query(
    `insert into reminders (user_id, title, reminder_at, type, delivered, metadata_json)
     values ($1, $2, $3, $4, false, $5)
     returning *`,
    [req.user!.id, title.trim(), parsedReminderAt.toISOString(), type, JSON.stringify(metadata ?? {})]
  );

  res.status(201).json(result.rows[0]);
});

remindersRouter.patch('/:reminderId', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();

  const { title, reminderAt, type, status } = req.body as {
    title?: string;
    reminderAt?: string;
    type?: string;
    status?: string;
  };

  const currentResult = await db.query(
    `select *
     from reminders
     where id = $1
       and user_id = $2
     limit 1`,
    [req.params.reminderId, req.user!.id]
  );

  const current = currentResult.rows[0];
  if (!current) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Reminder not found',
    });
  }

  const nextTitle = typeof title === 'string' ? title.trim() : current.title;
  const nextType = typeof type === 'string' ? type.trim() : current.type;
  const nextStatus = typeof status === 'string' ? status.trim() : current.status;

  if (!nextTitle || !nextType) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'title and type are required',
    });
  }

  let nextReminderAt = current.reminder_at;
  if (typeof reminderAt === 'string') {
    const parsedReminderAt = new Date(reminderAt);
    if (Number.isNaN(parsedReminderAt.getTime())) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'reminderAt must be a valid ISO timestamp',
      });
    }

    nextReminderAt = parsedReminderAt.toISOString();
  }

  const result = await db.query(
    `update reminders
     set title = $3,
         reminder_at = $4,
         type = $5,
         status = $6
     where id = $1
       and user_id = $2
     returning *`,
    [req.params.reminderId, req.user!.id, nextTitle, nextReminderAt, nextType, nextStatus]
  );

  res.json(result.rows[0]);
});

remindersRouter.delete('/:reminderId', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();

  const result = await db.query(
    `delete from reminders
     where id = $1
       and user_id = $2
     returning id`,
    [req.params.reminderId, req.user!.id]
  );

  if (!result.rows[0]) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Reminder not found',
    });
  }

  res.json({ ok: true, id: result.rows[0].id });
});
