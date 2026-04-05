# StudyClaw Task List

## How to Use This File
- This is a phase-ordered execution board derived from:
  - [newRelease.md](/home/ubuntu/StudyBeta/studyclaw/newRelease.md)
  - [releaseActionPlan.md](/home/ubuntu/StudyBeta/studyclaw/releaseActionPlan.md)
- Priority tags:
  - `[P0]` critical upgrade / compatibility / risk reduction
  - `[P1]` high-value product improvements
  - `[P2]` medium-priority leverage work
  - `[P3]` longer-term or higher-complexity work
- Work-type tags:
  - `[Quick Win]`, `[Upgrade]`, `[Product]`, `[Infra]`, `[Agent]`, `[Frontend]`, `[Backend]`, `[QA]`, `[Docs]`
- Phase order matters. Finish earlier blocked tasks first unless a task explicitly says it can run in parallel.
- If a task includes an assumption, verify it before implementation.

## Phase 1 — Safe Upgrade and Compatibility

- [ ] [P0] [Upgrade] [Infra] Audit live OpenClaw config against the checked-in repo snapshot
  - Blocked by: none
  - Repo area: [`openclaw-home/openclaw.json`](/home/ubuntu/StudyBeta/openclaw-home/openclaw.json), [`README.md`](/home/ubuntu/StudyBeta/studyclaw/README.md)
  - Suggested owner: Infra / backend engineer
  - Notes: live `~/.openclaw/openclaw.json` is the likely runtime source of truth; repo snapshot is older.
  - Subtasks:
    - [ ] Diff live `~/.openclaw/openclaw.json` vs repo `openclaw-home/openclaw.json`
    - [ ] Record differences in gateway, channels, plugins, skills, auth, model defaults, tool profiles
    - [ ] Decide which config is the source of truth for future StudyClaw planning
  - Validation:
    - Confirm config parses
    - Confirm StudyClaw API still points at the expected gateway/token
    - Confirm no hidden live-only config assumptions remain undocumented

- [ ] [P0] [Upgrade] [Infra] Verify latest stable OpenClaw config migrations for `x_search` and Firecrawl `web_fetch`
  - Blocked by: Audit live OpenClaw config against the checked-in repo snapshot
  - Repo area: live OpenClaw config, ops runbooks, research/admin verification flows
  - Suggested owner: Infra / backend engineer
  - Notes: required by latest stable OpenClaw release review
  - Subtasks:
    - [ ] Check whether any live config still uses `tools.web.x_search.*`
    - [ ] Check whether any live config still uses `tools.web.fetch.firecrawl.*`
    - [ ] Run `openclaw doctor --fix`
    - [ ] Re-inspect migrated config paths under plugin-owned config
  - Validation:
    - Confirm `openclaw doctor --fix` completes cleanly
    - Confirm migrated config loads without startup errors
    - Confirm any affected search/fetch flow still works if used

- [ ] [P0] [Upgrade] [Infra] [Agent] Re-audit student agent tool allowlists and exec posture
  - Blocked by: Audit live OpenClaw config against the checked-in repo snapshot
  - Repo area: [`apps/api/src/lib/user-agent.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/user-agent.ts), live OpenClaw config, security posture docs
  - Suggested owner: Backend / infra engineer
  - Notes: latest stable OpenClaw changed host exec defaults; this is the highest-risk policy area for a student app.
  - Subtasks:
    - [ ] Review `alsoAllow` tool lists for student agents
    - [ ] Check whether any student agent inherits host-exec capability more broadly than intended
    - [ ] Define desired student-facing exec/tool policy explicitly
    - [ ] Capture any required restrictions or future hardening items
  - Validation:
    - Run `openclaw security audit --deep`
    - Run `openclaw approvals get`
    - Confirm student-facing browser/research flows still work under the reviewed policy

- [ ] [P1] [Quick Win] [Upgrade] [Docs] Add an OpenClaw post-update verification runbook for StudyClaw
  - Blocked by: Verify latest stable OpenClaw config migrations for `x_search` and Firecrawl `web_fetch`
  - Repo area: [`README.md`](/home/ubuntu/StudyBeta/studyclaw/README.md), smoke/test docs, operator notes
  - Suggested owner: Infra / docs owner
  - Subtasks:
    - [ ] Document required update sequence
    - [ ] Document version / doctor / gateway / health checks
    - [ ] Document required StudyClaw smoke flows after any OpenClaw upgrade
  - Validation:
    - Confirm every documented command exists and runs
    - Confirm runbook is executable by someone who did not perform the original update

- [ ] [P1] [Upgrade] [Infra] Review gateway exposure, Control UI origins, and browser-related posture
  - Blocked by: Audit live OpenClaw config against the checked-in repo snapshot
  - Repo area: live OpenClaw config, [`openclaw-home/openclaw.json`](/home/ubuntu/StudyBeta/openclaw-home/openclaw.json), browser docs, deployment notes
  - Suggested owner: Infra / security-minded backend engineer
  - Notes: repo snapshot currently shows `gateway.bind: "lan"` and permissive `controlUi.allowedOrigins`; treat live config as source of truth.
  - Subtasks:
    - [ ] Verify intended bind mode
    - [ ] Verify intended Control UI origins
    - [ ] Review browser exposure against OpenClaw browser security guidance
  - Validation:
    - Confirm gateway status/health remain good after review
    - Confirm Browser Access still works for authenticated StudyClaw users

- [ ] [P1] [Upgrade] [QA] Run a full OpenClaw + StudyClaw smoke checklist after the migration audit
  - Blocked by: Add an OpenClaw post-update verification runbook for StudyClaw
  - Repo area:
    - [`apps/api/src/integrations/openclaw/openclaw.client.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/integrations/openclaw/openclaw.client.ts)
    - [`apps/api/src/lib/openclaw-control.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/openclaw-control.ts)
    - browser / chat / library / grades / schedule flows
  - Suggested owner: QA / full-stack engineer
  - Subtasks:
    - [ ] Verify gateway connectivity from StudyClaw API
    - [ ] Verify student agent provisioning still works
    - [ ] Verify one chat flow
    - [ ] Verify one browser-backed research flow
    - [ ] Verify one Open Library lookup flow
    - [ ] Verify one grade query and one schedule query
  - Validation:
    - Confirm command outputs are healthy
    - Confirm no new runtime errors in StudyClaw core flows

## Phase 2 — Core Student Experience Improvements

- [ ] [P1] [Quick Win] [Agent] [Backend] Audit chat interception points for deterministic student-data replies
  - Blocked by: Re-audit student agent tool allowlists and exec posture
  - Repo area: [`apps/api/src/modules/chat/chat.route.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/modules/chat/chat.route.ts)
  - Suggested owner: Backend / agent engineer
  - Notes: assumption: current repo does not already implement StudyClaw-specific `before_agent_reply`.
  - Subtasks:
    - [ ] Identify schedule-related chat branches
    - [ ] Identify grade / target-grade chat branches
    - [ ] Mark where deterministic hook or plugin interception would fit
  - Validation:
    - Confirm identified branches map to real user prompts already handled today

- [ ] [P1] [Product] [Agent] [Backend] Implement deterministic schedule replies
  - Blocked by: Audit chat interception points for deterministic student-data replies
  - Repo area:
    - [`apps/api/src/modules/chat/chat.route.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/modules/chat/chat.route.ts)
    - [`apps/api/src/lib/class-scheduler.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/class-scheduler.ts)
    - [`openclaw-home/skills/class-scheduler/SKILL.md`](/home/ubuntu/StudyBeta/openclaw-home/skills/class-scheduler/SKILL.md)
  - Suggested owner: Backend / agent engineer
  - Subtasks:
    - [ ] Define deterministic match cases for current/next class queries
    - [ ] Preserve fallback behavior when no schedule exists
    - [ ] Keep wording student-friendly and explicit when data is missing
  - Validation:
    - Confirm “What class do I have right now?”
    - Confirm “What class do I have next?”
    - Confirm “Who is my teacher for chemistry?”
    - Confirm missing-schedule path behaves gracefully

- [ ] [P1] [Product] [Agent] [Backend] Implement deterministic grade and target-grade replies
  - Blocked by: Audit chat interception points for deterministic student-data replies
  - Repo area:
    - [`apps/api/src/modules/chat/chat.route.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/modules/chat/chat.route.ts)
    - [`apps/api/src/lib/grade-tracker.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/grade-tracker.ts)
    - [`openclaw-home/skills/grade-tracker/SKILL.md`](/home/ubuntu/StudyBeta/openclaw-home/skills/grade-tracker/SKILL.md)
  - Suggested owner: Backend / agent engineer
  - Subtasks:
    - [ ] Define deterministic match cases for estimated-grade queries
    - [ ] Define deterministic match cases for target-final queries
    - [ ] Preserve “estimated, not official” wording
  - Validation:
    - Confirm weighted course example works
    - Confirm unweighted course example works
    - Confirm “What do I need on the final to get a B?” works
    - Confirm incomplete-data assumptions are shown clearly

- [ ] [P1] [Product] [QA] Regression-test current student data flows after deterministic reply work
  - Blocked by:
    - Implement deterministic schedule replies
    - Implement deterministic grade and target-grade replies
  - Repo area: chat, grades, schedule pages and APIs
  - Suggested owner: QA / full-stack engineer
  - Subtasks:
    - [ ] Re-test chat general study help
    - [ ] Re-test schedule CRUD + chat questions
    - [ ] Re-test grades CRUD + chat questions
  - Validation:
    - Confirm no loss of general chat continuity
    - Confirm existing UI flows still save and display correctly

- [ ] [P1] [Quick Win] [Docs] Write down current custom StudyClaw skill lifecycle
  - Blocked by: none
  - Repo area:
    - [`openclaw-home/skills/*`](/home/ubuntu/StudyBeta/openclaw-home/skills)
    - [`apps/api/src/lib/user-agent.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/user-agent.ts)
  - Suggested owner: Backend / docs owner
  - Subtasks:
    - [ ] Note source-of-truth location for each custom skill
    - [ ] Note how each skill is copied/installed into student workspaces
    - [ ] Note how skill updates should be versioned or rolled out
  - Validation:
    - Confirm a new engineer could explain how custom student skills reach a user workspace

## Phase 3 — Automation and Agent Workflows

- [ ] [P1] [Quick Win] [Product] [Agent] Choose the first Task Flow pilot: weekly plan or exam-prep countdown
  - Blocked by: Run a full OpenClaw + StudyClaw smoke checklist after the migration audit
  - Repo area:
    - [`apps/api/src/lib/weekly-study-plan.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/weekly-study-plan.ts)
    - reminders/schedule/dashboard flows
  - Suggested owner: Product + backend owner
  - Notes: choose one first; do not build both in parallel initially.
  - Validation:
    - Confirm the selected workflow has a clear start trigger, durable state need, and visible student payoff

- [ ] [P1] [Product] [Agent] [Backend] Verify Task Flow compatibility with current StudyClaw orchestration patterns
  - Blocked by: Choose the first Task Flow pilot: weekly plan or exam-prep countdown
  - Repo area:
    - [`apps/api/src/lib/openclaw-control.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/openclaw-control.ts)
    - reminders / dashboard / weekly plan logic
  - Suggested owner: Backend / workflow engineer
  - Notes: assumption: current repo uses reminders and existing workflow code more than OpenClaw Task Flow today.
  - Subtasks:
    - [ ] Map current weekly-plan/reminder flow state
    - [ ] Identify where Task Flow should own state vs where StudyClaw DB should remain source of truth
    - [ ] Define idempotency and recovery expectations
  - Validation:
    - Confirm proposed Task Flow lifecycle fits current StudyClaw data model without replacing working features

- [ ] [P1] [Product] [Agent] [Backend] Build Task Flow weekly study plan workflow
  - Blocked by: Verify Task Flow compatibility with current StudyClaw orchestration patterns
  - Repo area:
    - dashboard
    - reminders
    - schedule
    - weekly study plan logic
    - OpenClaw orchestration layer
  - Suggested owner: Backend / workflow engineer
  - Subtasks:
    - [ ] Define workflow start conditions
    - [ ] Define state model and recovery expectations
    - [ ] Define how dashboard and reminders will reflect workflow status
  - Validation:
    - Confirm workflow can be inspected after creation
    - Confirm workflow state survives restart/reload
    - Confirm output remains consistent with existing weekly plan semantics

- [ ] [P1] [Product] [Agent] [Backend] Build Task Flow exam-prep countdown workflow
  - Blocked by: Build Task Flow weekly study plan workflow
  - Repo area: reminders, dashboard, exam-facing study planning logic
  - Suggested owner: Backend / workflow engineer
  - Subtasks:
    - [ ] Define exam-prep triggers
    - [ ] Define day-by-day next-step behavior
    - [ ] Define cancellation/completion handling
  - Validation:
    - Confirm countdown can be inspected
    - Confirm cancellation/completion behaves predictably
    - Confirm reminder outputs stay coherent

- [ ] [P1] [Frontend] [Product] Surface workflow status in dashboard and/or reminder views
  - Blocked by:
    - Build Task Flow weekly study plan workflow
    - Build Task Flow exam-prep countdown workflow
  - Repo area:
    - [`apps/web/app/dashboard/page.tsx`](/home/ubuntu/StudyBeta/studyclaw/apps/web/app/dashboard/page.tsx)
    - reminders UI
  - Suggested owner: Full-stack / frontend engineer
  - Validation:
    - Confirm student can see that a workflow exists
    - Confirm status is understandable without reading logs or internal IDs

- [ ] [P1] [QA] Regression-test reminders, weekly planning, and dashboard after Task Flow adoption
  - Blocked by: Surface workflow status in dashboard and/or reminder views
  - Repo area: reminders, dashboard, weekly plan logic
  - Suggested owner: QA / full-stack engineer
  - Validation:
    - Confirm existing reminder CRUD still works
    - Confirm weekly plan remains visible and coherent
    - Confirm no duplicate or conflicting study tasks appear

## Phase 4 — Differentiating Features

- [ ] [P2] [Product] [Agent] [Docs] Package custom StudyClaw skills more intentionally
  - Blocked by: Write down current custom StudyClaw skill lifecycle
  - Repo area:
    - [`openclaw-home/skills`](/home/ubuntu/StudyBeta/openclaw-home/skills)
    - [`openclaw-home/extensions`](/home/ubuntu/StudyBeta/openclaw-home/extensions)
    - [`apps/api/src/lib/user-agent.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/user-agent.ts)
  - Suggested owner: Backend / platform engineer
  - Subtasks:
    - [ ] Decide how custom skills/plugins should be versioned
    - [ ] Decide whether current copy-into-workspace flow should remain or be tightened
    - [ ] Document rollout/update behavior
  - Validation:
    - Confirm provisioning a new student still results in the expected skill set
    - Confirm skill updates have a clear rollout path

- [ ] [P2] [Product] [Infra] [Backend] Review Browser Access policy seams and profile lifecycle
  - Blocked by: Re-audit student agent tool allowlists and exec posture
  - Repo area:
    - browser backend/provider layer
    - browser page
    - research/browser integration points
  - Suggested owner: Full-stack / infra engineer
  - Notes: this is not the same as implementing restrictions yet; first define seams and lifecycle.
  - Subtasks:
    - [ ] Verify what is already stubbed for browser policy
    - [ ] Verify expected per-student browser profile/session model
    - [ ] Identify what would need to exist for future restrictions
  - Validation:
    - Confirm authenticated browser access still works
    - Confirm session/profile expectations are explicit

- [ ] [P2] [Product] [Agent] [Backend] Align durable StudyClaw memory with OpenClaw memory search
  - Blocked by: Run a full OpenClaw + StudyClaw smoke checklist after the migration audit
  - Repo area:
    - [`apps/api/src/lib/student-memory.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/student-memory.ts)
    - chat context building paths
    - memory-related OpenClaw config/docs
  - Suggested owner: Backend / agent engineer
  - Notes: assumption: current repo has durable StudyClaw memory plus OpenClaw `session-memory`, but not a fully unified retrieval strategy.
  - Subtasks:
    - [ ] Define what stays in StudyClaw structured memory
    - [ ] Define what should also be indexed/retrieved through OpenClaw memory search
    - [ ] Avoid duplicated/conflicting memory sources
  - Validation:
    - Confirm later sessions retrieve useful context
    - Confirm no obvious prompt duplication or conflicting memory summaries

- [ ] [P3] [Product] [Frontend] [Agent] Explore Android/mobile voice study entry points
  - Blocked by:
    - Build Task Flow weekly study plan workflow
    - Build Task Flow exam-prep countdown workflow
  - Repo area: onboarding, chat entry, mobile strategy docs, future platform integration points
  - Suggested owner: Product + full-stack engineer
  - Notes: assumption: this is later-stage work and should not be started before core workflow improvements are stable.
  - Subtasks:
    - [ ] Pick one mobile use case
    - [ ] Map required OpenClaw Android/voice capability
    - [ ] Define privacy/UX expectations
  - Validation:
    - Confirm there is a clear student value story, not just a tech demo

## Blocked / Needs Research

- [ ] [P0] [Infra] Confirm whether the live runtime already uses hook/plugin configuration that is not represented in the repo snapshot
  - Blocked by: none
  - Repo area: live `~/.openclaw`
  - Validation: inspect live config and active plugins/hooks

- [ ] [P1] [Agent] Confirm how StudyClaw should adopt `before_agent_reply`
  - Blocked by: Audit live OpenClaw config against the checked-in repo snapshot
  - Repo area: chat runtime, plugin/hook strategy
  - Validation: verify whether this should be implemented as a plugin hook, direct chat branch, or both

- [ ] [P1] [Infra] Confirm whether any active StudyClaw path actually depends on xAI search or Firecrawl fetch today
  - Blocked by: Verify latest stable OpenClaw config migrations for `x_search` and Firecrawl `web_fetch`
  - Repo area: live config, admin/research flows
  - Validation: inspect live config and test the relevant flows if present

- [ ] [P1] [Backend] Confirm Task Flow ownership model relative to StudyClaw DB state
  - Blocked by: Verify Task Flow compatibility with current StudyClaw orchestration patterns
  - Repo area: workflow layer, reminders, weekly plan, DB-backed student state
  - Validation: written design note explaining what OpenClaw owns vs what StudyClaw owns

## Delayed On Purpose

- [ ] [P3] [Product] [Infra] Delay full teacher/admin messaging expansion across external channels
  - Why delayed: boundary and policy complexity is too high before core student workflow hardening

- [ ] [P3] [Product] [Agent] Delay deep ClawHub/UI marketplace work
  - Why delayed: the most relevant UI improvements are still tied to unreleased OpenClaw work

- [ ] [P3] [Frontend] [Agent] Delay broad mobile/voice rollout
  - Why delayed: better after deterministic answers and Task Flow are stable

- [ ] [P2] [Backend] Delay broad memory unification until the retrieval boundary is clearly defined
  - Why delayed: StudyClaw already has structured durable memory; avoid duplication too early

- [ ] [P2] [Infra] Delay browser restrictions/allowlists implementation until browser policy seams are reviewed
  - Why delayed: define the policy model first, then enforce it

## Start Here

1. [ ] [P0] [Upgrade] [Infra] Audit live OpenClaw config against the checked-in repo snapshot
2. [ ] [P0] [Upgrade] [Infra] Verify latest stable OpenClaw config migrations for `x_search` and Firecrawl `web_fetch`
3. [ ] [P0] [Upgrade] [Infra] [Agent] Re-audit student agent tool allowlists and exec posture
4. [ ] [P1] [Quick Win] [Upgrade] [Docs] Add an OpenClaw post-update verification runbook for StudyClaw
5. [ ] [P1] [Upgrade] [QA] Run a full OpenClaw + StudyClaw smoke checklist after the migration audit
6. [ ] [P1] [Quick Win] [Agent] [Backend] Audit chat interception points for deterministic student-data replies
7. [ ] [P1] [Product] [Agent] [Backend] Implement deterministic schedule replies
8. [ ] [P1] [Product] [Agent] [Backend] Implement deterministic grade and target-grade replies
9. [ ] [P1] [Quick Win] [Product] [Agent] Choose the first Task Flow pilot: weekly plan or exam-prep countdown
10. [ ] [P1] [Product] [Agent] [Backend] Verify Task Flow compatibility with current StudyClaw orchestration patterns
