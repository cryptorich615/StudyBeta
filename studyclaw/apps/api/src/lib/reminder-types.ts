const ALLOWED_REMINDER_TYPES = new Set([
  'exam',
  'assignment',
  'study_session',
  'meeting',
  'custom',
  'quiz',
  'test',
  'project',
  'paper',
  'essay',
  'lab',
  'homework',
  'participation',
]);

const REMINDER_TYPE_ALIASES: Record<string, string> = {
  exam: 'exam',
  final: 'exam',
  midterm: 'exam',
  quiz: 'quiz',
  test: 'test',
  assignment: 'assignment',
  homework: 'homework',
  project: 'project',
  paper: 'paper',
  essay: 'essay',
  lab: 'lab',
  meeting: 'meeting',
  office_hours: 'meeting',
  officehour: 'meeting',
  study: 'study_session',
  study_session: 'study_session',
  session: 'study_session',
  participation: 'participation',
  custom: 'custom',
};

export function normalizeReminderType(value: string | null | undefined) {
  const raw = `${value ?? ''}`.trim().toLowerCase();
  if (!raw) {
    throw new Error('type is required');
  }

  const compact = raw.replace(/\s+/g, '_').replace(/[^a-z_]/g, '');
  const normalized = REMINDER_TYPE_ALIASES[compact] ?? (ALLOWED_REMINDER_TYPES.has(compact) ? compact : 'custom');

  return {
    requestedType: raw,
    normalizedType: normalized,
    preservedRequestedType: normalized === raw ? null : raw,
  };
}

const ALLOWED_REMINDER_STATUSES = new Set([
  'pending',
  'scheduled',
  'sent',
  'cancelled',
  'completed',
]);

export function normalizeReminderStatus(value: string | null | undefined) {
  const raw = `${value ?? ''}`.trim().toLowerCase();
  if (!raw) {
    return 'pending';
  }

  if (raw === 'scheduled') {
    return 'pending';
  }

  if (ALLOWED_REMINDER_STATUSES.has(raw)) {
    return raw;
  }

  throw new Error('status must be one of pending, sent, completed, or cancelled');
}
