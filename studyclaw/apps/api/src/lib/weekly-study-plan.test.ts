import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyStudyPlan } from './weekly-study-plan';

test('weekly study plan prioritizes exams and assignments using real reminders', () => {
  const plan = buildWeeklyStudyPlan({
    now: new Date('2026-03-29T12:00:00.000Z'),
    reminders: [
      {
        id: 'exam-1',
        title: 'Chemistry Midterm',
        type: 'exam',
        reminder_at: '2026-03-29T18:00:00.000Z',
      },
      {
        id: 'assignment-1',
        title: 'History Essay Draft',
        type: 'assignment',
        reminder_at: '2026-03-30T19:00:00.000Z',
      },
    ],
    calendarEvents: [],
  });

  assert.equal(plan.length, 5);
  assert.match(plan[0]!.focus, /Chemistry Midterm/);
  assert.match(plan[0]!.blocks[0]!.title, /Active recall/);
  assert.match(plan[1]!.focus, /History Essay Draft/);
});

test('weekly study plan stays light on days with no reminders and no calendar load', () => {
  const plan = buildWeeklyStudyPlan({
    now: new Date('2026-03-29T12:00:00.000Z'),
    reminders: [],
    calendarEvents: [],
    days: 3,
  });

  assert.equal(plan[0]!.workload, 'light');
  assert.equal(plan[0]!.blocks.length > 0, true);
  assert.match(plan[0]!.focus, /review day|stay ahead/i);
});

test('weekly study plan marks a day heavy when calendar density is high', () => {
  const plan = buildWeeklyStudyPlan({
    now: new Date('2026-03-29T12:00:00.000Z'),
    reminders: [
      {
        id: 'task-1',
        title: 'Math worksheet',
        type: 'study_session',
        reminder_at: '2026-03-29T18:00:00.000Z',
      },
    ],
    calendarEvents: [
      { id: '1', title: 'Class 1', startsAt: '2026-03-29T13:00:00.000Z', endsAt: null },
      { id: '2', title: 'Class 2', startsAt: '2026-03-29T14:00:00.000Z', endsAt: null },
      { id: '3', title: 'Lab', startsAt: '2026-03-29T15:00:00.000Z', endsAt: null },
      { id: '4', title: 'Office hours', startsAt: '2026-03-29T16:00:00.000Z', endsAt: null },
    ],
    days: 1,
  });

  assert.equal(plan[0]!.workload, 'heavy');
});
