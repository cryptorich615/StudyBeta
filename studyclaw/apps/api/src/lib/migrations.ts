import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { db } from './db';

const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');
const BASELINE_MIGRATION = '001_initial_schema.sql';

let hasRun = false;

async function ensureMigrationsTable() {
  await db.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function getAppliedMigrationIds() {
  const result = await db.query(`select id from schema_migrations order by id asc`);
  return new Set(result.rows.map((row: { id: string }) => row.id));
}

async function shouldBaselineExistingDatabase() {
  const result = await db.query(`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = 'users'
    ) as has_users_table
  `);

  return Boolean(result.rows[0]?.has_users_table);
}

export async function runMigrations() {
  if (hasRun) {
    return;
  }

  await ensureMigrationsTable();

  const migrationFiles = (await readdir(MIGRATIONS_DIR))
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  const applied = await getAppliedMigrationIds();

  if (!applied.size && (await shouldBaselineExistingDatabase()) && migrationFiles.includes(BASELINE_MIGRATION)) {
    await db.query(`insert into schema_migrations (id) values ($1) on conflict (id) do nothing`, [BASELINE_MIGRATION]);
    applied.add(BASELINE_MIGRATION);
  }

  for (const file of migrationFiles) {
    if (applied.has(file)) {
      continue;
    }

    const sql = await readFile(resolve(MIGRATIONS_DIR, file), 'utf8');
    const client = await db.connect();

    try {
      await client.query('begin');
      await client.query(sql);
      await client.query(`insert into schema_migrations (id) values ($1)`, [file]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  hasRun = true;
}
