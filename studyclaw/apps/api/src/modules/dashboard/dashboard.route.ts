import { Router } from 'express';
import { db } from '../../lib/db';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { getGoogleConnectionStatus, listUpcomingCalendarEvents } from '../../lib/google-service';
import { ensurePlatformSchema } from '../../lib/platform-schema';
import { buildWeeklyStudyPlan } from '../../lib/weekly-study-plan';
import { listGradeDashboard } from '../../lib/grade-tracker';
import { getScheduleSnapshot } from '../../lib/class-scheduler';
import { listContinueReadingItems } from '../../lib/library-workspace';

type ReminderRow = {
  id: string;
  title: string;
  type: string;
  status: string;
  reminder_at: string;
  metadata_json?: Record<string, unknown> | null;
};

function hoursUntil(value: string) {
  return (new Date(value).getTime() - Date.now()) / (1000 * 60 * 60);
}

function describeUrgency(value: string) {
  const hours = hoursUntil(value);

  if (hours <= 0) return 'Overdue';
  if (hours < 6) return 'Due in the next few hours';
  if (hours < 24) return 'Due today';
  if (hours < 72) return 'Due soon';
  return 'Upcoming';
}

function priorityScore(reminder: ReminderRow) {
  const hours = hoursUntil(reminder.reminder_at);
  const typeWeight =
    /exam|midterm|final|test/i.test(reminder.type) ? 0 :
    /quiz/i.test(reminder.type) ? 4 :
    /assignment|project|paper|essay|lab/i.test(reminder.type) ? 8 :
    12;

  return Math.max(hours, -24) + typeWeight;
}

function buildRecommendations(reminders: ReminderRow[], counts: {
  flashcardSets: number;
  quizzes: number;
  knowledgeItems: number;
}) {
  const recommendations: string[] = [];
  const nextExam = reminders.find((reminder) => /exam|quiz|test|midterm|final/i.test(reminder.type));
  const nextAssignment = reminders.find((reminder) => /assignment|project|paper|essay|lab/i.test(reminder.type));

  if (nextAssignment) {
    recommendations.push(`Front-load ${nextAssignment.title} because it is the highest leverage deliverable on your board.`);
  }

  if (nextExam && counts.flashcardSets === 0) {
    recommendations.push(`Generate a flashcard set for ${nextExam.title} so recall practice starts before crunch time.`);
  }

  if (counts.quizzes === 0) {
    recommendations.push('Create one low-stakes quiz from your latest notes to turn passive review into retrieval practice.');
  }

  if (counts.knowledgeItems < 3) {
    recommendations.push('Add coach knowledge for office hours, grading rules, or study preferences so recommendations stay specific.');
  }

  if (!recommendations.length) {
    recommendations.push('Your board is balanced. Use a short focus block to reduce the earliest due item before context switching.');
  }

  return recommendations.slice(0, 4);
}

function buildWorkloadTimeline(input: {
  reminders: ReminderRow[];
  calendarEvents: Array<{ id: string; title: string; startsAt: string | null; endsAt: string | null; htmlLink: string | null }>;
  continueReading: Array<{ kind: 'asset' | 'book'; id: string; title: string; progressPercent: number; lastOpenedAt: string | null; href: string; detail: string }>;
}) {
  const reminderItems = input.reminders.slice(0, 5).map((reminder) => ({
    id: `reminder:${reminder.id}`,
    kind: 'reminder' as const,
    title: reminder.title,
    when: reminder.reminder_at,
    detail: `${reminder.type} · ${describeUrgency(reminder.reminder_at)}`,
    href: '/reminders',
  }));

  const calendarItems = input.calendarEvents.slice(0, 4).map((event) => ({
    id: `calendar:${event.id}`,
    kind: 'calendar' as const,
    title: event.title,
    when: event.startsAt,
    detail: event.startsAt && event.endsAt ? `${event.startsAt} → ${event.endsAt}` : 'Calendar event',
    href: event.htmlLink || '/calendar',
  }));

  const readingItems = input.continueReading.slice(0, 3).map((item) => ({
    id: `${item.kind}:${item.id}`,
    kind: 'reading' as const,
    title: item.title,
    when: item.lastOpenedAt,
    detail: `Continue reading · ${item.detail}`,
    href: item.href,
  }));

  return [...reminderItems, ...calendarItems, ...readingItems]
    .sort((left, right) => String(left.when ?? '').localeCompare(String(right.when ?? '')))
    .slice(0, 8);
}

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get('/', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const userId = req.user!.id;

  const [
    remindersResult,
    profileResult,
    flashcardSetsResult,
    quizzesResult,
    threadsResult,
    knowledgeItemsResult,
    studentAgentResult,
    activityResult,
    googleStatus,
    gradesSnapshot,
    scheduleSnapshot,
    continueReading,
  ] = await Promise.all([
    db.query(
      `select id, title, type, status, reminder_at, metadata_json
       from reminders
       where user_id = $1
       order by reminder_at asc`,
      [userId]
    ),
    db.query(`select onboarding_complete from student_profiles where user_id = $1`, [userId]),
    db.query(`select count(*)::int as count from flashcard_sets where user_id = $1`, [userId]),
    db.query(`select count(*)::int as count from quizzes where user_id = $1`, [userId]),
    db.query(`select count(*)::int as count from chat_threads where user_id = $1`, [userId]),
    db.query(`select to_regclass('public.coach_knowledge_items') as table_name`).then(async (tableResult) => {
      if (!tableResult.rows[0]?.table_name) {
        return { rows: [{ count: 0 }] };
      }

      return db.query(`select count(*)::int as count from coach_knowledge_items where user_id = $1`, [userId]);
    }),
    db.query(`select * from agents where user_id = $1`, [userId]),
    db.query(
      `select aa.action_type, aa.summary, aa.created_at
       from agent_actions aa
       join agents a on a.id = aa.agent_id
       where a.user_id = $1
       order by aa.created_at desc
       limit 8`,
      [userId]
    ),
    getGoogleConnectionStatus(userId),
    listGradeDashboard(userId).catch(() => ({
      courses: [],
      items: [],
      settings: [],
      wrongAnswers: [],
      reviewPatterns: [],
      overallAverage: null,
    })),
    getScheduleSnapshot(userId).catch(() => ({
      entries: [],
      context: {
        status: 'no_schedule' as const,
        now: new Date().toISOString(),
        today: 'monday' as const,
        timezone: 'UTC',
        currentClass: null,
        nextClass: null,
        todaySchedule: [],
        message: 'No classes are scheduled yet.',
      },
    })),
    listContinueReadingItems(userId, 4).catch(() => []),
  ]);

  const reminders = (remindersResult.rows as ReminderRow[])
    .filter((reminder) => reminder.status !== 'completed')
    .sort((left, right) => priorityScore(left) - priorityScore(right));

  const todayTasks = reminders.filter((reminder) => hoursUntil(reminder.reminder_at) < 24).slice(0, 4);
  const dueSoon = reminders.slice(0, 5);
  const nextExam = reminders.find((reminder) => /exam|quiz|test|midterm|final/i.test(reminder.type)) ?? null;
  const calendarConnected = googleStatus.connected || reminders.some((reminder) => {
    const metadata = reminder.metadata_json ?? {};
    return Boolean((metadata as Record<string, unknown>).calendarSource);
  });

  const counts = {
    flashcardSets: flashcardSetsResult.rows[0]?.count ?? 0,
    quizzes: quizzesResult.rows[0]?.count ?? 0,
    conversations: threadsResult.rows[0]?.count ?? 0,
    knowledgeItems: knowledgeItemsResult.rows[0]?.count ?? 0,
    gradeItems: gradesSnapshot.items.length,
  };

  const calendarEvents = googleStatus.connected ? await listUpcomingCalendarEvents(userId, 5).catch(() => []) : [];
  const weeklyStudyPlan = buildWeeklyStudyPlan({
    reminders,
    calendarEvents,
  });
  const workloadTimeline = buildWorkloadTimeline({
    reminders,
    calendarEvents,
    continueReading,
  });

  res.json({
    generatedAt: new Date().toISOString(),
    onboardingComplete: !!profileResult.rows[0]?.onboarding_complete,
    heartbeat: {
      status: reminders.length ? 'Active' : 'Needs more inputs',
      cadenceMinutes: 30,
      lastEvaluatedAt: new Date().toISOString(),
      nextRunAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      source: calendarConnected ? 'calendar-and-reminders' : 'reminders-only',
      summary: calendarConnected
        ? 'Priority swaps consider connected schedule data and upcoming reminders.'
        : 'Priority swaps currently use StudyClaw reminders. Connect calendar data next for class-aware ordering.',
    },
    integrations: {
      calendarConnected,
      sourceLabel: calendarConnected ? 'Calendar connected' : 'Calendar not connected',
      googleEmail: googleStatus.googleEmail,
    },
    studentAgent: studentAgentResult.rows[0] ?? null,
    counts,
    scheduleSummary: {
      entriesTracked: scheduleSnapshot.entries.length,
      currentClass: scheduleSnapshot.context.currentClass,
      nextClass: scheduleSnapshot.context.nextClass,
      status: scheduleSnapshot.context.status,
      todayCount: scheduleSnapshot.context.todaySchedule.length,
      message: scheduleSnapshot.context.message,
    },
    gradeSummary: {
      overallAverage: gradesSnapshot.overallAverage,
      coursesTracked: gradesSnapshot.courses.length,
      strongestCourse:
        [...gradesSnapshot.courses]
          .filter((course: any) => course.estimatedPercent !== null)
          .sort((left: any, right: any) => (right.estimatedPercent ?? 0) - (left.estimatedPercent ?? 0))[0] ?? null,
      courseNeedingAttention:
        [...gradesSnapshot.courses]
          .filter((course: any) => course.estimatedPercent !== null)
          .sort((left: any, right: any) => (left.estimatedPercent ?? 0) - (right.estimatedPercent ?? 0))[0] ?? null,
      topConcepts: gradesSnapshot.reviewPatterns.slice(0, 3),
    },
    continueReading,
    workloadTimeline,
    todayTasks: todayTasks.map((task) => ({
      ...task,
      urgencyLabel: describeUrgency(task.reminder_at),
    })),
    dueSoon: dueSoon.map((task) => ({
      ...task,
      urgencyLabel: describeUrgency(task.reminder_at),
    })),
    nextExam: nextExam
      ? {
          ...nextExam,
          urgencyLabel: describeUrgency(nextExam.reminder_at),
        }
      : null,
    recommendations: buildRecommendations(reminders, counts),
    weeklyStudyPlan,
    calendarEvents,
    activityFeed: activityResult.rows,
    quickActions: [
      { label: 'Open Coach', href: '/coach' },
      { label: 'Generate flashcards', href: '/study' },
      { label: 'View schedule', href: '/schedule' },
      { label: 'Track grades', href: '/grades' },
      { label: 'Complete setup', href: '/onboarding' },
      { label: 'Review settings', href: '/settings' },
    ],
  });
});
