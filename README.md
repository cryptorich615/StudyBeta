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

---

## 🤖 AI-Assisted Server Setup (Codex / Gemini CLI)

After cloning this repo on a new server, paste the following prompt into **OpenAI Codex** or **Gemini CLI** to get the full app running automatically:

---

### Copy-Paste Prompt

```
I just pulled the StudyClaw repo onto a fresh Ubuntu server. 
Here is the project structure and what needs to happen:

STACK:
- Next.js frontend (apps/web)
- Node.js/Express backend (src/)
- PostgreSQL database
- Prisma ORM
- Docker + Docker Compose available

YOUR TASKS:
1. Install all dependencies (run `npm install` or `pnpm install` in root and in apps/web)
2. Check if PostgreSQL is running — if not, install and start it
3. Create the database: `createdb -U postgres studyclaw`
4. Run Prisma migrations: `npx prisma migrate deploy` from the root
5. If a DB backup file exists (*.sql), restore it: `psql -U postgres studyclaw < <backup-file>.sql`
6. Create a `.env` file from `.env.example` — list every variable that needs to be filled in and what it does
7. Build the Next.js app: `cd apps/web && npm run build`
8. Start the full stack using `docker-compose up -d` OR the `deploy.sh` script
9. Confirm the app is accessible on port 3000 (or whichever port is configured)
10. Show me the status of all running services when done

If any step fails, explain the error and attempt to fix it automatically.
Do not skip steps. Ask me for any missing secret values (API keys, DB passwords) before continuing.
```

---

### Quick Start (manual)

```bash
git clone https://github.com/cryptorich615/studyclaw
cd studyclaw
cp .env.example .env          # fill in your secrets
npm install
npx prisma migrate deploy
docker-compose up -d
```

### Restore a DB backup (if you have one)

```bash
psql -U postgres studyclaw < studyclaw_backup_YYYYMMDD.sql
```
