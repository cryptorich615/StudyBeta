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
