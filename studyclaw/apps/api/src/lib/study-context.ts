import { db } from './db';
import { buildStudentContext, renderStudentMemoryContext } from './student-memory';
import { buildGradeTrackerContext } from './grade-tracker';
import { buildScheduleContext } from './class-scheduler';

type AgentProfile = {
  openclaw_agent_id: string;
  model_key: string;
  system_prompt: string;
  persona_name: string;
  tone: string;
  verbosity: string;
  teaching_style: string;
  reminder_style: string;
};

export async function loadAgentProfile(userId: string): Promise<AgentProfile | null> {
  const result = await db.query(`select * from agent_profiles where user_id = $1`, [userId]);
  return result.rows[0] ?? null;
}

export async function buildStudyContext(userId: string, options?: { query?: string | null }) {
  const [studentContext, gradeContext, scheduleContext] = await Promise.all([
    buildStudentContext(userId, options),
    buildGradeTrackerContext(userId, options?.query).catch(() => ({
      line: 'Grade tracker: none recorded yet.',
      conceptLine: 'Wrong-answer patterns: none recorded yet.',
    })),
    buildScheduleContext(userId, { query: options?.query ?? null }).catch(() => ({
      line: 'Schedule: none recorded yet.',
      todayLine: 'Today\'s classes: none scheduled.',
      detailLine: 'Relevant class detail: none matched yet.',
      context: null,
      referencedEntry: null,
    })),
  ]);

  return {
    ...studentContext,
    grades: gradeContext,
    schedule: scheduleContext,
  };
}

export function buildStudyInstructions(systemPrompt: string, context: Awaited<ReturnType<typeof buildStudyContext>>) {
  const personaMatch = systemPrompt.match(/^You are\s+([^,.\n]+)/i);
  const personaName = personaMatch?.[1]?.trim() || 'StudyClaw';
  const profileLines = context.profile
    ? [
        `Student name: ${context.profile.full_name ?? 'Unknown'}`,
        `School: ${context.profile.school_name ?? 'Unknown'}`,
        `Level: ${context.profile.school_level ?? 'other'}`,
        `Grade year: ${context.profile.grade_year ?? 'Unknown'}`,
        `Major: ${context.profile.major ?? 'Unknown'}`,
        `Timezone: ${context.profile.timezone ?? 'Unknown'}`,
        `Learning style: ${context.profile.learning_style ?? 'Unknown'}`,
        `Onboarding complete: ${context.profile.onboarding_complete ? 'yes' : 'no'}`,
      ]
    : ['No student profile is stored yet.'];

  const subjectLine = context.subjects.length
    ? `Subjects: ${context.subjects.join(', ')}`
    : 'Subjects: none recorded';

  const reminderLine = context.reminders.length
    ? `Upcoming reminders: ${context.reminders
        .map(
          (reminder: { title: string; type: string; reminder_at: string | Date; status: string }) =>
            `${reminder.title} (${reminder.type}, ${new Date(reminder.reminder_at).toISOString()}, ${reminder.status})`
        )
        .join(' | ')}`
    : 'Upcoming reminders: none scheduled';
  const calendarLine = context.calendar?.items?.length
    ? `Upcoming calendar items: ${context.calendar.items
        .map(
          (item: { title: string; startsAt: string | null; endsAt: string | null }) =>
            `${item.title} (${item.startsAt ?? 'unscheduled'}${item.endsAt ? ` to ${item.endsAt}` : ''})`
        )
        .join(' | ')}`
    : context.calendar?.status === 'reconnect_required'
      ? 'Upcoming calendar items: Google Calendar needs to be reconnected before StudyClaw can use it.'
      : 'Upcoming calendar items: none available';
  const memoryLines = context.memory ? renderStudentMemoryContext(context.memory) : null;
  const gradeLine = context.grades?.line ?? 'Grade tracker: none recorded yet.';
  const wrongAnswerLine = context.grades?.conceptLine ?? 'Wrong-answer patterns: none recorded yet.';
  const scheduleLine = context.schedule?.line ?? 'Schedule: none recorded yet.';
  const scheduleTodayLine = context.schedule?.todayLine ?? 'Today\'s classes: none scheduled.';
  const scheduleDetailLine = context.schedule?.detailLine ?? 'Relevant class detail: none matched yet.';

  return [
    systemPrompt.trim(),
    '',
    'Student context from StudyClaw:',
    ...profileLines,
    subjectLine,
    reminderLine,
    calendarLine,
    memoryLines?.progressLine ?? 'Relevant progress: none recorded yet',
    memoryLines?.assignmentLine ?? 'Tracked assignments: none recorded',
    memoryLines?.memoryLine ?? 'Long-term memory: none recorded yet',
    gradeLine,
    wrongAnswerLine,
    scheduleLine,
    scheduleTodayLine,
    scheduleDetailLine,
    '',
    'Behavior rules:',
    `- Your configured assistant name is ${personaName}.`,
    `- If asked your name or how to address you, answer with ${personaName}.`,
    personaName === 'StudyClaw' ? '- You may refer to yourself as StudyClaw.' : '- Do not say your name is StudyClaw.',
    '- Base your response on the student context when it is relevant.',
    '- If app data is missing, say so plainly instead of pretending the data exists.',
    '- If the student asks for Google Calendar scheduling or live calendar data and Google is not connected, tell them to connect Google Calendar from the Calendar page before promising calendar actions.',
    '- Prefer concrete, prioritized study actions over generic encouragement.',
    '- When the student asks for current facts, source verification, live web research, or screenshots of what you found, use the browser capability instead of relying only on memory.',
    '- When the student asks for textbooks, books by subject, editions, reading lists, book-based research, or an easier alternative to a dense book, use the Open Library tools first before broader web research.',
    '- When the student asks about class grades, estimated averages, weighted categories, finals, or target scores, use the stored grade tracker data and say clearly when a result is only an estimate.',
    '- When the student asks about missed questions or what they keep getting wrong, use the stored wrong-answer review patterns and explain the misconception in a supportive way.',
    '- When the student asks about what class they have now, next, later today, by period, by time, by teacher, by room, or by notes, use the saved schedule context if it exists.',
    '- Use the current or upcoming class context when it is genuinely helpful for school-related requests, but do not overstate certainty when the schedule is incomplete.',
    '- For browser-based research, prefer reliable educational or primary sources, summarize what you verified, and include direct source links in plain language whenever they are available.',
    '- Do not browse or continue if the destination is sexual, explicit, or otherwise inappropriate for students; explain briefly that the site is blocked.',
  ].join('\n');
}

export function buildChatTranscript(
  history: Array<{ role: string; content: string }>,
  latestMessage: string
) {
  const transcript = history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
    .join('\n\n');

  return transcript
    ? `${transcript}\n\nUser: ${latestMessage}`
    : latestMessage;
}
