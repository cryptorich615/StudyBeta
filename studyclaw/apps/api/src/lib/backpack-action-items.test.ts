import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBackpackActionReminder,
  normalizeActionItemText,
  normalizeSchedulePreset,
} from './backpack-action-items';

test('normalizeSchedulePreset falls back to today_evening for unknown values', () => {
  assert.equal(normalizeSchedulePreset('tomorrow_evening'), 'tomorrow_evening');
  assert.equal(normalizeSchedulePreset('this_weekend'), 'this_weekend');
  assert.equal(normalizeSchedulePreset('anything-else'), 'today_evening');
});

test('normalizeActionItemText removes bullets and normalizes whitespace', () => {
  assert.equal(normalizeActionItemText('  •   Review   chapter 5   '), 'Review chapter 5');
});

test('today_evening uses same-day 6 PM when still ahead in local time', () => {
  const reminder = buildBackpackActionReminder({
    actionItem: 'Review chapter 5 practice problems',
    schedulePreset: 'today_evening',
    timeZone: 'America/New_York',
    now: new Date('2026-03-29T17:00:00.000Z'),
  });

  assert.equal(reminder.title, 'Review chapter 5 practice problems');
  assert.equal(reminder.type, 'study_session');
  assert.equal(reminder.reminderAt.toISOString(), '2026-03-29T22:00:00.000Z');
});

test('today_evening rolls to tomorrow when tonight has already passed', () => {
  const reminder = buildBackpackActionReminder({
    actionItem: 'Draft lab corrections',
    schedulePreset: 'today_evening',
    timeZone: 'America/New_York',
    now: new Date('2026-03-30T01:30:00.000Z'),
  });

  assert.equal(reminder.reminderAt.toISOString(), '2026-03-30T22:00:00.000Z');
});

test('this_weekend targets the next Saturday morning', () => {
  const reminder = buildBackpackActionReminder({
    actionItem: 'Turn summary into a weekend review block',
    schedulePreset: 'this_weekend',
    timeZone: 'America/New_York',
    now: new Date('2026-03-31T14:00:00.000Z'),
  });

  assert.equal(reminder.reminderAt.toISOString(), '2026-04-04T14:00:00.000Z');
});

test('reminder titles are trimmed to keep dashboard tasks readable', () => {
  const reminder = buildBackpackActionReminder({
    actionItem:
      'Finish the extremely long action item description that keeps going so the resulting reminder title stays readable on the dashboard',
    schedulePreset: 'tomorrow_evening',
    timeZone: 'America/New_York',
    now: new Date('2026-03-29T12:00:00.000Z'),
  });

  assert.equal(reminder.title.length <= 72, true);
});
