import { db } from '../lib/db';
import { ensurePlatformSchema } from '../lib/platform-schema';

const REMINDER_THREAD_TITLE = 'Reminders';

async function ensureReminderThread(userId: string) {
  const existing = await db.query(
    `select id, openclaw_session_id
     from chat_threads
     where user_id = $1
     order by last_message_at desc
     limit 1`,
    [userId]
  );

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const created = await db.query(
    `insert into chat_threads (user_id, openclaw_session_id, title)
     values ($1, $2, $3)
     returning id, openclaw_session_id`,
    [userId, `reminders_${Date.now()}`, REMINDER_THREAD_TITLE]
  );

  return created.rows[0];
}

async function resolveDeliveryThread(userId: string, metadata: Record<string, unknown> | null) {
  const sourceThreadId = typeof metadata?.sourceThreadId === 'string' ? metadata.sourceThreadId : '';
  if (sourceThreadId) {
    const existing = await db.query(
      `select id, openclaw_session_id
       from chat_threads
       where id = $1 and user_id = $2
       limit 1`,
      [sourceThreadId, userId]
    );

    if (existing.rows[0]) {
      return existing.rows[0];
    }
  }

  return ensureReminderThread(userId);
}

function buildReminderMessage(reminder: {
  title: string;
  type: string;
  reminder_at: string;
  metadata_json: Record<string, unknown> | null;
}) {
  const metadata = reminder.metadata_json ?? {};
  const detailBits: string[] = [];

  const location = typeof metadata.location === 'string' ? metadata.location.trim() : '';
  const room = typeof metadata.room === 'string' ? metadata.room.trim() : '';
  const course = typeof metadata.course === 'string' ? metadata.course.trim() : '';

  if (course) detailBits.push(course);
  if (location) detailBits.push(location);
  if (room) detailBits.push(`Room ${room}`);

  const suffix = detailBits.length ? ` ${detailBits.join(' · ')}` : '';
  return `Reminder: ${reminder.title}!${suffix}`;
}

export async function runReminderWorkerOnce() {
  await ensurePlatformSchema();

  const dueReminders = await db.query(
    `select id, user_id, title, type, reminder_at, metadata_json
     from reminders
     where reminder_at <= now()
       and status = 'scheduled'
     order by reminder_at asc
     for update skip locked`
  );

  let deliveredCount = 0;

  for (const reminder of dueReminders.rows) {
    const client = await db.connect();
    try {
      await client.query('begin');
      const locked = await client.query(
        `select id
         from reminders
         where id = $1
           and status = 'scheduled'
         for update skip locked`,
        [reminder.id]
      );

      if (!locked.rows[0]) {
        await client.query('rollback');
        continue;
      }

      const thread = await resolveDeliveryThread(reminder.user_id, reminder.metadata_json);
      const content = buildReminderMessage(reminder);

      await client.query(
        `insert into chat_messages (thread_id, role, content, metadata_json)
         values ($1, 'assistant', $2, $3)`,
        [
          thread.id,
          content,
          JSON.stringify({
            source: 'reminder_worker',
            reminderId: reminder.id,
            reminderType: reminder.type,
            reminderAt: reminder.reminder_at,
            personaName: 'Willow',
          }),
        ]
      );

      await client.query(
        `update chat_threads
         set last_message_at = now()
         where id = $1`,
        [thread.id]
      );

      await client.query(
        `update reminders
         set status = 'sent',
             updated_at = now()
         where id = $1`,
        [reminder.id]
      );

      await client.query('commit');
      deliveredCount += 1;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  return { deliveredCount };
}

export function startReminderWorker() {
  const intervalMs = 60_000;

  void runReminderWorkerOnce().catch((error) => {
    console.error('Reminder worker initial run failed:', error);
  });

  return setInterval(() => {
    void runReminderWorkerOnce().catch((error) => {
      console.error('Reminder worker run failed:', error);
    });
  }, intervalMs);
}
