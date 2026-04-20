const ALLOWED_REMINDER_TYPES = new Set([
  'exam',
  'assignment',
  'study_session',
  'meeting',
  'custom',
]);

const REMINDER_TYPE_ALIASES: Record<string, string> = {
  exam: 'exam',
  final: 'exam',
  midterm: 'exam',
  quiz: 'exam',
  test: 'exam',
  assignment: 'assignment',
  homework: 'assignment',
  project: 'assignment',
  paper: 'assignment',
  essay: 'assignment',
  lab: 'assignment',
  meeting: 'meeting',
  office_hours: 'meeting',
  officehour: 'meeting',
  study: 'study_session',
  study_session: 'study_session',
  session: 'study_session',
  participation: 'assignment',
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
    return 'scheduled';
  }

  if (raw === 'pending' || raw === 'scheduled') {
    return 'scheduled';
  }

  if (raw === 'completed' || raw === 'sent') {
    return 'sent';
  }

  if (ALLOWED_REMINDER_STATUSES.has(raw)) {
    return raw;
  }

  throw new Error('status must be one of pending, scheduled, sent, completed, or cancelled');
}

export function presentReminderStatus(value: string | null | undefined) {
  const raw = `${value ?? ''}`.trim().toLowerCase();
  if (!raw || raw === 'scheduled') {
    return 'pending';
  }

  if (raw === 'sent') {
    return 'sent';
  }

  if (raw === 'cancelled') {
    return 'cancelled';
  }

  return raw;
}
