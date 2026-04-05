# StudyClaw Action Plan From OpenClaw Release Review

## 1. Executive Priorities

### Top issues
- The checked-in OpenClaw snapshot in [`openclaw-home/openclaw.json`](/home/ubuntu/StudyBeta/openclaw-home/openclaw.json) is older than the latest stable OpenClaw release reviewed in [newRelease.md](/home/ubuntu/StudyBeta/studyclaw/newRelease.md), so config drift is a real risk.
- Two OpenClaw stable migrations need active verification in the live runtime:
  - `x_search` config moving to `plugins.entries.xai.config.xSearch.*`
  - Firecrawl `web_fetch` config moving to `plugins.entries.firecrawl.config.webFetch.*`
- The latest stable release changes host exec defaults in a way that matters for a student-facing deployment. StudyClaw should explicitly re-audit tool policy and approvals before expanding automation or browser access.

### Top opportunities
- Add deterministic agent replies for schedule, grade, target-grade, and similar student-data questions using OpenClaw’s `before_agent_reply` hook.
- Move weekly planning and exam-prep orchestration onto OpenClaw Task Flow so background workflows become durable and inspectable.
- Productize StudyClaw’s existing custom skill/plugin surface instead of continuing to copy raw skill markdown into every student workspace.
- Tighten Browser Access around managed profiles, policy seams, and safer future restrictions.

### Top risks
- Config changes made only in the live `~/.openclaw` state may drift away from the repo snapshot and from StudyClaw assumptions.
- StudyClaw’s provisioning path in [`apps/api/src/lib/user-agent.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/user-agent.ts) depends on explicit skill and tool syncing; future OpenClaw skill-inheritance changes could introduce subtle regressions.
- Broadening automation without first reviewing exec/tool policy could create unnecessary risk for student-facing agents.

## 2. Assumptions and Repo Context

### What was verified
- StudyClaw uses OpenClaw in two concrete ways:
  - gateway requests through [`apps/api/src/integrations/openclaw/openclaw.client.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/integrations/openclaw/openclaw.client.ts)
  - CLI-based local agent operations through [`apps/api/src/lib/openclaw-control.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/openclaw-control.ts)
- Per-student agent provisioning and workspace skill syncing live in [`apps/api/src/lib/user-agent.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/user-agent.ts).
- StudyClaw already has custom OpenClaw-facing student capabilities:
  - Open Library plugin in [`openclaw-home/extensions/openlibrary-student-tools/src/plugin/index.ts`](/home/ubuntu/StudyBeta/openclaw-home/extensions/openlibrary-student-tools/src/plugin/index.ts)
  - skills in:
    - [`openclaw-home/skills/study-library/SKILL.md`](/home/ubuntu/StudyBeta/openclaw-home/skills/study-library/SKILL.md)
    - [`openclaw-home/skills/grade-tracker/SKILL.md`](/home/ubuntu/StudyBeta/openclaw-home/skills/grade-tracker/SKILL.md)
    - [`openclaw-home/skills/class-scheduler/SKILL.md`](/home/ubuntu/StudyBeta/openclaw-home/skills/class-scheduler/SKILL.md)
- Student-facing app areas already exist for:
  - onboarding: [`apps/web/app/onboarding/page.tsx`](/home/ubuntu/StudyBeta/studyclaw/apps/web/app/onboarding/page.tsx)
  - dashboard: [`apps/web/app/dashboard/page.tsx`](/home/ubuntu/StudyBeta/studyclaw/apps/web/app/dashboard/page.tsx)
  - chat: [`apps/web/app/chat/page.tsx`](/home/ubuntu/StudyBeta/studyclaw/apps/web/app/chat/page.tsx)
  - browser: [`apps/web/app/browser/page.tsx`](/home/ubuntu/StudyBeta/studyclaw/apps/web/app/browser/page.tsx)
  - grades / schedule / reminders / study / coach pages in `apps/web/app/*`

### What was inferred
- There is currently no StudyClaw-specific implementation of OpenClaw `before_agent_reply` in the checked repo, so adopting it likely means adding a plugin or hook-aware runtime seam rather than just flipping config.
- Task Flow appears available from the reviewed OpenClaw release, but StudyClaw’s current orchestration seems to lean on existing reminders/cron-like flows rather than OpenClaw Task Flow proper.
- The current repo likely uses direct agent prompting for some queries that could become deterministic tool/hook responses.

### What remains unknown
- Whether the live `~/.openclaw/openclaw.json` differs materially from the checked-in snapshot.
- Whether the live runtime already uses plugins or hook configuration not represented in this repo.
- Whether any existing StudyClaw workflow already depends on xAI search or Firecrawl fetch config paths in the live environment.

## 3. Critical Upgrade Tasks

| Priority | Task | Why it matters | Repo area likely affected | Complexity | Effort | Risk |
|---|---|---|---|---|---|---|
| P0 | Audit and reconcile live OpenClaw config vs repo snapshot | Prevents planning against stale config and catches migration drift early | `openclaw-home/openclaw.json`, operator runbooks, `README.md` | Low | S | Medium |
| P0 | Verify and migrate OpenClaw plugin-owned config paths | Avoids broken `x_search` / Firecrawl fetch behavior after stable upgrade | live OpenClaw config, ops docs, any research/admin runtime checks | Medium | S | Medium |
| P0 | Re-audit exec/tool policy for student-facing agents | Latest OpenClaw stable changes exec defaults; this is the biggest security boundary issue | `apps/api/src/lib/user-agent.ts`, OpenClaw config, security policy docs | Medium | M | High |
| P1 | Add post-update verification runbook for StudyClaw + OpenClaw | Makes upgrades repeatable and lowers regression risk | `README.md`, docs, smoke validation scripts | Low | S | Low |
| P1 | Verify browser exposure and Control UI origin posture | Browser Access is already in product; unsafe gateway exposure would compound risk | `openclaw-home/openclaw.json`, Browser feature docs, infra notes | Medium | S | High |

## 4. Product Improvements to Implement

| Priority | Task | User-facing benefit | OpenClaw dependency | Repo area likely affected | Complexity | Effort | Risk |
|---|---|---|---|---|---|---|---|
| P1 | Deterministic schedule replies | Accurate “what class is next/right now?” answers | `before_agent_reply` | chat, schedule backend, scheduler skill | Low | S | Low |
| P1 | Deterministic grade and target-grade replies | Cleaner grade estimates and less hallucinated advice | `before_agent_reply` | chat, grades backend, grade tracker skill | Low | S | Low |
| P1 | Task Flow weekly study plan | Durable, inspectable weekly study planning | Task Flow | dashboard, reminders, schedule, workflow layer | Medium | M | Medium |
| P1 | Task Flow exam-prep countdowns | Better due-date follow-through for students | Task Flow + cron/tasks | reminders, dashboard, exam data surfaces | Medium | M | Medium |
| P2 | Package custom StudyClaw skills more cleanly | Easier rollout and long-term maintainability | skills platform / plugin system | `openclaw-home/skills`, provisioning code, docs | Medium | M | Medium |
| P2 | Strengthen Browser Access around managed profiles | Better research continuity and cleaner future restrictions | browser profiles | browser page, browser backend/provider layer, policy hooks | Medium | M | Medium |
| P2 | Align durable StudyClaw memory with OpenClaw memory search | Better long-term context for students | memory index/search | memory service, chat context builder, ops docs | Medium | M | Medium |
| P3 | Android/mobile voice study entry points | Frictionless mobile study help | Android assistant / Talk Mode / Voice Wake | mobile-facing product planning, chat entry points, onboarding | High | L | Medium |
| P3 | Parent/teacher/admin-safe messaging boundaries | Safer external channel expansion later | channel policies / context visibility | policy/config/workflow docs, possibly admin console | High | L | High |

## 5. Quick Wins This Week
- Reconcile the live `~/.openclaw/openclaw.json` with the checked-in [`openclaw-home/openclaw.json`](/home/ubuntu/StudyBeta/openclaw-home/openclaw.json) and write down the differences.
- Run and document an OpenClaw-specific StudyClaw upgrade validation checklist:
  - `openclaw doctor --fix`
  - `openclaw gateway status`
  - `openclaw health`
  - StudyClaw chat/browser/library/schedule smoke flows
- Review student-agent tool allowlists in [`apps/api/src/lib/user-agent.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/user-agent.ts) against the new exec defaults and define what should stay enabled.
- Identify the exact chat decision points in [`apps/api/src/modules/chat/chat.route.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/modules/chat/chat.route.ts) where deterministic schedule/grade answers can intercept before LLM generation.
- Define the first Task Flow candidate in concrete product terms: “weekly plan” or “exam prep countdown,” not both.
- Document the current custom-skill lifecycle:
  - source of truth
  - how it gets copied into workspaces
  - how it should be versioned
- Review Browser Access policy seams and record what is already stubbed vs what still needs a formal restriction policy.

## 6. Recommended Build Order
1. **Audit live vs repo OpenClaw config**
   Rationale: this de-risks every other task because it tells you whether the repo and runtime actually match.
2. **Verify stable migrations and re-audit exec/tool policy**
   Rationale: these are the most upgrade-sensitive items and the highest risk if left implicit.
3. **Add a repeatable OpenClaw + StudyClaw post-update validation routine**
   Rationale: once you start adopting newer OpenClaw features, upgrades need a stable verification pattern.
4. **Implement deterministic schedule replies**
   Rationale: low complexity, high user value, and directly leverages the new `before_agent_reply` hook idea.
5. **Implement deterministic grade/target-grade replies**
   Rationale: same pattern as schedule, and highly valuable for students.
6. **Choose one Task Flow pilot: weekly study plan**
   Rationale: this is the strongest product leverage point and the clearest fit for StudyClaw.
7. **Add a second Task Flow pilot: exam-prep countdown / due-date follow-through**
   Rationale: builds on the same infrastructure and makes Task Flow more product-visible.
8. **Clean up custom skill/plugin lifecycle**
   Rationale: reduces future maintenance overhead before more OpenClaw features are layered in.
9. **Strengthen Browser Access policy and profile lifecycle**
   Rationale: improves an already-visible student feature and prepares for restrictions later.
10. **Only then explore mobile/voice or broader admin/teacher boundaries**
   Rationale: those are differentiators, but they depend on safe core workflow infrastructure first.

## 7. Milestone Plan

### Milestone 1: Safe upgrade and compatibility

**Goal**
- Align StudyClaw with current stable OpenClaw expectations and remove migration ambiguity.

**Tasks**
- Audit live vs repo OpenClaw config
- Verify `x_search` and Firecrawl migration state
- Re-audit exec/tool policy
- Add post-update validation checklist
- Review gateway/browser exposure posture

**Success looks like**
- You can point to a current source of truth for OpenClaw config.
- The stable migrations are confirmed handled.
- Student-facing agent policies are explicitly reviewed and documented.
- There is a repeatable operator checklist for upgrades.

**What can be demoed**
- A short operator demo:
  - version check
  - doctor
  - gateway status
  - successful StudyClaw chat/browser/library smoke checks

**Signals / metrics**
- Fewer upgrade surprises
- Faster recovery/debug after updates
- Lower ambiguity in operator docs

### Milestone 2: Core student workflow improvements

**Goal**
- Improve the accuracy and utility of existing student workflows without changing the core UI model.

**Tasks**
- Deterministic schedule replies
- Deterministic grade and target-grade replies
- Targeted chat interception points for data-backed student answers

**Success looks like**
- Schedule and grade questions return grounded answers reliably.
- Fewer unnecessary LLM turns for deterministic student-data questions.

**What can be demoed**
- “What class do I have now?”
- “What class is next?”
- “What’s my estimated grade in Biology?”
- “What do I need on the final to get a B?”

**Signals / metrics**
- Faster answers
- Better perceived trust/accuracy
- Lower model cost on deterministic queries

### Milestone 3: Automation and agent leverage

**Goal**
- Turn StudyClaw’s existing planning and reminder surfaces into durable workflows.

**Tasks**
- Task Flow weekly study plan
- Task Flow exam-prep countdown
- Workflow status surfaced in dashboard/reminders where appropriate

**Success looks like**
- Weekly plan and exam-prep flows survive restarts and are inspectable.
- Students see more reliable follow-through instead of one-off suggestions.

**What can be demoed**
- Create a weekly plan
- Restart or re-check workflow state
- Show plan persistence and next-step continuity

**Signals / metrics**
- More completed reminders/tasks
- Better weekly plan engagement
- Lower dropout on multi-step study flows

### Milestone 4: Differentiating features

**Goal**
- Extend StudyClaw into stronger, more defensible student workflows.

**Tasks**
- Custom skill/plugin lifecycle cleanup
- Browser Access policy/profile improvements
- Memory alignment with OpenClaw search
- Mobile/voice exploration

**Success looks like**
- Skills are easier to maintain and distribute.
- Browser research feels more continuous and policy-ready.
- Long-term context gets more useful across study sessions.

**What can be demoed**
- Versioned or clearly packaged StudyClaw skills
- Browser research session continuity
- Better context reuse across separate study sessions

**Signals / metrics**
- Less operator maintenance friction
- Higher student retention in research/study flows
- Better cross-session personalization

## 8. Task Breakdown

### Task 1: Audit live vs repo OpenClaw config
- **Why it matters:** The repo snapshot is not current enough to trust blindly after the OpenClaw update.
- **User-facing benefit:** Indirect but critical; prevents hidden breakage.
- **OpenClaw feature/dependency:** upgrade flow, doctor, gateway status.
- **Repo area likely affected:** [`openclaw-home/openclaw.json`](/home/ubuntu/StudyBeta/openclaw-home/openclaw.json), operator docs, StudyClaw README.
- **Complexity:** Low
- **Priority:** P0
- **Effort estimate:** XS
- **Risk level:** Medium
- **Prerequisites:** none
- **Definition of done:**
  - live and repo configs are compared
  - key differences are written down
  - source of truth is explicitly chosen
- **Suggested validation/test steps:**
  - capture live config paths
  - compare gateway, channels, plugins, skills, auth, model defaults
  - verify StudyClaw still points at the same gateway/token assumptions

### Task 2: Verify plugin-owned config migrations
- **Why it matters:** These are the two explicit stable migration items from the release review.
- **User-facing benefit:** Avoids subtle breakage in research/admin fetch behavior.
- **OpenClaw feature/dependency:** xAI plugin config, Firecrawl plugin config, `openclaw doctor --fix`
- **Repo area likely affected:** live OpenClaw config, any ops docs, possibly admin/research verification flows
- **Complexity:** Medium
- **Priority:** P0
- **Effort estimate:** S
- **Risk level:** Medium
- **Prerequisites:** Task 1
- **Definition of done:**
  - xAI search config path is verified
  - Firecrawl fetch config path is verified
  - any legacy assumptions are documented or removed from operator guidance
- **Suggested validation/test steps:**
  - run `openclaw doctor --fix`
  - inspect resulting config paths
  - test one search/fetch flow if those providers are in use

### Task 3: Re-audit student agent tool and exec policy
- **Why it matters:** New OpenClaw stable exec defaults increase the need for explicit policy review.
- **User-facing benefit:** Safer student deployment with fewer accidental high-privilege paths.
- **OpenClaw feature/dependency:** approvals, exec policy, security audit
- **Repo area likely affected:** [`apps/api/src/lib/user-agent.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/user-agent.ts), live OpenClaw config, security docs
- **Complexity:** Medium
- **Priority:** P0
- **Effort estimate:** M
- **Risk level:** High
- **Prerequisites:** Task 1
- **Definition of done:**
  - current student tool allowlists are reviewed
  - desired student exec posture is explicitly documented
  - any unsafe assumptions are identified before new feature work
- **Suggested validation/test steps:**
  - inspect effective student agent config
  - run security audit
  - test student-facing flows that rely on browser/tools

### Task 4: Add an OpenClaw upgrade verification runbook for StudyClaw
- **Why it matters:** Current OpenClaw updates should be treated like infra rollouts.
- **User-facing benefit:** More stable releases and fewer regressions.
- **OpenClaw feature/dependency:** update, doctor, gateway status, health
- **Repo area likely affected:** StudyClaw docs/runbooks, smoke scripts
- **Complexity:** Low
- **Priority:** P1
- **Effort estimate:** XS
- **Risk level:** Low
- **Prerequisites:** Tasks 1–3
- **Definition of done:**
  - operator runbook exists
  - post-update checks are concrete
  - StudyClaw smoke coverage is named explicitly
- **Suggested validation/test steps:**
  - execute the runbook once after drafting it
  - confirm all commands and checks are still current

### Task 5: Implement deterministic schedule replies
- **Why it matters:** Schedule answers are deterministic and should not depend on generic LLM reasoning.
- **User-facing benefit:** Faster, more trustworthy answers about current and next classes.
- **OpenClaw feature/dependency:** `before_agent_reply`
- **Repo area likely affected:**
  - [`apps/api/src/modules/chat/chat.route.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/modules/chat/chat.route.ts)
  - [`apps/api/src/lib/class-scheduler.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/class-scheduler.ts)
  - scheduler skill and agent context builders
- **Complexity:** Low
- **Priority:** P1
- **Effort estimate:** S
- **Risk level:** Low
- **Prerequisites:** Task 3
- **Definition of done:**
  - direct schedule questions are intercepted deterministically
  - fallback to normal chat still works when schedule data is missing
  - answers stay student-friendly and grounded
- **Suggested validation/test steps:**
  - test “What class do I have now?”
  - test “What class is next?”
  - test “Who is my teacher for chemistry?”
  - test no-schedule edge case

### Task 6: Implement deterministic grade and target-grade replies
- **Why it matters:** Grade math should be exact where data exists.
- **User-facing benefit:** More trusted grade estimates and final-target answers.
- **OpenClaw feature/dependency:** `before_agent_reply`
- **Repo area likely affected:**
  - [`apps/api/src/modules/chat/chat.route.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/modules/chat/chat.route.ts)
  - [`apps/api/src/lib/grade-tracker.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/grade-tracker.ts)
  - grade-tracker skill
- **Complexity:** Low
- **Priority:** P1
- **Effort estimate:** S
- **Risk level:** Low
- **Prerequisites:** Task 3
- **Definition of done:**
  - estimated-grade and target-grade queries use deterministic calculation
  - weighted/unweighted courses behave correctly
  - responses clearly note when data is incomplete
- **Suggested validation/test steps:**
  - weighted course example
  - unweighted course example
  - target-final scenario
  - missing-category / incomplete-data scenario

### Task 7: Build Task Flow weekly study plan
- **Why it matters:** This is the highest-leverage product opportunity from the OpenClaw release.
- **User-facing benefit:** Weekly plans become durable, inspectable, and less likely to disappear into one chat turn.
- **OpenClaw feature/dependency:** Task Flow
- **Repo area likely affected:**
  - dashboard
  - reminders
  - schedule
  - study planning logic
  - OpenClaw control/integration layer
- **Complexity:** Medium
- **Priority:** P1
- **Effort estimate:** M
- **Risk level:** Medium
- **Prerequisites:** Task 4
- **Definition of done:**
  - one weekly-plan flow exists with durable state
  - state can be inspected or recovered
  - dashboard/reminders show useful workflow output
- **Suggested validation/test steps:**
  - create a plan
  - simulate app/gateway restart
  - re-open plan state
  - verify reminders/tasks line up with plan outputs

### Task 8: Build Task Flow exam-prep countdown
- **Why it matters:** Exam preparation is a natural student workflow that benefits from persistence and sequencing.
- **User-facing benefit:** Better exam follow-through and less last-minute scrambling.
- **OpenClaw feature/dependency:** Task Flow + cron/tasks
- **Repo area likely affected:** reminders, dashboard, exams surfaces, agent orchestration
- **Complexity:** Medium
- **Priority:** P1
- **Effort estimate:** M
- **Risk level:** Medium
- **Prerequisites:** Task 7
- **Definition of done:**
  - exam-prep workflow can run across multiple days
  - progress is inspectable
  - student sees relevant next steps
- **Suggested validation/test steps:**
  - create an upcoming exam
  - start countdown plan
  - verify scheduled next steps and status visibility

### Task 9: Clean up custom skill/plugin lifecycle
- **Why it matters:** Current skill-copying works, but it is operator-heavy and harder to version well.
- **User-facing benefit:** Indirect but important; faster and safer rollout of school-specific capabilities.
- **OpenClaw feature/dependency:** skills platform, plugins
- **Repo area likely affected:**
  - `openclaw-home/skills/*`
  - `openclaw-home/extensions/*`
  - provisioning code in [`apps/api/src/lib/user-agent.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/user-agent.ts)
- **Complexity:** Medium
- **Priority:** P2
- **Effort estimate:** M
- **Risk level:** Medium
- **Prerequisites:** Tasks 1–4
- **Definition of done:**
  - source of truth for custom skills/plugins is clear
  - rollout/update path is documented
  - per-user provisioning is simpler or at least clearer
- **Suggested validation/test steps:**
  - provision a new student
  - confirm expected skills/plugins are available
  - update one skill and verify rollout behavior

### Task 10: Strengthen Browser Access around managed profiles and policy seams
- **Why it matters:** Browser is already student-visible, and policy/profile lifecycle is the next real gap.
- **User-facing benefit:** More reliable research sessions and cleaner future restrictions.
- **OpenClaw feature/dependency:** browser profiles, browser tool security guidance
- **Repo area likely affected:**
  - browser page/backend
  - browser provider abstraction
  - research-card flows in chat
- **Complexity:** Medium
- **Priority:** P2
- **Effort estimate:** M
- **Risk level:** Medium
- **Prerequisites:** Task 3
- **Definition of done:**
  - per-student browser session/profile expectations are defined
  - profile lifecycle is cleaner
  - policy insertion points are explicit
- **Suggested validation/test steps:**
  - launch browser
  - reconnect to same user session/profile
  - verify behavior across reload/restart

### Task 11: Align durable StudyClaw memory with OpenClaw memory search
- **Why it matters:** StudyClaw already has durable student memory; OpenClaw memory search could improve retrieval if used carefully.
- **User-facing benefit:** Better continuity across semesters and study sessions.
- **OpenClaw feature/dependency:** memory index/search
- **Repo area likely affected:**
  - student memory service
  - context builder
  - chat/retrieval flow
- **Complexity:** Medium
- **Priority:** P2
- **Effort estimate:** M
- **Risk level:** Medium
- **Prerequisites:** Task 4
- **Definition of done:**
  - clear division between StudyClaw structured memory and OpenClaw semantic retrieval
  - no duplicated/conflicting memory paths
  - retrieval improves useful continuity
- **Suggested validation/test steps:**
  - create known student context over several sessions
  - test recall on later study requests
  - compare retrieved context quality before/after

### Task 12: Explore Android/mobile voice entry points
- **Why it matters:** Strong differentiation, but not the best first move.
- **User-facing benefit:** Quick mobile study help and habit formation.
- **OpenClaw feature/dependency:** Android assistant entry points, Talk Mode, Voice Wake
- **Repo area likely affected:** onboarding, chat entry, mobile strategy, future nodes integration
- **Complexity:** High
- **Priority:** P3
- **Effort estimate:** L
- **Risk level:** Medium
- **Prerequisites:** Tasks 5–8
- **Definition of done:**
  - one clear mobile voice use case is selected
  - integration approach is defined
  - privacy/UX boundaries are acceptable
- **Suggested validation/test steps:**
  - prototype one prompt-to-chat flow
  - validate handoff quality and context behavior

## 9. Things To Delay Until Later
- Full teacher/admin messaging expansion across external channels
  - Reason: boundary and policy complexity is too high before core student workflows are hardened.
- Deep ClawHub/UI marketplace work
  - Reason: the most relevant operator UX improvements are still tied to unreleased OpenClaw work.
- Broad mobile/voice rollout
  - Reason: valuable, but it should come after deterministic answers and Task Flow make the core product stronger.
- Large-scale memory unification
  - Reason: StudyClaw already has a durable memory direction; forcing a broad merge too early could create duplication and confusion.
- Aggressive browser restrictions/allowlists implementation
  - Reason: the current priority is policy review and clean profile seams, not prematurely enforcing a half-designed restriction model.

## 10. Suggested Demo Plan

### Demo 1: Milestone 1
- Show:
  - current OpenClaw version
  - doctor output
  - gateway status
  - verified migration paths
  - explicit student exec/tool policy review
- What I should look for:
  - no ambiguity about source-of-truth config
  - clear proof that the stable migrations are handled

### Demo 2: Milestone 2
- Show:
  - schedule question answered deterministically
  - grade estimate answered deterministically
  - target-final answer with explicit assumptions
- What I should look for:
  - answers feel faster and more grounded than generic chat
  - no loss of fallback behavior when data is incomplete

### Demo 3: Milestone 3
- Show:
  - create a weekly study plan
  - inspect workflow state
  - show persistence across a restart or reload
  - show an exam-prep countdown flow
- What I should look for:
  - workflow durability
  - visible state and useful next-step behavior

### Demo 4: Milestone 4
- Show:
  - improved custom skill/plugin lifecycle
  - browser research continuity/profile behavior
  - stronger memory/context continuity
- What I should look for:
  - less operator friction
  - better student continuity

## 11. Final Recommendation
- Start with **Milestone 1 immediately**.
- Then do **two low-risk, high-value product wins in parallel**:
  1. deterministic schedule replies
  2. deterministic grade/target-grade replies
- After that, make **weekly study plan on Task Flow** the first major new product investment.

If you only pick one thing to start building after the upgrade work, pick:
- **Task 5 + Task 6 first if you want fast visible user value**
- **Task 7 first if you want the biggest long-term product leverage**
