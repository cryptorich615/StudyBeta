import { db } from './db';
import { buildStudentContext, renderStudentMemoryContext, type StudentContextScope } from './student-memory';
import { buildGradeTrackerContext } from './grade-tracker';
import { buildScheduleContext } from './class-scheduler';
import { getGoogleIntegration, listRecentDriveFiles } from './google-service';

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

export async function buildStudyContext(
  userId: string,
  options?: { query?: string | null; scope?: StudentContextScope }
) {
  const shouldLoadGoogleWorkspace =
    typeof options?.query === 'string' && /\b(google|drive|docs?|sheets?|slides?|gmail|mail|email|inbox)\b/i.test(options.query);

  const [studentContext, gradeContext, scheduleContext, googleWorkspace] = await Promise.all([
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
    Promise.all([
      getGoogleIntegration(userId).catch(() => null),
      shouldLoadGoogleWorkspace ? listRecentDriveFiles(userId, 5).catch(() => []) : Promise.resolve([]),
    ]).then(([status, files]) => ({
      status,
      files: files as Array<{ name?: string | null; mimeType?: string | null; modifiedTime?: string | null }>,
    })),
  ]);

  return {
    ...studentContext,
    grades: gradeContext,
    schedule: scheduleContext,
    googleWorkspace,
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
  const googleWorkspaceLine = context.googleWorkspace?.status
    ? context.googleWorkspace.status.connected
      ? `Google workspace: connected for ${context.googleWorkspace.status.googleEmail ?? 'this account'}${
          context.googleWorkspace.status.canUseWorkspaceSkill
            ? ` (Calendar${context.googleWorkspace.status.canReadDrive ? ', Drive' : ''}${context.googleWorkspace.status.canUseGmail ? ', Gmail read' : ''}${context.googleWorkspace.status.canSendGmail ? ', Gmail send' : ''}${context.googleWorkspace.status.canUseDocs ? ', Docs' : ''}${context.googleWorkspace.status.canUseSheets ? ', Sheets' : ''}${context.googleWorkspace.status.canUseSlides ? ', Slides' : ''})`
            : ''
        }`
      : context.googleWorkspace.status.needsReconnect
        ? 'Google workspace: reconnect required before StudyClaw can use Calendar, Gmail, Drive, Docs, Sheets, or Slides.'
        : 'Google workspace: not connected.'
    : 'Google workspace: not requested in this chat context.';
  const googleWorkspaceFilesLine =
    context.googleWorkspace?.files?.length
      ? `Recent Google files: ${context.googleWorkspace.files
          .map((file) => `${file.name ?? 'Untitled'} (${file.mimeType ?? 'unknown type'}${file.modifiedTime ? `, ${file.modifiedTime}` : ''})`)
          .join(' | ')}`
      : 'Recent Google files: none loaded.';

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
    googleWorkspaceLine,
    googleWorkspaceFilesLine,
    '',
    'Behavior rules:',
    `- Your configured assistant name is ${personaName}.`,
    `- If asked your name or how to address you, answer with ${personaName}.`,
    personaName === 'StudyClaw' ? '- You may refer to yourself as StudyClaw.' : '- Do not say your name is StudyClaw.',
    personaName === 'Dixie'
      ? '- You are the sprint coach. Lead with activation, focus defense, rapid reps, and protective momentum. Use pitbull-flavored metaphors lightly, not constantly.'
      : personaName === 'Willow'
        ? '- You are the deep-focus coach. Lead with calm understanding, gentle pacing, precise correction, and reflective confidence. Use cat-flavored metaphors lightly, not constantly.'
        : '- Stay practical and student-focused without adding persona theater.',
    personaName === 'Dixie'
      ? '- When the student is drifting, make the next step immediate and concrete. When the student is overloaded, downshift instead of pushing harder.'
      : personaName === 'Willow'
        ? '- When the student is anxious or tangled up, slow the pace and knead the concept until it softens. When urgency rises, compress gently without losing clarity.'
        : '- Match the student’s energy and workload without becoming generic.',
    '- Base your response on the student context when it is relevant.',
    '- If app data is missing, say so plainly instead of pretending the data exists.',
    '- You are operating inside StudyClaw, not a raw standalone OpenClaw shell. StudyClaw may execute connected integrations and deterministic app actions even when they are not exposed as raw tool names in your visible toolkit list.',
    '- Do not decide that a capability is unavailable just because you do not see a matching raw skill name like gmail, google-workspace, gh, or exec in a tool list.',
    '- If Google workspace is marked connected in this context, do not claim you lack Google integration or say you need a browser workaround first.',
    '- If Google workspace is marked connected in this context, treat that as authoritative proof that StudyClaw can use the connected Google account for the permissions listed there.',
    '- If Gmail send is available in the injected Google workspace status and the student asks to send an email, use StudyClaw’s Gmail path rather than talking about generic message channels.',
    '- If the student asks for Google Calendar scheduling or live calendar data and Google is not connected, tell them to connect Google Calendar from the Calendar page before promising calendar actions.',
    '- Do not ask the student to run or authenticate a separate Google CLI tool. Use StudyClaw’s connected Google integration instead.',
    '- If the student asks for Gmail, Google Drive, Docs, Sheets, or Slides help and the Google workspace connection is missing or incomplete, tell them to reconnect Google from the Calendar page so StudyClaw can request the needed workspace permissions.',
    '- If the student asks whether you currently have Google access, answer from the injected Google workspace status directly instead of speculating about your raw toolkit.',
    '- For short follow-ups like "check now", "try again", or "did the admin fix it", reuse the existing Google workspace status in context instead of inventing a new limitation.',
    '- Prefer concrete, prioritized study actions over generic encouragement.',
    '- When the student asks for current facts, source verification, live web research, or screenshots of what you found, use the browser capability instead of relying only on memory.',
    '- When the student asks for textbooks, books by subject, editions, reading lists, book-based research, or an easier alternative to a dense book, use the Open Library tools first before broader web research.',
    '- When the student asks about procrastination, focus, study consistency, or building better routines, use the study-habits and learning-optimizer guidance to propose realistic changes tied to their real schedule.',
    '- When the student asks for step-by-step teaching, multiple explanations, analogies, or worked examples, use the study-tutor and learn-cog guidance so the explanation adapts instead of repeating itself.',
    '- When the student asks how to study for a specific class, use the course-study guidance with their grades, assignments, schedule, wrong-answer patterns, and saved materials.',
    '- When the student asks for revision plans, cram plans, or exam preparation, use the study-revision-planner and exam guidance with their real dates, weak areas, and available time.',
    '- When the student wants a general study partner or check-in, use the study-buddy guidance to move the conversation toward a concrete next action inside StudyClaw.',
    '- When the student asks about class grades, estimated averages, weighted categories, finals, or target scores, use the stored grade tracker data and say clearly when a result is only an estimate.',
    '- When the student asks about missed questions or what they keep getting wrong, use the stored wrong-answer review patterns and explain the misconception in a supportive way.',
    '- When the student asks about what class they have now, next, later today, by period, by time, by teacher, by room, or by notes, use the saved schedule context if it exists.',
    '- Use the current or upcoming class context when it is genuinely helpful for school-related requests, but do not overstate certainty when the schedule is incomplete.',
    '- If StudyClaw already injected a direct answer source such as saved schedule data, grade summaries, calendar items, reminders, or Google workspace status, answer from that first instead of wandering into generic tool use.',
    '- For quick greetings, short tutoring prompts, or lightweight follow-ups, stay lean and do not re-summarize the entire student workspace unless it directly helps the answer.',
    '- For browser-based research, prefer reliable educational or primary sources, summarize what you verified, and include direct source links in plain language whenever they are available.',
    '- Do not browse or continue if the destination is sexual, explicit, or otherwise inappropriate for students; explain briefly that the site is blocked.',
  ].join('\n');
}

export function buildChatTranscript(
  history: Array<{ role: string; content: string }>,
  latestMessage: string,
  options?: { limit?: number }
) {
  const relevantHistory =
    typeof options?.limit === 'number' && options.limit > 0 ? history.slice(-options.limit) : history;
  const transcript = relevantHistory
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
    .join('\n\n');

  return transcript
    ? `${transcript}\n\nUser: ${latestMessage}`
    : latestMessage;
}
