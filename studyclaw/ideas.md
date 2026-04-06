# StudyClaw Codebase Scan: Add / Remove / Change / Enhance

## Purpose
This document turns a repo-wide scan into a practical list of what StudyClaw could add, remove, change, or enhance next.

It is based on the current code in:
- `apps/web`
- `apps/api`
- `openclaw-home`

No code changes are included here. This is planning only.

## 1. Highest-Value Priorities

### 1. Refactor the largest hotspot files
These files are doing too much and will become the main source of regressions if more features keep landing directly inside them.

- `apps/api/src/modules/chat/chat.route.ts`
- `apps/web/app/settings/settings-shared.tsx`
- `apps/web/app/chat/page.tsx`
- `apps/api/src/modules/study-tools/study-tools.route.ts`
- `apps/web/app/components/document-reader-workspace.tsx`
- `apps/web/app/onboarding/page.tsx`
- `apps/web/app/coach/page.tsx`

Why this matters:
- safer iteration
- clearer ownership by feature
- easier testing
- less risk when changing chat, onboarding, settings, or study workflows

Recommended change:
- split routes into handlers/services
- split large TSX pages into section components
- keep page files thin and orchestration-focused

### 2. Reconcile OpenClaw config drift
The checked-in `openclaw-home/openclaw.json` does not appear fully aligned with current StudyClaw behavior and current student skill strategy.

Examples:
- repo config still shows older defaults and older touched version metadata
- repo config still includes student skills like `gog`
- the app has moved toward StudyClaw-owned skills like `google-workspace`

Why this matters:
- easier disaster recovery
- more reliable fresh setup
- fewer surprises when cloning to a new machine

### 3. Finish the Browser feature or explicitly narrow it
The Browser surface is live but still marked under construction, and the backend contains explicit TODOs for missing controls.

Open TODO areas already in code:
- admin controls
- audit logging
- browser restrictions
- allowlist / blocklist

Files:
- `apps/api/src/lib/browser-session.ts`
- `apps/api/src/lib/browser-provider.ts`
- `apps/web/app/browser/page.tsx`
- `docs/browser.md`

Why this matters:
- security
- policy enforcement
- clearer product boundaries

### 4. Expand real UI-level regression coverage
The repo has solid API testing, but fewer browser-level tests for complex flows.

High-value browser-smoke targets:
- onboarding
- chat streaming
- Google connect
- study/reader open flows
- calendar agenda loading

## 2. Best Additions

### 1. Unified workload timeline
StudyClaw has:
- grades
- schedule
- reminders
- Google Calendar
- study documents
- flashcards/quizzes

What is missing is one academic timeline that merges:
- upcoming class sessions
- due dates
- exams
- reminders
- weak-grade pressure
- active study documents

Why add it:
- gives the dashboard a true “what should I do now?” engine
- makes planning more useful than isolated feature screens

### 2. Cross-device reader persistence
The study/reader experience is strong, but it should persist per user:
- saved books
- reading progress
- notes
- highlights
- bookmarks
- recent documents

Why add it:
- turns the reader into a real study workspace
- removes browser-local limitations

### 3. Persona-aware deterministic replies everywhere
Right now the persona layer is strongest in freeform chat. It should also apply to deterministic feature responses:
- grades
- schedule
- reminders
- library
- study plan generation
- wrong-answer review

Goal:
- Dixie = action, urgency, momentum
- Willow = calm, clarity, mastery

### 4. Better active-context plumbing
The app should consistently know the current:
- document
- course
- exam
- assignment
- study session

Then use that context across:
- chat
- flashcards
- quizzes
- notes
- reminders
- planning

### 5. Admin observability for agent and integration failures
Add a central admin surface for:
- chat failures
- slow requests
- OpenClaw failures
- Google sync issues
- reminder send failures
- browser session failures

Why add it:
- fewer blind debugging sessions
- easier operational trust

## 3. Best Changes

### 1. Split chat orchestration by intent
`chat.route.ts` is the biggest technical hotspot in the repo.

It currently mixes:
- routing
- transcript building
- context loading
- deterministic fast paths
- Google actions
- reminder actions
- grade/schedule actions
- fallback research/library paths
- OpenClaw invocation
- streaming orchestration

Recommended split:
- `chat-intents.ts`
- `chat-fast-paths.ts`
- `chat-streaming.ts`
- `chat-openclaw.ts`
- `chat-post-reply.ts`

### 2. Split settings by section
`settings-shared.tsx` is too large and owns too many unrelated concerns.

Suggested split:
- model settings
- notifications/integrations
- usage
- scheduled jobs
- agent settings

### 3. Convert onboarding model selection into a stronger provider registry
The current onboarding flow is much better than before, but provider/model logic still sits heavily inside the page.

Suggested direction:
- provider registry
- provider card config
- key detection rules
- model defaults
- fallback chain config

This will make Nvidia, Moonshot/Kimi, and future providers easier to add later.

### 4. Centralize environment validation
Startup should validate key envs early and clearly:
- CORS origins
- client URL
- API base URL
- Google OAuth envs
- OpenClaw home path
- provider credentials

Why:
- fewer runtime surprises
- faster local setup
- easier production debugging

## 4. Best Removals / Cleanup

### 1. Remove backup files from the repo
These should not stay in the main codebase:
- `apps/web/app/globals.css.bak`
- `apps/web/app/onboarding/page.tsx.bak`

### 2. Remove stale or misleading config/state from checked-in OpenClaw files
The repo snapshot should reflect the intended StudyClaw baseline, not older runtime leftovers.

### 3. Remove UI language that implies unfinished systems are complete
Example:
- Browser restrictions show as “Enabled (coming soon)” in the UI

That should either become real functionality or be restated more honestly.

## 5. Best Enhancements by Feature Area

### Chat
- stronger persona-aware deterministic replies
- more targeted context loading
- richer tool progress states
- true upstream token streaming if OpenClaw supports it
- automatic “coach-mode” routing by request type

### Onboarding
- cleaner separation of provider registry logic
- save/recover step state more explicitly
- richer validation for advanced provider setup
- better post-onboarding confirmation of actual model readiness

### Dashboard
- move from static overview to dynamic prioritization
- show:
  - next class
  - next due work
  - at-risk courses
  - resume reading
  - continue study session

### Study / Reader / Library
- persist books and reader state server-side
- stronger document processing status indicators
- folder support
- better “continue reading” intelligence
- tighter AI actions scoped to active document

### Calendar / Google
- stronger reconnect and scope-upgrade messaging
- better separation between auth status and usable capability status
- more Google-backed study actions:
  - create notes doc
  - export study plans
  - save review sheets

### Grades / Schedule / Reminders
- unify into one planning engine
- auto-suggest study sessions based on weak grades + upcoming class/exams
- better “what score do I need?” and “what should I review first?” guidance

### Browser
- admin controls
- policy controls
- audit trail
- session reset tools
- clear allow/block rules

## 6. Product Gaps

### 1. No single academic command center
There are strong pieces, but they still live in adjacent surfaces.

The next level is a unified student operating view combining:
- urgency
- context
- study materials
- performance
- schedule

### 2. Persona mission is stronger than persona system integration
Dixie and Willow now have a better identity, but the rest of the product should follow through more consistently.

### 3. Reader and study generation are powerful but dense
The underlying capability is there. The next leap is clearer continuity:
- open doc
- ask question
- create flashcards
- create quiz
- set reminder
- return to reading

### 4. Admin and student operational visibility is still limited
There are good internals, but not enough built-in diagnosis surfaces.

## 7. Technical Debt / Risk

### High risk
- `apps/api/src/modules/chat/chat.route.ts`
- `apps/web/app/settings/settings-shared.tsx`
- `apps/web/app/chat/page.tsx`
- `apps/web/app/onboarding/page.tsx`
- Browser security TODOs not fully implemented
- repo/runtime OpenClaw config drift

### Medium risk
- large study workspace component size
- large coach page size
- Google integration complexity growth
- cross-feature state duplication

### Low risk but worth cleaning
- backup files
- placeholder wording
- stale config metadata

## 8. Recommended Next 10 Items
1. Split `chat.route.ts` into smaller intent/orchestration modules.
2. Split `settings-shared.tsx` into section components.
3. Remove `.bak` files from the repo.
4. Reconcile checked-in `openclaw-home/openclaw.json` with actual StudyClaw defaults.
5. Finish Browser restrictions, allowlists, and audit logging.
6. Persist saved books and reader progress per user.
7. Build a unified workload timeline model.
8. Make deterministic feature replies persona-aware.
9. Add an admin diagnostics surface for agent/integration failures.
10. Expand Playwright/browser-smoke coverage for critical flows.

## 9. Best “Do Later” Ideas
- expose many more model providers in onboarding before the registry is cleaner
- full inline visual fidelity for every Google file type
- broad channel expansion before admin/diagnostic tooling is stronger
- major dashboard redesign before the underlying prioritization logic is improved

## 10. Short Recommendation
If only a few things should happen next, do these first:
- reduce technical risk in chat/settings/onboarding by splitting large files
- reconcile OpenClaw repo config with actual app behavior
- strengthen Browser safety and policy controls
- persist reader/library state server-side
- build a true academic workload timeline across grades, schedule, reminders, and study assets
