import { ensurePlatformSchema } from '../lib/platform-schema';
import { db } from '../lib/db';
import { runMigrations } from '../lib/migrations';

function readEmailArg() {
  const raw = process.argv.find((arg) => arg.startsWith('--email='));
  return raw ? raw.slice('--email='.length).trim().toLowerCase() : null;
}

async function main() {
  await runMigrations();
  await ensurePlatformSchema();

  const email = readEmailArg();
  const userResult = await db.query(
    `select id, email
     from users
     where role <> 'admin'
       and ($1::text is null or lower(email) = $1)`,
    [email]
  );

  const userIds = userResult.rows.map((row) => row.id as string);
  if (!userIds.length) {
    console.log(JSON.stringify({ ok: true, resetUsers: 0, scope: email ?? 'all-non-admin' }));
    return;
  }

  const client = await db.connect();
  try {
    await client.query('begin');

    await client.query(
      `delete from managed_usage_events
       where user_id = any($1::uuid[])`,
      [userIds]
    );
    await client.query(`delete from user_usage_profiles where user_id = any($1::uuid[])`, [userIds]);
    await client.query(`delete from user_saved_model_configs where user_id = any($1::uuid[])`, [userIds]);
    await client.query(`delete from user_model_credentials where user_id = any($1::uuid[])`, [userIds]);

    await client.query(
      `delete from chat_messages
       where thread_id in (
         select id from chat_threads where user_id = any($1::uuid[])
       )`,
      [userIds]
    );
    await client.query(`delete from chat_threads where user_id = any($1::uuid[])`, [userIds]);

    await client.query(`delete from agent_profiles where user_id = any($1::uuid[])`, [userIds]);
    await client.query(`delete from agents where user_id = any($1::uuid[])`, [userIds]);

    await client.query(
      `insert into student_profiles (user_id, onboarding_complete)
       select id, false from users where id = any($1::uuid[])
       on conflict (user_id) do update set
         onboarding_complete = false,
         updated_at = now()`,
      [userIds]
    );

    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  console.log(
    JSON.stringify({
      ok: true,
      resetUsers: userIds.length,
      scope: email ?? 'all-non-admin',
      emails: userResult.rows.map((row) => row.email),
    })
  );
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await db.end().catch(() => undefined);
  });
