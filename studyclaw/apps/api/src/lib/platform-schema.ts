import { runMigrations } from './migrations';

let ensured = false;

export async function ensurePlatformSchema() {
  if (ensured) {
    return;
  }

  await runMigrations();
  ensured = true;
}
