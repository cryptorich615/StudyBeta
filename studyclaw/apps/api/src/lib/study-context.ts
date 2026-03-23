import { db } from './db';

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

export async function buildStudyContext(userId: string) {
  const [profileResult, subjectsResult, remindersResult] = await Promise.all([
    db.query(
      `select u.full_name, sp.school_name, sp.school_level, sp.grade_year, sp.major, sp.timezone, sp.learning_style, sp.onboarding_complete
       from student_profiles sp
       join users u on u.id = sp.user_id
       where sp.user_id = $1`,
      [userId]
    ),
    db.query(
      `select name
       from subjects
       where user_id = $1
       order by created_at asc
       limit 12`,
      [userId]
    ),
    db.query(
      `select type, title, reminder_at, status
       from reminders
       where user_id = $1
       order by reminder_at asc
       limit 8`,
      [userId]
    ),
  ]);

  return {
    profile: profileResult.rows[0] ?? null,
    subjects: subjectsResult.rows.map((row: { name: string }) => row.name),
    reminders: remindersResult.rows,
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

  return [
    systemPrompt.trim(),
    '',
    'Student context from StudyClaw:',
    ...profileLines,
    subjectLine,
    reminderLine,
    '',
    'Behavior rules:',
    `- Your configured assistant name is ${personaName}.`,
    `- If asked your name or how to address you, answer with ${personaName}.`,
    personaName === 'StudyClaw' ? '- You may refer to yourself as StudyClaw.' : '- Do not say your name is StudyClaw.',
    '- Base your response on the student context when it is relevant.',
    '- If app data is missing, say so plainly instead of pretending the data exists.',
    '- Prefer concrete, prioritized study actions over generic encouragement.',
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
