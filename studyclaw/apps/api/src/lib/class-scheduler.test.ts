import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScheduleContextFromEntries,
  findClassAfterLunch,
  findScheduleEntryAtTime,
  findScheduleEntryForPeriod,
  normalizeDaysOfWeek,
  parseScheduleIntent,
  parseTimeValue,
  timeToMinutes,
  type ScheduleEntryRecord,
} from './class-scheduler';

function makeEntry(overrides: Partial<ScheduleEntryRecord>): ScheduleEntryRecord {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    userId: overrides.userId ?? 'user-1',
    courseId: overrides.courseId ?? null,
    className: overrides.className ?? 'Algebra II',
    subject: overrides.subject ?? 'Math',
    roomNumber: overrides.roomNumber ?? '204',
    teacherName: overrides.teacherName ?? 'Ms. Rivera',
    startTime: overrides.startTime ?? '09:00',
    endTime: overrides.endTime ?? '09:50',
    period: overrides.period ?? 'Period 1',
    daysOfWeek: overrides.daysOfWeek ?? ['monday'],
    notes: overrides.notes ?? null,
    location: overrides.location ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}

test('normalizeDaysOfWeek accepts common weekday spellings safely', () => {
  assert.deepEqual(normalizeDaysOfWeek(['Mon', 'wednesday', 'Friday']), ['monday', 'wednesday', 'friday']);
});

test('parseTimeValue validates 24-hour times', () => {
  assert.equal(parseTimeValue('9:05'), '09:05');
  assert.equal(timeToMinutes('09:05'), 545);
  assert.throws(() => parseTimeValue('25:15'), /valid 24-hour values/);
});

test('buildScheduleContextFromEntries finds the current class from time-based entries', () => {
  const context = buildScheduleContextFromEntries(
    [
      makeEntry({ className: 'Chemistry', startTime: '10:00', endTime: '10:50', daysOfWeek: ['monday'] }),
      makeEntry({ className: 'English', startTime: '11:00', endTime: '11:50', daysOfWeek: ['monday'], period: 'Period 3' }),
    ],
    {
      timezone: 'UTC',
      now: new Date('2026-03-30T10:15:00.000Z'),
    }
  );

  assert.equal(context.status, 'in_class');
  assert.equal(context.currentClass?.className, 'Chemistry');
  assert.equal(context.nextClass?.className, 'English');
});

test('buildScheduleContextFromEntries prefers the later-starting block if entries overlap', () => {
  const context = buildScheduleContextFromEntries(
    [
      makeEntry({ className: 'Assembly', startTime: '10:00', endTime: '11:00', daysOfWeek: ['monday'] }),
      makeEntry({ className: 'Biology', startTime: '10:15', endTime: '11:00', daysOfWeek: ['monday'] }),
    ],
    {
      timezone: 'UTC',
      now: new Date('2026-03-30T10:20:00.000Z'),
    }
  );

  assert.equal(context.currentClass?.className, 'Biology');
});

test('buildScheduleContextFromEntries finds the next class when between classes', () => {
  const context = buildScheduleContextFromEntries(
    [
      makeEntry({ className: 'Chemistry', startTime: '10:00', endTime: '10:50', daysOfWeek: ['monday'] }),
      makeEntry({ className: 'English', startTime: '11:00', endTime: '11:50', daysOfWeek: ['monday'], period: 'Period 3' }),
    ],
    {
      timezone: 'UTC',
      now: new Date('2026-03-30T10:55:00.000Z'),
    }
  );

  assert.equal(context.status, 'between_classes');
  assert.equal(context.currentClass, null);
  assert.equal(context.nextClass?.className, 'English');
});

test('buildScheduleContextFromEntries handles no more classes gracefully', () => {
  const context = buildScheduleContextFromEntries(
    [makeEntry({ className: 'Biology', startTime: '08:00', endTime: '08:45', daysOfWeek: ['monday'] })],
    {
      timezone: 'UTC',
      now: new Date('2026-03-30T15:00:00.000Z'),
    }
  );

  assert.equal(context.status, 'no_more_classes');
  assert.equal(context.nextClass, null);
});

test('buildScheduleContextFromEntries ignores other weekdays', () => {
  const context = buildScheduleContextFromEntries(
    [makeEntry({ className: 'World History', daysOfWeek: ['tuesday'] })],
    {
      timezone: 'UTC',
      now: new Date('2026-03-30T10:00:00.000Z'),
    }
  );

  assert.equal(context.status, 'no_schedule');
});

test('findScheduleEntryForPeriod and findScheduleEntryAtTime handle direct lookups', () => {
  const entries = [
    makeEntry({ className: 'Lunch', period: 'Period 4', startTime: '12:00', endTime: '12:30' }),
    makeEntry({ className: 'Physics', period: 'Period 5', startTime: '12:35', endTime: '13:25' }),
  ];

  assert.equal(findScheduleEntryForPeriod(entries, '5')?.className, 'Physics');
  assert.equal(findScheduleEntryAtTime(entries, '12:40')?.className, 'Physics');
});

test('findClassAfterLunch returns the first class after a lunch block', () => {
  const entries = [
    makeEntry({ className: 'English', period: 'Period 3', startTime: '10:00', endTime: '10:50' }),
    makeEntry({ className: 'Lunch', period: 'Lunch', startTime: '12:00', endTime: '12:30' }),
    makeEntry({ className: 'Physics', period: 'Period 5', startTime: '12:35', endTime: '13:25' }),
  ];

  assert.equal(findClassAfterLunch(entries)?.className, 'Physics');
});

test('parseScheduleIntent understands current, next, period, and notes prompts', () => {
  assert.deepEqual(parseScheduleIntent('What class am I in right now?'), { type: 'current' });
  assert.deepEqual(parseScheduleIntent('What teacher do I have now?'), { type: 'current_teacher' });
  assert.deepEqual(parseScheduleIntent('What class do I have next?'), { type: 'next' });
  assert.deepEqual(parseScheduleIntent('What do I have during 3rd period?'), { type: 'period', query: '3' });
  assert.deepEqual(parseScheduleIntent('What notes do I have for English?'), { type: 'notes', query: 'English' });
});
