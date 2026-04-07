# Contributing to StudyClaw

## Branches

| Branch | Purpose |
|--------|---------|
| `main` | Stable, deployable. Never commit broken code here directly. |
| `feature/*` | New features and skills |
| `fix/*` | Bug fixes |
| `refactor/*` | Code restructures, no behavior change |
| `hotfix/*` | Urgent production fixes |

## Workflow

### 1. Start a new branch from main
```bash
cd ~/StudyBeta/studyclaw
git checkout main
git pull
git checkout -b feature/your-feature-name
```

### 2. Develop and test
```bash
npm run dev:api    # API server on :4000
npm run dev:web    # Frontend on :3000
npm test           # Run tests
```

### 3. Commit early, commit often
One logical change per commit.

```bash
git add apps/api/src/modules/your-feature/
git commit -m "feat: add flashcard spaced repetition endpoint"
```

**Commit types:**
```
feat:     New feature
fix:      Bug fix
refactor: Code restructure (no feature change)
docs:     Documentation only
test:     Tests only
chore:    Maintenance, deps, tooling
```

### 4. Push and create a merge plan
```bash
git push -u origin feature/your-feature-name
```

When ready to ship:
```bash
git checkout main
git pull
git merge feature/your-feature-name
git push
```

### 5. Restart the server on EC2
```bash
# SSH into EC2, then:
pkill -f "tsx.*main.ts"
sleep 2
cd ~/StudyBeta/studyclaw && npm run dev:api
```

## File Conventions

### Route modules
```
apps/api/src/modules/{feature}/
├── {feature}.route.ts    # Express router + auth
├── {feature}.service.ts # Business logic
├── {feature}.db.ts      # Database queries
└── __tests__/           # Unit tests
```

### Skill modules
```
openclaw-home/skills/{skill-name}/
└── SKILL.md
```

### System prompt / persona config
```
apps/api/src/lib/agent-config.ts
```

## Testing Checklist

Before pushing to main:
- [ ] New endpoints return correct HTTP status codes
- [ ] Auth is enforced on protected routes
- [ ] Error responses are informative
- [ ] No `console.log` or debug code left in
- [ ] Types compile cleanly: `npx tsc --noEmit`

## Code Review

Before merging, check:
1. Does it do what the commit message says?
2. Are there tests for new logic?
3. Are sensitive values (keys, secrets) in `.env`, never committed?
4. Does the API still start cleanly?

## Pulling Updates from Workspace to StudyBeta

When syncing experimental work from your admin workspace to StudyBeta:

```bash
# From your workspace working copy
cp -r ~/workspace-studyclaw_admin/skills/* ~/StudyBeta/studyclaw/openclaw-home/skills/
# Then commit in StudyBeta
git add openclaw-home/skills/...
git commit -m "feat: sync new skills from workspace"
```
