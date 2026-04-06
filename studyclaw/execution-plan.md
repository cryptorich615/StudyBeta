# StudyClaw Execution Plan

## Purpose
This document converts `ideas.md` into a more execution-oriented plan with priority bands, sequencing, and practical work groupings.

It is meant to answer:
- what should happen first
- what is a quick win
- what is product leverage
- what is technical debt reduction
- what should wait

## Priority Bands

### P0
Do next. These reduce risk, unblock iteration, or fix structural issues that can easily cause regressions.

### P1
High-value product and platform improvements that should follow once the P0 work is under control.

### P2
Strong enhancements that matter, but are safer to do after the foundation is cleaner.

### P3
Nice-to-have or longer-range work that should not compete with near-term stability.

## P0: Immediate Priorities

### 1. Refactor chat orchestration into smaller modules
Area:
- backend
- agent orchestration

Why now:
- `apps/api/src/modules/chat/chat.route.ts` is the biggest risk hotspot in the repo
- too many features depend on it
- every new chat feature increases regression risk

Likely work:
- extract deterministic intent handlers
- extract streaming transport
- extract OpenClaw call wrapper
- extract post-reply background tasks
- reduce route-level branching

Expected benefit:
- safer chat changes
- easier debugging
- better testability

### 2. Split settings into section components
Area:
- frontend
- settings UX maintainability

Why now:
- `apps/web/app/settings/settings-shared.tsx` is too large to safely evolve
- settings already touches models, notifications, usage, scheduled jobs, and agent controls

Likely work:
- extract per-section panels
- centralize shared state fetches
- keep page shell thin

Expected benefit:
- lower UI regression risk
- easier iterative enhancement

### 3. Reconcile checked-in OpenClaw config with actual StudyClaw runtime behavior
Area:
- infra
- config
- agent setup

Why now:
- repo snapshot and actual runtime behavior appear partially out of sync
- this directly affects disaster recovery and fresh-machine setup

Likely work:
- compare `openclaw-home/openclaw.json` with current app-generated defaults
- remove stale student skill assumptions
- align default model/fallbacks/skill bundle strategy

Expected benefit:
- more reliable portability
- fewer setup surprises

### 4. Finish Browser safety controls before expanding the feature
Area:
- backend
- security
- admin controls

Why now:
- Browser is live enough to use, but code and docs explicitly say key controls are not complete

Likely work:
- restrictions enforcement
- allowlist/blocklist
- audit logs
- admin session controls

Expected benefit:
- lower security risk
- stronger operational confidence

### 5. Remove obvious repo cleanup debt
Area:
- docs
- repository hygiene

Why now:
- low-risk cleanup with immediate clarity gains

Likely work:
- remove `.bak` files
- remove stale placeholders or misleading copy
- clean checked-in leftovers that no longer represent intended defaults

Expected benefit:
- cleaner repo
- less confusion for future edits

## P1: High-Value Product and Platform Work

### 6. Persist reader/library state per user server-side
Area:
- backend
- study tools
- reader

Includes:
- saved books
- progress
- notes
- bookmarks
- highlights
- recent documents

Why this matters:
- turns the reader into a true cross-device workspace

### 7. Build a unified academic workload timeline
Area:
- backend
- dashboard
- planning

Combine:
- schedule
- grades
- reminders
- exams
- Google Calendar
- active study docs

Why this matters:
- gives the dashboard and chat a real prioritization engine

### 8. Make deterministic product replies persona-aware
Area:
- backend
- agent behavior

Applies to:
- grades
- reminders
- schedule
- reader actions
- study planning

Why this matters:
- Dixie/Willow become more than chat tone
- the whole product feels coherent

### 9. Add admin diagnostics for agent and integration failures
Area:
- admin
- observability

Track:
- slow chat requests
- OpenClaw failures
- Google failures
- reminder failures
- browser failures
- model/provider issues

Why this matters:
- faster debugging
- less guesswork

### 10. Add stronger browser-level test coverage
Area:
- QA
- automation

Priority flows:
- onboarding
- chat streaming
- calendar/google connect
- study/reader open flows
- dashboard basic path

Why this matters:
- protects the most change-heavy surfaces

## P2: Strong Enhancements

### 11. Improve active study context routing
Area:
- backend
- chat
- study tools

Goal:
- consistently know the current document, course, exam, and assignment
- make AI actions target the right thing automatically

### 12. Build session modes for StudyClaw coaching
Area:
- agent behavior
- planning

Examples:
- Sprint
- Deep Focus
- Concept Repair
- Exam Rescue
- Essay Build

### 13. Expand Google Workspace from access to workflow
Area:
- integrations
- study workflow

Examples:
- create study docs
- export notes
- save review sheets
- pull Google files into more study flows

### 14. Strengthen onboarding provider registry
Area:
- frontend
- backend
- onboarding

Goal:
- make future providers easier to add safely
- reduce page-local branching logic

### 15. Tighten startup/config validation
Area:
- infra
- backend

Examples:
- env validation
- CORS validation
- provider credential checks
- OpenClaw path checks

## P3: Later / Nice-to-Have

### 16. Expose more model providers in onboarding
Examples:
- Nvidia
- Moonshot / Kimi
- others supported by OpenClaw

Do this after:
- provider registry cleanup
- fallback logic is clearly centralized

### 17. Richer Google file fidelity in-reader
Examples:
- more faithful Docs/Slides rendering
- better sheet preview interaction

### 18. Larger dashboard redesign
Do this after:
- unified workload timeline exists
- priority engine is strong enough to justify a redesign

### 19. Broader channel expansion
Examples:
- more messaging surfaces
- more device/channel orchestration

Do this after:
- admin diagnostics improve
- permissions and operational controls are tighter

## Quick Wins

These are worth doing soon because they are cheap relative to value.

1. Remove `.bak` files from the repo.
2. Clean stale config/placeholder copy that no longer reflects current behavior.
3. Add startup validation for critical env/config values.
4. Add browser-smoke coverage for chat and onboarding to CI/local verification.
5. Split the easiest settings sections out of `settings-shared.tsx` first.

## Suggested Sequence

### Phase 1: Risk Reduction
1. Chat route refactor
2. Settings split
3. OpenClaw config reconciliation
4. Browser safety controls
5. Repo cleanup

### Phase 2: Product Leverage
6. Reader/library persistence
7. Unified workload timeline
8. Persona-aware deterministic replies
9. Admin diagnostics
10. More browser-level tests

### Phase 3: Feature Deepening
11. Active study context improvements
12. Session modes
13. Google workflow expansion
14. Onboarding provider registry cleanup
15. Startup/config validation hardening

### Phase 4: Expansion
16. More provider exposure
17. Better Google document fidelity
18. Larger dashboard evolution
19. Broader channel growth

## Recommended Owners By Work Type

### Frontend-heavy
- settings split
- onboarding provider registry cleanup
- dashboard evolution
- reader UX improvements

### Backend-heavy
- chat refactor
- unified workload timeline
- persona-aware deterministic responses
- config validation
- admin diagnostics

### Infra / platform
- OpenClaw config reconciliation
- browser safety controls
- verification and smoke expansion

## What To Do First

If only three things happen next:

1. Refactor chat orchestration.
2. Split settings into smaller components.
3. Reconcile repo OpenClaw config with actual runtime behavior.

That combination gives the biggest immediate payoff in:
- stability
- clarity
- future development speed

## What Not To Prioritize Yet

Avoid prioritizing these before the P0/P1 work is in better shape:
- exposing many more providers
- major dashboard redesign
- broad channel expansion
- heavy visual-fidelity work for every external document type

They are all valid, but they are not the best next use of time compared with structural cleanup and product-leverage work.
