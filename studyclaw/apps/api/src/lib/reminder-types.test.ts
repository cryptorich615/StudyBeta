import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReminderStatus, normalizeReminderType } from './reminder-types';

test('normalizeReminderType preserves supported newer reminder types', () => {
  assert.deepEqual(normalizeReminderType('quiz'), {
    requestedType: 'quiz',
    normalizedType: 'quiz',
    preservedRequestedType: null,
  });
  assert.deepEqual(normalizeReminderType('project'), {
    requestedType: 'project',
    normalizedType: 'project',
    preservedRequestedType: null,
  });
});

test('normalizeReminderType maps common aliases safely', () => {
  assert.equal(normalizeReminderType('Final').normalizedType, 'exam');
  assert.equal(normalizeReminderType('study').normalizedType, 'study_session');
  assert.equal(normalizeReminderType('office hours').normalizedType, 'meeting');
});

test('normalizeReminderType degrades unknown values to custom instead of crashing downstream', () => {
  assert.deepEqual(normalizeReminderType('field trip'), {
    requestedType: 'field trip',
    normalizedType: 'custom',
    preservedRequestedType: 'field trip',
  });
});

test('normalizeReminderStatus maps legacy scheduled to pending and validates supported statuses', () => {
  assert.equal(normalizeReminderStatus('scheduled'), 'pending');
  assert.equal(normalizeReminderStatus('completed'), 'completed');
  assert.equal(normalizeReminderStatus(undefined), 'pending');
  assert.throws(() => normalizeReminderStatus('broken'));
});
