type ReminderLike = {
  id: string;
  title: string;
  type: string;
  reminder_at: string;
};

type CalendarEventLike = {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
};

export type WeeklyStudyPlanDay = {
  dateKey: string;
  label: string;
  workload: 'light' | 'steady' | 'heavy';
  focus: string;
  blocks: Array<{
    title: string;
    detail: string;
    timeLabel: string;
  }>;
};

function toDateKey(value: Date | string) {
  return new Date(value).toISOString().slice(0, 10);
}

function formatDayLabel(value: Date) {
  return value.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isExamType(type: string) {
  return /exam|quiz|test|midterm|final/i.test(type);
}

function isAssignmentType(type: string) {
  return /assignment|project|paper|essay|lab|homework/i.test(type);
}

function chooseWorkload(remindersCount: number, calendarCount: number, includesExam: boolean) {
  if (includesExam || remindersCount >= 3 || calendarCount >= 4) {
    return 'heavy' as const;
  }
  if (remindersCount >= 1 || calendarCount >= 2) {
    return 'steady' as const;
  }
  return 'light' as const;
}

function getTimeLabel(date: Date, workload: WeeklyStudyPlanDay['workload'], blockIndex: number) {
  const weekday = date.getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  if (weekend) {
    return blockIndex === 0 ? 'Weekend morning' : 'Weekend afternoon';
  }

  if (workload === 'heavy') {
    return blockIndex === 0 ? 'Right after class' : 'Early evening';
  }

  return blockIndex === 0 ? 'Early evening' : 'After dinner';
}

function buildFocus(reminders: ReminderLike[], calendarCount: number) {
  const exam = reminders.find((item) => isExamType(item.type));
  if (exam) {
    return `Protect recall time for ${exam.title}.`;
  }

  const assignment = reminders.find((item) => isAssignmentType(item.type));
  if (assignment) {
    return `Move ${assignment.title} forward before it becomes last-minute work.`;
  }

  if (reminders[0]) {
    return `Keep momentum on ${reminders[0].title}.`;
  }

  if (calendarCount > 0) {
    return 'Keep the day light and review around your existing schedule.';
  }

  return 'Use this as a low-pressure review day to stay ahead.';
}

function buildBlocks(input: {
  day: Date;
  reminders: ReminderLike[];
  calendarEvents: CalendarEventLike[];
  workload: WeeklyStudyPlanDay['workload'];
}) {
  const blocks: WeeklyStudyPlanDay['blocks'] = [];
  const exam = input.reminders.find((item) => isExamType(item.type));
  const assignment = input.reminders.find((item) => isAssignmentType(item.type));

  if (exam) {
    blocks.push({
      title: `Active recall for ${exam.title}`,
      detail: 'Quiz yourself, then patch weak spots instead of rereading everything.',
      timeLabel: getTimeLabel(input.day, input.workload, 0),
    });
  }

  if (assignment) {
    blocks.push({
      title: `Progress block for ${assignment.title}`,
      detail: 'Finish one concrete chunk so the deadline stops hovering over the rest of the week.',
      timeLabel: getTimeLabel(input.day, input.workload, blocks.length),
    });
  }

  if (!blocks.length && input.reminders[0]) {
    blocks.push({
      title: `Study block for ${input.reminders[0].title}`,
      detail: 'Turn the next due item into a focused work block before you context switch.',
      timeLabel: getTimeLabel(input.day, input.workload, 0),
    });
  }

  if (blocks.length < 2) {
    blocks.push({
      title: input.calendarEvents.length
        ? 'Light review between scheduled events'
        : 'Short review and cleanup block',
      detail: input.calendarEvents.length
        ? 'Keep this one short so your calendar load does not crowd out progress.'
        : 'Review notes, clean up one loose end, and set tomorrow up.',
      timeLabel: getTimeLabel(input.day, input.workload, blocks.length),
    });
  }

  return blocks.slice(0, 2);
}

export function buildWeeklyStudyPlan(input: {
  reminders: ReminderLike[];
  calendarEvents: CalendarEventLike[];
  days?: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const days = Math.max(3, Math.min(input.days ?? 5, 7));

  return Array.from({ length: days }, (_, index) => {
    const day = addDays(now, index);
    const dateKey = toDateKey(day);
    const dayReminders = input.reminders
      .filter((item) => toDateKey(item.reminder_at) === dateKey)
      .sort((left, right) => new Date(left.reminder_at).getTime() - new Date(right.reminder_at).getTime());
    const dayCalendarEvents = input.calendarEvents.filter(
      (item) => item.startsAt && toDateKey(item.startsAt) === dateKey
    );
    const workload = chooseWorkload(
      dayReminders.length,
      dayCalendarEvents.length,
      dayReminders.some((item) => isExamType(item.type))
    );

    return {
      dateKey,
      label: formatDayLabel(day),
      workload,
      focus: buildFocus(dayReminders, dayCalendarEvents.length),
      blocks: buildBlocks({
        day,
        reminders: dayReminders,
        calendarEvents: dayCalendarEvents,
        workload,
      }),
    };
  });
}
