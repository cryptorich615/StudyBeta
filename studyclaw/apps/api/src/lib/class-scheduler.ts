import { db } from './db';
import { ensurePlatformSchema } from './platform-schema';
import { recordStudyEvent, writeMemorySummary } from './student-memory';

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
type Weekday = (typeof WEEKDAYS)[number];

export type ScheduleEntryInput = {
  courseId?: string | null;
  className: string;
  subject?: string | null;
  roomNumber?: string | null;
  teacherName?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  period?: string | null;
  daysOfWeek: string[];
  notes?: string | null;
  location?: string | null;
};

export type ScheduleEntryPatch = Partial<ScheduleEntryInput>;

export type ScheduleEntryRecord = {
  id: string;
  userId: string;
  courseId: string | null;
  className: string;
  subject: string | null;
  roomNumber: string | null;
  teacherName: string | null;
  startTime: string | null;
  endTime: string | null;
  period: string | null;
  daysOfWeek: Weekday[];
  notes: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleContextStatus =
  | 'in_class'
  | 'between_classes'
  | 'no_more_classes'
  | 'no_schedule';

export type ScheduleContext = {
  status: ScheduleContextStatus;
  now: string;
  today: Weekday;
  timezone: string;
  currentClass: ScheduleEntryRecord | null;
  nextClass: ScheduleEntryRecord | null;
  todaySchedule: ScheduleEntryRecord[];
  message: string;
};

type ZonedClock = {
  weekday: Weekday;
  minutes: number;
  label: string;
};

function cleanText(value: string | null | undefined, max = 200) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > max ? `${normalized.slice(0, max - 3).trim()}...` : normalized;
}

function normalizeClassName(value: string | null | undefined) {
  const normalized = cleanText(value, 120);
  if (!normalized) {
    throw new Error('Class name is required.');
  }
  return normalized;
}

function normalizeSubject(value: string | null | undefined) {
  return cleanText(value, 120);
}

function normalizeTeacher(value: string | null | undefined) {
  return cleanText(value, 120);
}

function normalizeRoom(value: string | null | undefined) {
  return cleanText(value, 60);
}

function normalizeLocation(value: string | null | undefined) {
  return cleanText(value, 120);
}

function normalizeNotes(value: string | null | undefined) {
  return cleanText(value, 500);
}

export function parseTimeValue(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error('Times must use HH:MM format.');
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error('Times must be valid 24-hour values.');
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function timeToMinutes(value: string | null | undefined) {
  const parsed = parseTimeValue(value);
  if (!parsed) return null;
  const [hours, minutes] = parsed.split(':').map(Number);
  return hours * 60 + minutes;
}

function normalizeWeekdayToken(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith('mon')) return 'monday';
  if (normalized.startsWith('tue')) return 'tuesday';
  if (normalized.startsWith('wed')) return 'wednesday';
  if (normalized.startsWith('thu')) return 'thursday';
  if (normalized.startsWith('fri')) return 'friday';
  if (normalized.startsWith('sat')) return 'saturday';
  if (normalized.startsWith('sun')) return 'sunday';
  return null;
}

export function normalizeDaysOfWeek(values: string[] | null | undefined) {
  const next = Array.from(
    new Set((values ?? []).map((value) => normalizeWeekdayToken(value)).filter((value): value is Weekday => Boolean(value)))
  );
  if (!next.length) {
    throw new Error('At least one day of the week is required.');
  }
  return next.sort((left, right) => WEEKDAYS.indexOf(left) - WEEKDAYS.indexOf(right));
}

function parsePeriodOrder(value: string | null | undefined) {
  if (!value) return null;
  const match = String(value).match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function compareScheduleEntries(left: ScheduleEntryRecord, right: ScheduleEntryRecord) {
  const leftStart = timeToMinutes(left.startTime);
  const rightStart = timeToMinutes(right.startTime);
  if (leftStart !== null || rightStart !== null) {
    return (leftStart ?? Number.MAX_SAFE_INTEGER) - (rightStart ?? Number.MAX_SAFE_INTEGER);
  }

  const leftPeriod = parsePeriodOrder(left.period);
  const rightPeriod = parsePeriodOrder(right.period);
  if (leftPeriod !== null || rightPeriod !== null) {
    return (leftPeriod ?? Number.MAX_SAFE_INTEGER) - (rightPeriod ?? Number.MAX_SAFE_INTEGER);
  }

  return left.className.localeCompare(right.className);
}

function mapEntry(row: any): ScheduleEntryRecord {
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.subject_id ?? null,
    className: row.class_name,
    subject: row.subject ?? null,
    roomNumber: row.room_number ?? null,
    teacherName: row.teacher_name ?? null,
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
    endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
    period: row.period ?? null,
    daysOfWeek: Array.isArray(row.days_of_week) ? row.days_of_week.map((value: string) => String(value).toLowerCase()).filter((value: string): value is Weekday => WEEKDAYS.includes(value as Weekday)) : [],
    notes: row.notes ?? null,
    location: row.location ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getUserTimezone(userId: string) {
  const result = await db.query(`select timezone from student_profiles where user_id = $1 limit 1`, [userId]);
  return result.rows[0]?.timezone ?? 'UTC';
}

function getZonedClock(now: Date, timezone: string): ZonedClock {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const weekdayPart = parts.find((part) => part.type === 'weekday')?.value.toLowerCase() as Weekday | undefined;
  const hourPart = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minutePart = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  const weekday = WEEKDAYS.includes(weekdayPart ?? 'monday') ? (weekdayPart as Weekday) : 'monday';
  return {
    weekday,
    minutes: hourPart * 60 + minutePart,
    label: `${String(hourPart).padStart(2, '0')}:${String(minutePart).padStart(2, '0')}`,
  };
}

function daySchedule(entries: ScheduleEntryRecord[], weekday: Weekday) {
  return entries.filter((entry) => entry.daysOfWeek.includes(weekday)).sort(compareScheduleEntries);
}

export function buildScheduleContextFromEntries(entries: ScheduleEntryRecord[], input?: { now?: Date; timezone?: string }) {
  const timezone = input?.timezone || 'UTC';
  const now = input?.now ?? new Date();
  const clock = getZonedClock(now, timezone);
  const todaySchedule = daySchedule(entries, clock.weekday);

  if (!todaySchedule.length) {
    return {
      status: 'no_schedule',
      now: now.toISOString(),
      today: clock.weekday,
      timezone,
      currentClass: null,
      nextClass: null,
      todaySchedule,
      message:
        clock.weekday === 'saturday' || clock.weekday === 'sunday'
          ? 'No classes are scheduled for today.'
          : 'No classes are scheduled for today yet.',
    } satisfies ScheduleContext;
  }

  const currentCandidates = todaySchedule.filter((entry) => {
    const start = timeToMinutes(entry.startTime);
    const end = timeToMinutes(entry.endTime);
    return start !== null && end !== null && clock.minutes >= start && clock.minutes < end;
  });
  const currentClass = currentCandidates.sort((left, right) => (timeToMinutes(right.startTime) ?? 0) - (timeToMinutes(left.startTime) ?? 0))[0] ?? null;

  const nextClass =
    todaySchedule
      .filter((entry) => {
        const start = timeToMinutes(entry.startTime);
        return start !== null && start > clock.minutes;
      })
      .sort(compareScheduleEntries)[0]
    ?? null;

  if (currentClass) {
    const afterCurrent = todaySchedule
      .filter((entry) => {
        const start = timeToMinutes(entry.startTime);
        return start !== null && start > (timeToMinutes(currentClass.endTime) ?? clock.minutes);
      })
      .sort(compareScheduleEntries)[0]
      ?? nextClass;

    return {
      status: 'in_class',
      now: now.toISOString(),
      today: clock.weekday,
      timezone,
      currentClass,
      nextClass: afterCurrent ?? null,
      todaySchedule,
      message: afterCurrent
        ? `You are in ${currentClass.className} right now. ${afterCurrent.className} is next.`
        : `You are in ${currentClass.className} right now. It is your last scheduled class today.`,
    } satisfies ScheduleContext;
  }

  if (nextClass) {
    return {
      status: 'between_classes',
      now: now.toISOString(),
      today: clock.weekday,
      timezone,
      currentClass: null,
      nextClass,
      todaySchedule,
      message: `You are between classes. ${nextClass.className} is next at ${nextClass.startTime}.`,
    } satisfies ScheduleContext;
  }

  return {
    status: 'no_more_classes',
    now: now.toISOString(),
    today: clock.weekday,
    timezone,
    currentClass: null,
    nextClass: null,
    todaySchedule,
    message: 'There are no more scheduled classes today.',
  } satisfies ScheduleContext;
}

export function findScheduleEntryByQuery(entries: ScheduleEntryRecord[], query: string) {
  const normalized = cleanText(query, 120)?.toLowerCase();
  if (!normalized) return null;
  return entries.find((entry) =>
    [entry.className, entry.subject, entry.teacherName, entry.roomNumber, entry.period, entry.notes]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalized))
  ) ?? null;
}

export function findScheduleEntryForPeriod(entries: ScheduleEntryRecord[], periodQuery: string) {
  const normalized = cleanText(periodQuery, 40)?.toLowerCase();
  if (!normalized) return null;
  return entries.find((entry) => String(entry.period ?? '').toLowerCase() === normalized || String(parsePeriodOrder(entry.period) ?? '') === normalized) ?? null;
}

export function findScheduleEntryAtTime(entries: ScheduleEntryRecord[], time: string) {
  const minutes = timeToMinutes(time);
  if (minutes === null) return null;
  return entries.find((entry) => {
    const start = timeToMinutes(entry.startTime);
    const end = timeToMinutes(entry.endTime);
    return start !== null && end !== null && minutes >= start && minutes < end;
  }) ?? null;
}

export function findClassAfterLunch(entries: ScheduleEntryRecord[]) {
  const sorted = [...entries].sort(compareScheduleEntries);
  const lunchIndex = sorted.findIndex((entry) =>
    [entry.className, entry.subject, entry.notes, entry.period]
      .filter(Boolean)
      .some((value) => /lunch/i.test(String(value)))
  );
  if (lunchIndex === -1) return null;
  return sorted.slice(lunchIndex + 1).find(Boolean) ?? null;
}

async function resolveSubjectId(userId: string, courseId?: string | null, className?: string | null, subject?: string | null) {
  if (courseId) {
    const existing = await db.query(`select id from subjects where id = $1 and user_id = $2 limit 1`, [courseId, userId]);
    if (!existing.rows[0]) {
      throw new Error('Subject not found for this account.');
    }
    return existing.rows[0].id as string;
  }

  const candidate = cleanText(subject || className, 120);
  if (!candidate) return null;
  const existing = await db.query(
    `select id from subjects where user_id = $1 and lower(name) = lower($2) limit 1`,
    [userId, candidate]
  );
  return existing.rows[0]?.id ?? null;
}

function normalizeScheduleInput(input: ScheduleEntryInput) {
  const className = normalizeClassName(input.className);
  const daysOfWeek = normalizeDaysOfWeek(input.daysOfWeek);
  const startTime = parseTimeValue(input.startTime);
  const endTime = parseTimeValue(input.endTime);
  if (!startTime && !endTime && !cleanText(input.period, 40)) {
    throw new Error('Add a start/end time or a period.');
  }
  if ((startTime && !endTime) || (!startTime && endTime)) {
    throw new Error('Provide both start and end time, or leave both empty.');
  }
  if (startTime && endTime && (timeToMinutes(startTime) ?? 0) >= (timeToMinutes(endTime) ?? 0)) {
    throw new Error('End time must be after start time.');
  }

  return {
    className,
    subject: normalizeSubject(input.subject),
    roomNumber: normalizeRoom(input.roomNumber),
    teacherName: normalizeTeacher(input.teacherName),
    startTime,
    endTime,
    period: cleanText(input.period, 40),
    daysOfWeek,
    notes: normalizeNotes(input.notes),
    location: normalizeLocation(input.location),
  };
}

export async function listScheduleEntries(userId: string) {
  await ensurePlatformSchema();
  const result = await db.query(
    `select *
     from class_schedule_entries
     where user_id = $1
     order by start_time asc nulls last, period asc nulls last, class_name asc`,
    [userId]
  );
  return result.rows.map(mapEntry);
}

export async function getScheduleSnapshot(userId: string, options?: { now?: Date; timezone?: string | null }) {
  await ensurePlatformSchema();
  const [entries, timezone] = await Promise.all([
    listScheduleEntries(userId),
    options?.timezone ? Promise.resolve(options.timezone) : getUserTimezone(userId),
  ]);
  return {
    entries,
    context: buildScheduleContextFromEntries(entries, {
      now: options?.now,
      timezone: timezone || 'UTC',
    }),
  };
}

export async function createScheduleEntry(userId: string, input: ScheduleEntryInput) {
  await ensurePlatformSchema();
  const normalized = normalizeScheduleInput(input);
  const subjectId = await resolveSubjectId(userId, input.courseId, normalized.className, normalized.subject);
  const result = await db.query(
    `insert into class_schedule_entries (
       user_id, subject_id, class_name, subject, room_number, teacher_name, start_time, end_time, period, days_of_week, notes, location
     )
     values ($1, $2, $3, $4, $5, $6, $7::time, $8::time, $9, $10::text[], $11, $12)
     returning *`,
    [
      userId,
      subjectId,
      normalized.className,
      normalized.subject,
      normalized.roomNumber,
      normalized.teacherName,
      normalized.startTime,
      normalized.endTime,
      normalized.period,
      normalized.daysOfWeek,
      normalized.notes,
      normalized.location,
    ]
  );

  const entry = mapEntry(result.rows[0]);
  await recordStudyEvent({
    userId,
    eventKey: `schedule-entry:${entry.id}:created`,
    eventType: 'schedule_entry_created',
    sourceType: 'schedule_entry',
    sourceId: entry.id,
    courseId: subjectId,
    payload: {
      className: entry.className,
      daysOfWeek: entry.daysOfWeek,
    },
  });
  await writeMemorySummary({
    userId,
    summaryType: 'schedule_context',
    summary: `Student has ${entry.className}${entry.teacherName ? ` with ${entry.teacherName}` : ''}${entry.roomNumber ? ` in room ${entry.roomNumber}` : ''} on ${entry.daysOfWeek.join(', ')}.`,
    courseId: subjectId,
    summaryKey: `schedule-entry:${entry.id}`,
    importance: 3,
  });

  return entry;
}

export async function updateScheduleEntry(userId: string, entryId: string, patch: ScheduleEntryPatch) {
  await ensurePlatformSchema();
  const existingResult = await db.query(`select * from class_schedule_entries where id = $1 and user_id = $2 limit 1`, [entryId, userId]);
  const existing = existingResult.rows[0];
  if (!existing) {
    throw new Error('Schedule entry not found.');
  }

  const normalized = normalizeScheduleInput({
    courseId: patch.courseId ?? existing.subject_id,
    className: patch.className ?? existing.class_name,
    subject: patch.subject ?? existing.subject,
    roomNumber: patch.roomNumber ?? existing.room_number,
    teacherName: patch.teacherName ?? existing.teacher_name,
    startTime: patch.startTime ?? (existing.start_time ? String(existing.start_time).slice(0, 5) : null),
    endTime: patch.endTime ?? (existing.end_time ? String(existing.end_time).slice(0, 5) : null),
    period: patch.period ?? existing.period,
    daysOfWeek: patch.daysOfWeek ?? existing.days_of_week,
    notes: patch.notes ?? existing.notes,
    location: patch.location ?? existing.location,
  });
  const subjectId = await resolveSubjectId(userId, patch.courseId ?? existing.subject_id, normalized.className, normalized.subject);

  const result = await db.query(
    `update class_schedule_entries
     set subject_id = $3,
         class_name = $4,
         subject = $5,
         room_number = $6,
         teacher_name = $7,
         start_time = $8::time,
         end_time = $9::time,
         period = $10,
         days_of_week = $11::text[],
         notes = $12,
         location = $13
     where id = $1
       and user_id = $2
     returning *`,
    [
      entryId,
      userId,
      subjectId,
      normalized.className,
      normalized.subject,
      normalized.roomNumber,
      normalized.teacherName,
      normalized.startTime,
      normalized.endTime,
      normalized.period,
      normalized.daysOfWeek,
      normalized.notes,
      normalized.location,
    ]
  );

  return mapEntry(result.rows[0]);
}

export async function deleteScheduleEntry(userId: string, entryId: string) {
  await ensurePlatformSchema();
  const result = await db.query(`delete from class_schedule_entries where id = $1 and user_id = $2 returning id`, [entryId, userId]);
  if (!result.rows[0]) {
    throw new Error('Schedule entry not found.');
  }
}

export async function buildScheduleContext(userId: string, options?: { query?: string | null; timezone?: string | null; now?: Date }) {
  const snapshot = await getScheduleSnapshot(userId, { now: options?.now, timezone: options?.timezone ?? null });
  const context = snapshot.context;
  const query = String(options?.query ?? '').toLowerCase();
  const todaySummary = context.todaySchedule.slice(0, 6).map((entry) => {
    const timeLabel = entry.startTime && entry.endTime ? `${entry.startTime}-${entry.endTime}` : entry.period ?? 'unscheduled';
    const suffix = [entry.teacherName ? `teacher ${entry.teacherName}` : null, entry.roomNumber ? `room ${entry.roomNumber}` : null]
      .filter(Boolean)
      .join(', ');
    return `${entry.className} (${timeLabel}${suffix ? `, ${suffix}` : ''})`;
  });

  const referenced = query
    ? findScheduleEntryByQuery(snapshot.entries, query)
      ?? (/period/i.test(query) ? findScheduleEntryForPeriod(snapshot.entries, query.replace(/.*period\s*/i, '').trim()) : null)
      ?? (/after lunch/i.test(query) ? findClassAfterLunch(context.todaySchedule) : null)
    : null;

  return {
    line: `Schedule: ${context.message}`,
    todayLine: todaySummary.length ? `Today's classes: ${todaySummary.join(' | ')}` : 'Today\'s classes: none scheduled.',
    detailLine: referenced
      ? `Relevant class detail: ${referenced.className}${referenced.teacherName ? ` with ${referenced.teacherName}` : ''}${referenced.roomNumber ? ` in room ${referenced.roomNumber}` : ''}${referenced.notes ? `. Notes: ${referenced.notes}` : ''}`
      : 'Relevant class detail: none matched yet.',
    context,
    referencedEntry: referenced,
  };
}

export function parseScheduleIntent(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return null;

  if (/what teacher do i have (right now|now|currently)/i.test(trimmed)) {
    return { type: 'current_teacher' as const };
  }
  if (/what class am i in (right now|now|currently)|what class do i have (right now|now|currently)/i.test(trimmed)) {
    return { type: 'current' as const };
  }
  if (/what class do i have next|what'?s my next class/i.test(trimmed)) {
    return { type: 'next' as const };
  }
  if (/show my schedule for today|what classes do i have today|what is my schedule today/i.test(trimmed)) {
    return { type: 'today' as const };
  }

  const teacherMatch = trimmed.match(/who is my teacher for (?<class>.+?)[?!.]?$/i);
  if (teacherMatch?.groups?.class) {
    return { type: 'teacher' as const, query: cleanText(teacherMatch.groups.class, 120) };
  }

  const roomMatch = trimmed.match(/what room is (?<class>.+?) in[?!.]?$/i);
  if (roomMatch?.groups?.class) {
    return { type: 'room' as const, query: cleanText(roomMatch.groups.class, 120) };
  }

  const notesMatch = trimmed.match(/what notes do i have for (?<class>.+?)[?!.]?$/i);
  if (notesMatch?.groups?.class) {
    return { type: 'notes' as const, query: cleanText(notesMatch.groups.class, 120) };
  }

  const periodMatch = trimmed.match(/what do i have during (?:(?<ordinal>\d+)(?:st|nd|rd|th)\s+period|period\s+(?<period>\d+)|(?<time>\d{1,2}:\d{2})|after lunch)[?!.]?$/i);
  if (periodMatch?.groups?.time) {
    return { type: 'time' as const, query: periodMatch.groups.time };
  }
  if (periodMatch?.groups?.ordinal || periodMatch?.groups?.period) {
    return { type: 'period' as const, query: String(periodMatch.groups.ordinal ?? periodMatch.groups.period) };
  }
  if (/after lunch/i.test(trimmed)) {
    return { type: 'after_lunch' as const };
  }

  return null;
}
