# StudyBeta

Private migration bundle for moving the current StudyClaw + OpenClaw setup to a new server.

## What Is Included

- `studyclaw/`: the application code and current environment files
- `openclaw-home/`: the essential OpenClaw home/config needed to restore agents and auth state
- `backups/studyclaw.sql.gz`: the current PostgreSQL database export
- `scripts/restore-server.sh`: copies the bundled files into the expected locations on a new machine

## What Is Not Included

- `node_modules`
- Next.js build output
- OpenClaw logs, caches, and the large local workspace mirror
- PostgreSQL server binaries and service config

## Restore On A New Server

1. Install system dependencies first:
   - Node.js
   - pnpm
   - PostgreSQL
   - OpenClaw CLI

2. Clone this repo to the new server.

3. Run:

```bash
bash scripts/restore-server.sh
```

4. Review:
   - `~/studyclaw/.env`
   - `~/.openclaw/openclaw.json`

5. Restore the database:

```bash
createdb studyclaw || true
gunzip -c backups/studyclaw.sql.gz | psql postgres://postgres:postgres@localhost:5432/studyclaw
```

6. Start services from `~/studyclaw`:

```bash
pnpm install
pnpm dev:api
pnpm exec next dev ./apps/web -p 3000
```

## Notes

- This repo contains sensitive credentials and tokens. Keep it private.
- The packaged database dump should be imported after cloning and before starting the app.
