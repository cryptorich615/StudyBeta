# Grade Tracker + Wrong Answer Review

StudyClaw now includes a course-aware grade tracker and a wrong-answer review workflow for students.

## Where It Lives

- API route: `apps/api/src/modules/grades/grades.route.ts`
- Core logic: `apps/api/src/lib/grade-tracker.ts`
- Student page: `apps/web/app/grades/page.tsx`
- Memory integration:
  - `apps/api/src/lib/student-memory.ts`
  - `apps/api/src/lib/study-context.ts`
- OpenClaw skill source: `openclaw-home/skills/grade-tracker/SKILL.md`

## What It Does

- Track course grades across quizzes, tests, homework, projects, participation, labs, finals, and custom categories
- Support weighted and unweighted estimation
- Return estimated numeric and letter grades
- Answer final-target questions like "What do I need on the final to get a B?"
- Store wrong-answer review items with concepts, explanations, and remediation
- Feed grade and weak-area context back into future study guidance

## API Surface

- `GET /api/grades`
- `POST /api/grades/courses`
- `POST /api/grades/courses/:courseId/settings`
- `POST /api/grades/items`
- `PATCH /api/grades/items/:itemId`
- `DELETE /api/grades/items/:itemId`
- `POST /api/grades/reviews`
- `PATCH /api/grades/reviews/:reviewId`
- `DELETE /api/grades/reviews/:reviewId`
- `POST /api/grades/reviews/:reviewId/explain`
- `POST /api/grades/final-target`

## Notes

- Grade estimates are not official transcript values. They depend on the grading weights and items the student has entered.
- Weighted calculations warn when some categories are still missing.
- Wrong-answer explanations prefer the live agent path, but the endpoint now falls back to a stored structured explanation if OpenClaw fails.

## Example Student Prompts

- `Add my biology quiz grade: 18/25`
- `What's my estimated grade in Algebra II?`
- `What do I need on the final in Chemistry to get a B?`
- `I got these chemistry questions wrong. Help me understand them.`
- `What concepts am I missing most in biology?`
