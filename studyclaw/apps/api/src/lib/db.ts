import { resolve } from 'node:path';
import { Pool } from 'pg';

process.loadEnvFile?.(resolve(process.cwd(), '../../.env'));

export const db = new Pool({ connectionString: process.env.DATABASE_URL });
