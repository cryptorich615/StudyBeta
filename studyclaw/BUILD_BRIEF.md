# StudyClaw Build Brief

## Product intent
StudyClaw is a low-stress academic command center for students. It should help a student understand what matters now, what is coming next, and what action will reduce pressure fastest.

The current repository is a starter with:
- `apps/web`: Next.js prototype surface
- `apps/api`: Express API starter
- `schema.sql`: PostgreSQL MVP schema

The roadmap below targets an eventual mobile-first product. Because this repo currently uses a web frontend, Sprint 1 must either:
- replace `apps/web` with an Expo app, or
- keep `apps/web` as a prototype surface while a new Expo client is introduced alongside it

That platform decision should be treated as an explicit first task, not left implicit.

## Non-negotiable product rules
These rules override feature convenience and should drive implementation decisions:

1. Every screen must reduce student stress.
2. The home screen must show immediate academic priorities.
3. The AI must connect to real app data, not act isolated.
4. Assignments, exams, and files must drive suggestions automatically.
5. Reminders must be school-contextual.
6. The product must feel useful before the user types a prompt.

## Core UX principles
- Default to clarity over density. Show the next best action first.
- Prioritize deadlines, overdue work, and upcoming exams before secondary tools.
- Avoid blank states that ask the user to invent value manually.
- Use AI as an assistant grounded in stored courses, assignments, exams, reminders, and uploaded materials.
- Recommendations should be triggered by academic context changes, not only by chat prompts.
- Any automation should explain why it was suggested in school-specific language.

## Primary user outcomes
- A student opens the app and immediately sees what needs attention today.
- A student can add classes, assignments, exams, and reminders with minimal effort.
- Uploaded files and syllabus content automatically improve planning and suggestions.
- The assistant can answer questions using the student's real classes, deadlines, files, and history.
- The app creates momentum before a student enters the chat screen.

## Delivery roadmap

### Sprint 1
- Expo app scaffold
- Auth screens
- Bottom tab navigation
- Onboarding flow
- Backend API scaffold
- PostgreSQL schema
- Course and task CRUD

### Sprint 2
- Dashboard
- Upcoming assignments
- Reminder creation
- Push notification wiring
- Chat screen

### Sprint 3
- File upload
- Syllabus parser
- Study planner
- Grade estimator

### Sprint 4
- UI polish
- Edge cases
- Analytics
- Android build and internal testing

## Build requirements by surface

### Home or dashboard
- Must load with useful data even if the student never opens chat.
- Must rank tasks by urgency and academic impact.
- Must highlight overdue items, due-soon assignments, and upcoming exams.
- Must surface one-tap actions such as start study session, create reminder, open course, or ask AI about a specific task.

### Onboarding
- Must capture enough school context for relevant reminders and planning.
- Should collect school level, timezone, subjects or courses, grading context, and major deadlines.
- Should end with a useful dashboard state, not a dead-end success screen.

### AI assistant
- Must be grounded in courses, tasks, exams, reminders, and uploaded files.
- Must proactively suggest actions based on deadlines and study materials.
- Should be able to explain suggestions with references to concrete student context.

### Reminders
- Must be tied to real academic objects where possible.
- Should understand context such as exam date, assignment due date, study session timing, and subject.
- Should avoid generic reminders that ignore course reality.

### File intelligence
- Uploaded files should enrich course context automatically.
- Syllabus ingestion should create or suggest assignments, exams, and schedule anchors.
- Study planning should use deadlines, file content, and student workload together.

## Technical direction
- Backend remains the source of truth for academic data and AI orchestration.
- PostgreSQL should model courses, assignments, exams, reminders, uploaded files, and derived study artifacts.
- The AI integration should consume normalized app data rather than only raw user messages.
- Notifications and recommendation generation should be event-driven from academic data changes.

## Current repo gap analysis
- Frontend is `Next.js`, not `Expo`.
- Existing pages are placeholders and do not yet implement low-stress priority-driven UX.
- Current schema includes users, subjects, study assets, chat, and reminders, but does not yet model assignments and exams explicitly.
- Current API spec covers auth, onboarding, chat, study tools, and reminders, but not course/task CRUD in the form needed for the roadmap.

## Immediate implementation priorities
1. Decide whether to introduce Expo alongside the current web app or replace the web client.
2. Expand the schema for courses, assignments, exams, and planner state.
3. Add API endpoints for course, assignment, and exam CRUD.
4. Redesign the dashboard around immediate priorities rather than generic study tools.
5. Ground assistant responses in stored academic entities and uploaded materials.
