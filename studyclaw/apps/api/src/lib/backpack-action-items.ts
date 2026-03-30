export type BackpackActionItemSchedulePreset =
  | 'today_evening'
  | 'tomorrow_evening'
  | 'this_weekend';

export function normalizeSchedulePreset(
  value: unknown
): BackpackActionItemSchedulePreset {
  return value === 'tomorrow_evening' || value === 'this_weekend'
    ? value
    : 'today_evening';
}

export function normalizeActionItemText(value: unknown) {
  return String(value ?? '')
    .replace(/^[\-\*\u2022\d.\)\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getOffsetMinutesForTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const timeZoneName = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = timeZoneName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);

  if (!match) {
    return 0;
  }

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

function getLocalDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === 'year')?.value ?? '0'),
    month: Number(parts.find((part) => part.type === 'month')?.value ?? '1'),
    day: Number(parts.find((part) => part.type === 'day')?.value ?? '1'),
  };
}

function addDaysToDateParts(
  parts: { year: number; month: number; day: number },
  days: number
) {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function zonedLocalTimeToUtc(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}) {
  let guess = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute);
  for (let index = 0; index < 4; index += 1) {
    const offsetMinutes = getOffsetMinutesForTimeZone(new Date(guess), input.timeZone);
    const nextGuess =
      Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute) -
      offsetMinutes * 60_000;
    if (nextGuess === guess) {
      break;
    }
    guess = nextGuess;
  }

  return new Date(guess);
}

function getLocalWeekdayIndex(date: Date, timeZone: string) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(date);
  const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  return index >= 0 ? index : 0;
}

function trimReminderTitle(actionItem: string) {
  const normalized = normalizeActionItemText(actionItem);
  if (!normalized) {
    return 'Backpack study task';
  }

  return normalized.length > 72 ? `${normalized.slice(0, 69).trimEnd()}...` : normalized;
}

export function buildBackpackActionReminder(input: {
  actionItem: string;
  schedulePreset: BackpackActionItemSchedulePreset;
  timeZone?: string | null;
  now?: Date;
}) {
  const timeZone = input.timeZone?.trim() || 'America/New_York';
  const now = input.now ?? new Date();
  const localDate = getLocalDateParts(now, timeZone);
  const localWeekday = getLocalWeekdayIndex(now, timeZone);

  let targetDate = localDate;
  let targetHour = 18;
  let targetMinute = 0;

  if (input.schedulePreset === 'today_evening') {
    const tonight = zonedLocalTimeToUtc({
      ...localDate,
      hour: 18,
      minute: 0,
      timeZone,
    });

    if (tonight.getTime() <= now.getTime()) {
      targetDate = addDaysToDateParts(localDate, 1);
    }
  } else if (input.schedulePreset === 'tomorrow_evening') {
    targetDate = addDaysToDateParts(localDate, 1);
  } else {
    const daysUntilSaturday = (6 - localWeekday + 7) % 7 || 7;
    targetDate = addDaysToDateParts(localDate, daysUntilSaturday);
    targetHour = 10;
    targetMinute = 0;
  }

  const reminderAt = zonedLocalTimeToUtc({
    ...targetDate,
    hour: targetHour,
    minute: targetMinute,
    timeZone,
  });

  return {
    title: trimReminderTitle(input.actionItem),
    type: 'study_session',
    reminderAt,
  };
}
