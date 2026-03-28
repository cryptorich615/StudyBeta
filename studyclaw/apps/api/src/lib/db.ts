import { Pool } from 'pg';
import { loadRepoEnv } from './load-env';

loadRepoEnv();

export const db = new Pool({ connectionString: process.env.DATABASE_URL });
