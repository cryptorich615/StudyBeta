import { db } from './db';
import { buildStudentContext, renderStudentMemoryContext } from './student-memory';

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
  return buildStudentContext(userId, options);
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
