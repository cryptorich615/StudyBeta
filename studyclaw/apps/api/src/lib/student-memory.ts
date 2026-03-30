import { createHash, randomUUID } from 'node:crypto';
import { db } from './db';
import { getUpcomingCalendarItemsForStudent } from './google-service';
import { ensurePlatformSchema } from './platform-schema';

type RecordStudyEventInput = {
  userId: string;
  eventKey?: string;
  eventType: string;
  sourceType?: string | null;
  sourceId?: string | null;
  courseId?: string | null;
  topicId?: string | null;
  assignmentId?: string | null;
  score?: number | null;
  payload?: Record<string, unknown>;
  occurredAt?: string | Date | null;
};

type UpdateTopicMasteryInput = {
  userId: string;
  topicName: string;
  courseId?: string | null;
  topicId?: string | null;
  masteryScore?: number | null;
  delta?: number | null;
  reviewedAt?: string | Date | null;
  sourceEventId?: string | null;
  notes?: string | null;
};

type WriteMemorySummaryInput = {
  userId: string;
  summary: string;
  summaryType: string;
  courseId?: string | null;
  topicId?: string | null;
  sourceEventId?: string | null;
  importance?: number | null;
  summaryKey?: string | null;
};

type StudentMemoryQuery = {
  userId: string;
  query?: string | null;
  limit?: number;
};

type CourseLike = {
  id: string;
  name: string;
};

type TopicLike = {
  id: string;
  name: string;
  course_id: string | null;
  course_name: string | null;
  mastery_score: string | number | null;
  last_reviewed_at: string | null;
};

export function clamp(value: number, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function sanitizeSummary(summary: string) {
  const normalized = String(summary ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177).trim()}...` : normalized;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildSummaryKey(input: {
  userId: string;
  summaryType: string;
  summary: string;
  courseId?: string | null;
  topicId?: string | null;
  sourceEventId?: string | null;
}) {
  const hash = createHash('sha1');
  hash.update(
    [
      input.userId,
      input.summaryType,
      input.courseId ?? '',
      input.topicId ?? '',
      input.sourceEventId ?? '',
      sanitizeSummary(input.summary),
    ].join('|')
  );
  return hash.digest('hex');
}

function tokenizeQuery(query: string | null | undefined) {
  return String(query ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

export function inferRelevantEntityIds(params: {
  query?: string | null;
  courses?: CourseLike[];
  topics?: TopicLike[];
}) {
  const tokens = tokenizeQuery(params.query);
  const matchedCourseIds = new Set<string>();
  const matchedTopicIds = new Set<string>();

  if (!tokens.length) {
    return {
      matchedCourseIds: [],
      matchedTopicIds: [],
    };
  }

  for (const course of params.courses ?? []) {
    const haystack = course.name.toLowerCase();
    if (tokens.some((token) => haystack.includes(token))) {
      matchedCourseIds.add(course.id);
    }
  }

  for (const topic of params.topics ?? []) {
    const haystack = `${topic.name} ${topic.course_name ?? ''}`.toLowerCase();
    if (tokens.some((token) => haystack.includes(token))) {
      matchedTopicIds.add(topic.id);
      if (topic.course_id) {
        matchedCourseIds.add(topic.course_id);
      }
    }
  }

  return {
    matchedCourseIds: Array.from(matchedCourseIds),
    matchedTopicIds: Array.from(matchedTopicIds),
  };
}

async function findOrCreateTopic(input: {
  userId: string;
  topicName: string;
  courseId?: string | null;
}) {
  const normalizedTopicName = normalizeName(input.topicName);
  const existing = await db.query(
    `select id, user_id, course_id, name, mastery_score, last_reviewed_at
     from topics
     where user_id = $1
       and coalesce(course_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($2, '00000000-0000-0000-0000-000000000000'::uuid)
       and lower(name) = lower($3)
     limit 1`,
    [input.userId, input.courseId ?? null, normalizedTopicName]
  );

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const inserted = await db.query(
    `insert into topics (user_id, course_id, name)
     values ($1, $2, $3)
     on conflict (user_id, course_id, name) do update set name = excluded.name
     returning id, user_id, course_id, name, mastery_score, last_reviewed_at`,
    [input.userId, input.courseId ?? null, normalizedTopicName]
  );

  return inserted.rows[0];
}

export async function recordStudyEvent(input: RecordStudyEventInput) {
  await ensurePlatformSchema();
  const eventKey = input.eventKey?.trim() || `${input.eventType}:${input.userId}:${input.sourceType ?? 'system'}:${input.sourceId ?? randomUUID()}`;
  const occurredAt =
    input.occurredAt instanceof Date
      ? input.occurredAt.toISOString()
      : input.occurredAt
        ? new Date(input.occurredAt).toISOString()
        : new Date().toISOString();

  const result = await db.query(
    `insert into study_events (
       user_id, event_key, event_type, source_type, source_id, course_id, topic_id, assignment_id, score, payload_json, occurred_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (event_key) do update set
       score = coalesce(excluded.score, study_events.score),
       payload_json = study_events.payload_json || excluded.payload_json,
       occurred_at = least(study_events.occurred_at, excluded.occurred_at)
     returning *`,
    [
      input.userId,
      eventKey,
      input.eventType,
      input.sourceType ?? null,
      input.sourceId ?? null,
      input.courseId ?? null,
      input.topicId ?? null,
      input.assignmentId ?? null,
      input.score ?? null,
      JSON.stringify(input.payload ?? {}),
      occurredAt,
    ]
  );

  console.info('[student-memory] recorded study event', {
    userId: input.userId,
    eventType: input.eventType,
    eventKey,
  });
  return result.rows[0];
}

export async function updateTopicMastery(input: UpdateTopicMasteryInput) {
  await ensurePlatformSchema();
  const topic =
    input.topicId
      ? (
          await db.query(
            `select id, user_id, course_id, name, mastery_score, last_reviewed_at
             from topics
             where id = $1
               and user_id = $2
             limit 1`,
            [input.topicId, input.userId]
          )
        ).rows[0]
      : await findOrCreateTopic({
          userId: input.userId,
          topicName: input.topicName,
          courseId: input.courseId ?? null,
        });

  if (!topic) {
    return null;
  }

  const currentScore = Number(topic.mastery_score ?? 0.5);
  const nextScore =
    typeof input.masteryScore === 'number'
      ? clamp(input.masteryScore)
      : clamp(currentScore + Number(input.delta ?? 0));
  const reviewedAt =
    input.reviewedAt instanceof Date
      ? input.reviewedAt.toISOString()
      : input.reviewedAt
        ? new Date(input.reviewedAt).toISOString()
        : new Date().toISOString();

  const updatedTopic = await db.query(
    `update topics
     set mastery_score = $3,
         last_reviewed_at = $4
     where id = $1
       and user_id = $2
     returning *`,
    [topic.id, input.userId, nextScore, reviewedAt]
  );

  await db.query(
    `insert into progress_snapshots (
       user_id, course_id, topic_id, source_event_id, snapshot_type, metric_key, metric_value, notes
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (source_event_id, metric_key) do update set
       metric_value = excluded.metric_value,
       notes = excluded.notes`,
    [
      input.userId,
      topic.course_id ?? input.courseId ?? null,
      topic.id,
      input.sourceEventId ?? null,
      'topic_mastery',
      'mastery_score',
      nextScore,
      input.notes ?? null,
    ]
  );

  console.info('[student-memory] updated topic mastery', {
    userId: input.userId,
    topicId: topic.id,
    topicName: topic.name,
    nextScore,
  });
  return updatedTopic.rows[0] ?? null;
}

export async function writeMemorySummary(input: WriteMemorySummaryInput) {
  await ensurePlatformSchema();
  const summary = sanitizeSummary(input.summary);
  if (!summary) {
    return null;
  }

  const summaryKey = input.summaryKey?.trim() || buildSummaryKey({
    userId: input.userId,
    summaryType: input.summaryType,
    summary,
    courseId: input.courseId ?? null,
    topicId: input.topicId ?? null,
    sourceEventId: input.sourceEventId ?? null,
  });

  const result = await db.query(
    `insert into memory_summaries (
       user_id, summary_key, summary_type, course_id, topic_id, source_event_id, summary, importance, last_used_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, now())
     on conflict (summary_key) do update set
       summary = excluded.summary,
       importance = greatest(memory_summaries.importance, excluded.importance),
       last_used_at = now()
     returning *`,
    [
      input.userId,
      summaryKey,
      input.summaryType,
      input.courseId ?? null,
      input.topicId ?? null,
      input.sourceEventId ?? null,
      summary,
      Math.min(Math.max(Number(input.importance ?? 3), 1), 5),
    ]
  );

  console.info('[student-memory] wrote memory summary', {
    userId: input.userId,
    summaryType: input.summaryType,
    summaryKey,
  });
  return result.rows[0];
}

export async function upsertAssignmentFromReminder(input: {
  userId: string;
  reminderId: string;
  title: string;
  type: string;
  reminderAt?: string | Date | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
  courseId?: string | null;
}) {
  await ensurePlatformSchema();
  if (!/assignment|exam|quiz|test|project|paper|essay|lab|study_session/i.test(input.type)) {
    return null;
  }

  const normalizedStatus =
    input.status === 'completed' || input.status === 'sent' ? 'completed' : input.status === 'cancelled' ? 'cancelled' : 'pending';
  const dueAt =
    input.reminderAt instanceof Date ? input.reminderAt.toISOString() : input.reminderAt ? new Date(input.reminderAt).toISOString() : null;

  const result = await db.query(
    `insert into assignments (
       user_id, course_id, title, status, due_at, completed_at, source_reminder_id, metadata_json
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (source_reminder_id) do update set
       course_id = coalesce(excluded.course_id, assignments.course_id),
       title = excluded.title,
       status = excluded.status,
       due_at = excluded.due_at,
       completed_at = excluded.completed_at,
       metadata_json = assignments.metadata_json || excluded.metadata_json,
       updated_at = now()
     returning *`,
    [
      input.userId,
      input.courseId ?? null,
      normalizeName(input.title),
      normalizedStatus,
      dueAt,
      normalizedStatus === 'completed' ? new Date().toISOString() : null,
      input.reminderId,
      JSON.stringify(input.metadata ?? {}),
    ]
  );

  return result.rows[0] ?? null;
}

export async function getRelevantStudentMemory(input: StudentMemoryQuery) {
  await ensurePlatformSchema();
  const limit = Math.min(Math.max(Number(input.limit ?? 6), 3), 12);
  const [coursesResult, topicsResult, assignmentsResult] = await Promise.all([
    db.query(
      `select id, name
       from subjects
       where user_id = $1
       order by updated_at desc, created_at desc
       limit 16`,
      [input.userId]
    ),
    db.query(
      `select t.id, t.name, t.course_id, s.name as course_name, t.mastery_score, t.last_reviewed_at
       from topics t
       left join subjects s on s.id = t.course_id
       where t.user_id = $1
       order by t.last_reviewed_at desc nulls last, t.updated_at desc
       limit 24`,
      [input.userId]
    ),
    db.query(
      `select a.id, a.title, a.status, a.due_at, a.course_id, s.name as course_name
       from assignments a
       left join subjects s on s.id = a.course_id
       where a.user_id = $1
       order by a.due_at asc nulls last, a.updated_at desc
       limit 10`,
      [input.userId]
    ),
  ]);

  const courses = coursesResult.rows as CourseLike[];
  const topics = topicsResult.rows as TopicLike[];
  const matches = inferRelevantEntityIds({
    query: input.query,
    courses,
    topics,
  });

  const memoryResult = await db.query(
    `select ms.id, ms.summary, ms.summary_type, ms.importance, ms.course_id, ms.topic_id, ms.updated_at,
            s.name as course_name, t.name as topic_name
     from memory_summaries ms
     left join subjects s on s.id = ms.course_id
     left join topics t on t.id = ms.topic_id
     where ms.user_id = $1
     order by
       case when ms.topic_id = any($2::uuid[]) then 0
            when ms.course_id = any($3::uuid[]) then 1
            else 2 end,
       ms.importance desc,
       ms.updated_at desc
     limit $4`,
    [input.userId, matches.matchedTopicIds, matches.matchedCourseIds, limit]
  );

  const snapshotResult = await db.query(
    `select ps.topic_id, ps.metric_value, ps.created_at, t.name as topic_name, s.name as course_name
     from progress_snapshots ps
     left join topics t on t.id = ps.topic_id
     left join subjects s on s.id = ps.course_id
     where ps.user_id = $1
       and ps.metric_key = 'mastery_score'
     order by
       case when ps.topic_id = any($2::uuid[]) then 0
            when ps.course_id = any($3::uuid[]) then 1
            else 2 end,
       ps.created_at desc
     limit $4`,
    [input.userId, matches.matchedTopicIds, matches.matchedCourseIds, limit]
  );

  await db.query(
    `update memory_summaries
     set last_used_at = now()
     where id = any($1::uuid[])`,
    [memoryResult.rows.map((row: { id: string }) => row.id)]
  ).catch(() => undefined);

  console.info('[student-memory] loaded relevant memory', {
    userId: input.userId,
    query: input.query ?? '',
    matchedCourseIds: matches.matchedCourseIds.length,
    matchedTopicIds: matches.matchedTopicIds.length,
    summaries: memoryResult.rows.length,
  });

  return {
    courses: coursesResult.rows,
    topics: topicsResult.rows,
    assignments: assignmentsResult.rows,
    matchedCourseIds: matches.matchedCourseIds,
    matchedTopicIds: matches.matchedTopicIds,
    memories: memoryResult.rows,
    snapshots: snapshotResult.rows,
  };
}

export async function buildStudentContext(userId: string, options?: { query?: string | null }) {
  await ensurePlatformSchema();
  const shouldLoadCalendar = /calendar|schedule|scheduled|plan|planning|deadline|due|exam|quiz|session|study block|reminder|today|tomorrow|week/i.test(
    String(options?.query ?? '')
  );
  const [profileResult, subjectsResult, remindersResult, memory, calendar] = await Promise.all([
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
    getRelevantStudentMemory({
      userId,
      query: options?.query ?? null,
    }),
    shouldLoadCalendar
      ? getUpcomingCalendarItemsForStudent(userId, { maxResults: 6 })
      : Promise.resolve({ status: 'not_connected' as const, items: [] }),
  ]);

  return {
    profile: profileResult.rows[0] ?? null,
    subjects: subjectsResult.rows.map((row: { name: string }) => row.name),
    reminders: remindersResult.rows,
    memory,
    calendar,
  };
}

export function renderStudentMemoryContext(memory: Awaited<ReturnType<typeof getRelevantStudentMemory>>) {
  const progressLines = memory.snapshots.slice(0, 4).map((snapshot: any) => {
    const score = Number(snapshot.metric_value ?? 0);
    return `${snapshot.topic_name ?? 'Unnamed topic'} (${snapshot.course_name ?? 'Unsorted'}): mastery ${score.toFixed(2)} at ${new Date(snapshot.created_at).toISOString()}`;
  });

  const assignmentLines = memory.assignments.slice(0, 4).map((assignment: any) => {
    const dueLabel = assignment.due_at ? new Date(assignment.due_at).toISOString() : 'no due date';
    return `${assignment.title} (${assignment.status}, ${dueLabel})`;
  });

  const memoryLines = memory.memories.slice(0, 6).map((item: any) => item.summary);

  return {
    progressLine: progressLines.length ? `Relevant progress: ${progressLines.join(' | ')}` : 'Relevant progress: none recorded yet',
    assignmentLine: assignmentLines.length ? `Tracked assignments: ${assignmentLines.join(' | ')}` : 'Tracked assignments: none recorded',
    memoryLine: memoryLines.length ? `Long-term memory: ${memoryLines.join(' | ')}` : 'Long-term memory: none recorded yet',
  };
}

export function buildImprovementSummary(input: {
  topicName: string;
  previousScore: number;
  nextScore: number;
  timeframe?: string;
}) {
  const direction = input.nextScore >= input.previousScore ? 'improved' : 'shifted';
  return `Student ${direction} ${input.topicName} mastery from ${input.previousScore.toFixed(2)} to ${input.nextScore.toFixed(2)}${input.timeframe ? ` ${input.timeframe}` : ''}.`;
}
