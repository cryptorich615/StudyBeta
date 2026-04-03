# Class Scheduler / Timetable

StudyClaw includes a student class scheduler so the app and agent can use class context during the school day.

## Where It Lives

- API route: `apps/api/src/modules/schedule/schedule.route.ts`
- Core logic: `apps/api/src/lib/class-scheduler.ts`
- Student page: `apps/web/app/schedule/page.tsx`
- Agent context: `apps/api/src/lib/study-context.ts`
- Chat schedule shortcuts: `apps/api/src/modules/chat/chat.route.ts`
- OpenClaw skill source: `openclaw-home/skills/class-scheduler/SKILL.md`

## What It Does

- Save recurring class blocks by weekday
- Support time-based and period-based class entries
- Track room, teacher, notes, and location
- Answer current / next class questions
- Let the agent use current class context when relevant

## API Surface

- `GET /api/schedule`
- `POST /api/schedule/entries`
- `PATCH /api/schedule/entries/:entryId`
- `DELETE /api/schedule/entries/:entryId`

## Example Student Prompts

- `What class am I in right now?`
- `What class do I have next?`
- `Who is my teacher for chemistry?`
- `What room is Algebra in?`
- `What do I have during 3rd period?`
- `What class is after lunch?`
- `What notes do I have for English?`

## Notes

- If a class has start and end times, those are used as the main source of truth for current / next class logic.
- Period-only entries are still supported for lookups by period, but they do not let StudyClaw infer the live current class from the clock.
- If the student has not saved a schedule yet, the agent asks them to add one instead of pretending to know it.
