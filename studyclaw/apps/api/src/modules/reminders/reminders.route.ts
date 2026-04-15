import { Router } from 'express';
import { db } from '../../lib/db';
import { requireAuth, type AuthedRequest } from '../../lib/auth';

export const remindersRouter = Router();
remindersRouter.use(requireAuth);

remindersRouter.get('/', async (req: AuthedRequest, res) => {
  const result = await db.query(`select * from reminders where user_id = $1 order by reminder_at asc`, [req.user!.id]);
  res.json({ reminders: result.rows });
});

remindersRouter.post('/', async (req: AuthedRequest, res) => {
  const { title, reminderAt, type, metadata } = req.body as any;
  if (!title || !reminderAt || !type) {
    return res.status(400).json({ error: 'bad_request', message: 'title, reminderAt, and type are required' });
  }

  const result = await db.query(
    `insert into reminders (user_id, title, reminder_at, type, metadata_json)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [req.user!.id, title, reminderAt, type, JSON.stringify(metadata ?? {})]
  );
  res.status(201).json(result.rows[0]);
});

remindersRouter.patch('/:reminderId', async (req: AuthedRequest, res) => {
  const { title, type, reminderAt } = req.body as {
    title?: string;
    type?: string;
    reminderAt?: string;
  };

  const result = await db.query(
    `update reminders
     set
       title = coalesce($3, title),
       type = coalesce($4, type),
       reminder_at = coalesce($5, reminder_at),
       updated_at = now()
     where id = $1 and user_id = $2
     returning *`,
    [req.params.reminderId, req.user!.id, title?.trim() || null, type?.trim() || null, reminderAt || null]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'not_found', message: 'Reminder not found' });
  }

  res.json(result.rows[0]);
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
