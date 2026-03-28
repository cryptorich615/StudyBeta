import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const candidateEnvPaths = [
  resolve(__dirname, '../../../../.env'),
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
];

export function loadRepoEnv() {
  for (const envPath of candidateEnvPaths) {
    if (!existsSync(envPath)) {
      continue;
    }

    process.loadEnvFile?.(envPath);
    return envPath;
  }

  return null;
}
