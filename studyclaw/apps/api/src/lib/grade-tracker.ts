import { db } from './db';
import { ensurePlatformSchema } from './platform-schema';
import { recordStudyEvent, writeMemorySummary } from './student-memory';

export type LetterGradeBand = {
  letter: string;
  minPercent: number;
};

export type GradeCourseSettings = {
  calculationMode: 'points' | 'weighted';
  categoryWeights: Record<string, number>;
  finalExamWeight: number | null;
  gradingScale: LetterGradeBand[];
};

export type GradeItemInput = {
  courseId?: string | null;
  courseName?: string | null;
  title: string;
  category: string;
  pointsEarned?: number | null;
  pointsPossible?: number | null;
  percent?: number | null;
  weight?: number | null;
  date?: string | null;
  notes?: string | null;
};

export type WrongAnswerInput = {
  courseId?: string | null;
  courseName?: string | null;
  sourceType: 'quiz' | 'test' | 'homework' | 'assignment';
  sourceTitle: string;
  questionText: string;
  studentAnswer?: string | null;
  correctAnswer: string;
  explanation?: string | null;
  conceptTags?: string[] | null;
  difficulty?: 'easy' | 'medium' | 'hard' | null;
  date?: string | null;
  teacherNotes?: string | null;
  attachmentRefs?: Array<{ label: string; url?: string | null }> | null;
};

export type GradeSummary = {
  courseId: string;
  courseName: string;
  estimatedPercent: number | null;
  letterGrade: string | null;
  totalItems: number;
  weighted: boolean;
  warnings: string[];
  categoryBreakdown: Array<{
    category: string;
    percent: number | null;
    weight: number | null;
    itemCount: number;
  }>;
  finalExamWeight: number | null;
};

export type FinalTargetResult = {
  targetPercent: number;
  currentPercent: number | null;
  requiredOnFinal: number | null;
  canReachTarget: boolean | null;
  assumptions: string[];
};

export type WrongAnswerPattern = {
  concept: string;
  misses: number;
};

const DEFAULT_GRADING_SCALE: LetterGradeBand[] = [
  { letter: 'A', minPercent: 90 },
  { letter: 'B', minPercent: 80 },
  { letter: 'C', minPercent: 70 },
  { letter: 'D', minPercent: 60 },
  { letter: 'F', minPercent: 0 },
];

const KNOWN_CATEGORIES = ['homework', 'quiz', 'test', 'project', 'participation', 'lab', 'final', 'midterm'] as const;

type GradeItemRow = {
  id: string;
  user_id: string;
  course_id: string;
  title: string;
  category: string;
  points_earned: string | number | null;
  points_possible: string | number | null;
  percent: string | number | null;
  weight: string | number | null;
  occurred_on: string | null;
  notes: string | null;
  created_at: string;
};

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeCategory(value: string) {
  const normalized = normalizeName(value || 'assignment').toLowerCase();
  if (/quiz/i.test(normalized)) return 'quiz';
  if (/test|exam/i.test(normalized)) return 'test';
  if (/project|paper|essay/i.test(normalized)) return 'project';
  if (/participation/i.test(normalized)) return 'participation';
  if (/lab/i.test(normalized)) return 'lab';
  if (/final/i.test(normalized)) return 'final';
  if (/midterm/i.test(normalized)) return 'midterm';
  if (/homework|hw/i.test(normalized)) return 'homework';
  return normalized || 'assignment';
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function sanitizeText(value: string | null | undefined, max = 400) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > max ? `${normalized.slice(0, max - 3).trim()}...` : normalized;
}

function normalizeConceptTags(value: string[] | null | undefined) {
  return Array.from(
    new Set(
      (value ?? [])
        .flatMap((item) => String(item).split(/[,\n]/g))
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8)
    )
  );
}

export function deriveLetterGrade(percent: number | null, gradingScale: LetterGradeBand[] = DEFAULT_GRADING_SCALE) {
  if (percent === null || !Number.isFinite(percent)) {
    return null;
  }

  const normalized = clampPercent(percent);
  const sorted = [...gradingScale].sort((left, right) => right.minPercent - left.minPercent);
  return sorted.find((band) => normalized >= band.minPercent)?.letter ?? sorted[sorted.length - 1]?.letter ?? 'F';
}

export function normalizeGradeSettings(raw: Partial<GradeCourseSettings> | null | undefined): GradeCourseSettings {
  const categoryWeights = Object.fromEntries(
    Object.entries(raw?.categoryWeights ?? {})
      .map(([key, value]) => [normalizeCategory(key), Number(value)] as const)
      .filter((entry): entry is readonly [string, number] => Number.isFinite(entry[1]) && entry[1] >= 0)
  ) as Record<string, number>;

  const hasWeights = Object.values(categoryWeights).some((value) => value > 0);

  return {
    calculationMode: raw?.calculationMode === 'weighted' || hasWeights ? 'weighted' : 'points',
    categoryWeights,
    finalExamWeight: raw?.finalExamWeight !== null && raw?.finalExamWeight !== undefined
      ? clampPercent(Number(raw.finalExamWeight))
      : null,
    gradingScale: Array.isArray(raw?.gradingScale) && raw!.gradingScale.length
      ? raw!.gradingScale
          .map((band) => ({ letter: String(band.letter), minPercent: clampPercent(Number(band.minPercent)) }))
          .sort((left, right) => right.minPercent - left.minPercent)
      : DEFAULT_GRADING_SCALE,
  };
}

function percentFromItem(item: {
  points_earned?: string | number | null;
  points_possible?: string | number | null;
  percent?: string | number | null;
}) {
  const earned = toNumber(item.points_earned);
  const possible = toNumber(item.points_possible);
  if (earned !== null && possible !== null && possible > 0) {
    return clampPercent((earned / possible) * 100);
  }

  const percent = toNumber(item.percent);
  return percent !== null ? clampPercent(percent) : null;
}

function summarizeCategory(items: GradeItemRow[], category: string, weight: number | null) {
  const matching = items.filter((item) => normalizeCategory(item.category) === category);
  if (!matching.length) {
    return {
      category,
      percent: null,
      weight,
      itemCount: 0,
    };
  }

  const earnedSum = matching.reduce((sum, item) => sum + (toNumber(item.points_earned) ?? 0), 0);
  const possibleSum = matching.reduce((sum, item) => sum + (toNumber(item.points_possible) ?? 0), 0);
  const averagePercent =
    possibleSum > 0
      ? clampPercent((earnedSum / possibleSum) * 100)
      : clampPercent(
          matching.reduce((sum, item) => sum + (percentFromItem(item) ?? 0), 0) / matching.length
        );

  return {
    category,
    percent: Number.isFinite(averagePercent) ? averagePercent : null,
    weight,
    itemCount: matching.length,
  };
}

export function calculateCourseEstimate(items: GradeItemRow[], settings?: Partial<GradeCourseSettings> | null): Omit<GradeSummary, 'courseId' | 'courseName'> {
  const normalizedSettings = normalizeGradeSettings(settings);
  const warnings: string[] = [];

  if (!items.length) {
    return {
      estimatedPercent: null,
      letterGrade: null,
      totalItems: 0,
      weighted: normalizedSettings.calculationMode === 'weighted',
      warnings: ['No grade items recorded yet.'],
      categoryBreakdown: [],
      finalExamWeight: normalizedSettings.finalExamWeight,
    };
  }

  const categories = Array.from(
    new Set([
      ...items.map((item) => normalizeCategory(item.category)),
      ...Object.keys(normalizedSettings.categoryWeights),
    ])
  );

  const categoryBreakdown = categories
    .map((category) => summarizeCategory(items, category, normalizedSettings.categoryWeights[category] ?? null))
    .filter((item) => item.itemCount > 0 || item.weight !== null);

  let estimatedPercent: number | null = null;

  if (normalizedSettings.calculationMode === 'weighted' && categoryBreakdown.some((item) => (item.weight ?? 0) > 0)) {
    const weightedCategories = categoryBreakdown.filter(
      (item) => item.percent !== null && item.weight !== null && item.weight > 0
    );
    const usedWeight = weightedCategories.reduce((sum, item) => sum + (item.weight ?? 0), 0);
    if (usedWeight > 0) {
      estimatedPercent =
        weightedCategories.reduce((sum, item) => sum + ((item.percent ?? 0) * (item.weight ?? 0)), 0) / usedWeight;
      if (usedWeight < 100) {
        warnings.push(`Weighted estimate uses ${usedWeight.toFixed(1)}% of configured categories entered so far.`);
      }
    }
  }

  if (estimatedPercent === null) {
    const earnedSum = items.reduce((sum, item) => sum + (toNumber(item.points_earned) ?? 0), 0);
    const possibleSum = items.reduce((sum, item) => sum + (toNumber(item.points_possible) ?? 0), 0);
    if (possibleSum > 0) {
      estimatedPercent = (earnedSum / possibleSum) * 100;
    } else {
      const percents = items.map((item) => percentFromItem(item)).filter((value): value is number => value !== null);
      estimatedPercent = percents.length ? percents.reduce((sum, value) => sum + value, 0) / percents.length : null;
      if (percents.length) {
        warnings.push('Estimate is based on entered percentages because points possible are incomplete.');
      }
    }
  }

  estimatedPercent = estimatedPercent !== null ? Number(clampPercent(estimatedPercent).toFixed(2)) : null;

  return {
    estimatedPercent,
    letterGrade: deriveLetterGrade(estimatedPercent, normalizedSettings.gradingScale),
    totalItems: items.length,
    weighted: normalizedSettings.calculationMode === 'weighted',
    warnings,
    categoryBreakdown,
    finalExamWeight: normalizedSettings.finalExamWeight,
  };
}

export function calculateRequiredFinalExamScore(input: {
  currentPercent: number | null;
  targetPercent: number;
  finalWeightPercent?: number | null;
  remainingWeightPercent?: number | null;
}) : FinalTargetResult {
  const assumptions: string[] = [];
  const currentPercent = input.currentPercent !== null ? clampPercent(input.currentPercent) : null;
  const targetPercent = clampPercent(input.targetPercent);
  const explicitWeight = input.finalWeightPercent !== null && input.finalWeightPercent !== undefined
    ? clampPercent(input.finalWeightPercent)
    : null;
  const assumedWeight = explicitWeight ?? (
    input.remainingWeightPercent !== null && input.remainingWeightPercent !== undefined
      ? clampPercent(input.remainingWeightPercent)
      : null
  );

  if (currentPercent === null || assumedWeight === null || assumedWeight <= 0) {
    if (currentPercent === null) {
      assumptions.push('No current estimated grade is available yet.');
    }
    if (assumedWeight === null || assumedWeight <= 0) {
      assumptions.push('Final exam weight is not known, so the target score is only an estimate once that weight is set.');
    }
    return {
      targetPercent,
      currentPercent,
      requiredOnFinal: null,
      canReachTarget: null,
      assumptions,
    };
  }

  if (explicitWeight === null) {
    assumptions.push('Used the remaining ungraded course weight as the final exam weight.');
  }

  const weight = assumedWeight / 100;
  const required = (targetPercent - currentPercent * (1 - weight)) / weight;
  const rounded = Number(required.toFixed(2));

  return {
    targetPercent,
    currentPercent,
    requiredOnFinal: rounded,
    canReachTarget: rounded <= 100,
    assumptions,
  };
}

export function parseGradeEntryIntent(message: string) {
  const match = message.match(
    /add (?:my )?(?<course>.+?) (?<category>quiz|test|exam|homework|assignment|project|participation|lab|final|midterm) grade[:\s-]+(?<earned>\d+(?:\.\d+)?)\s*\/\s*(?<possible>\d+(?:\.\d+)?)(?:\s+for\s+(?<title>.+))?/i
  );

  if (!match?.groups) {
    return null;
  }

  return {
    courseName: normalizeName(match.groups.course),
    category: normalizeCategory(match.groups.category),
    pointsEarned: Number(match.groups.earned),
    pointsPossible: Number(match.groups.possible),
    title: sanitizeText(match.groups.title || `${normalizeCategory(match.groups.category)} grade`, 120) ?? `${normalizeCategory(match.groups.category)} grade`,
  };
}

export function parseEstimatedGradeIntent(message: string) {
  const match = message.match(/what(?:'s| is) my estimated grade in (?<course>.+?)[?]?$/i);
  return match?.groups?.course ? normalizeName(match.groups.course) : null;
}

export function parseFinalTargetIntent(message: string) {
  const match = message.match(
    /what do i need on (?:the )?final(?: in (?<course>.+?))? to get (?:(?:an?|a)\s+)?(?<target>[abcdf][+-]?|\d{1,3})(?:[?!.]|$)/i
  );
  if (!match?.groups?.target) {
    return null;
  }

  const targetRaw = match.groups.target.toUpperCase();
  const targetPercent = /^\d/.test(targetRaw)
    ? clampPercent(Number(targetRaw))
    : ({
        'A+': 97,
        A: 90,
        'A-': 90,
        'B+': 87,
        B: 80,
        'B-': 80,
        'C+': 77,
        C: 70,
        'C-': 70,
        'D+': 67,
        D: 60,
        'D-': 60,
        F: 0,
      } as Record<string, number>)[targetRaw] ?? 80;

  return {
    courseName: match.groups.course ? normalizeName(match.groups.course) : null,
    targetPercent,
    targetLabel: targetRaw,
  };
}

export function buildWrongAnswerInsightSummary(reviews: Array<{ concept_tags?: string[] | null }>) {
  const counts = new Map<string, number>();
  for (const review of reviews) {
    for (const tag of normalizeConceptTags(review.concept_tags ?? [])) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([concept, misses]) => ({ concept, misses }));
}

async function findOrCreateCourse(userId: string, courseId?: string | null, courseName?: string | null) {
  if (courseId) {
    const existing = await db.query(`select id, name from subjects where id = $1 and user_id = $2 limit 1`, [courseId, userId]);
    if (!existing.rows[0]) {
      throw new Error('Course not found for this account.');
    }
    return existing.rows[0] as { id: string; name: string };
  }

  const normalizedName = sanitizeText(courseName, 120);
  if (!normalizedName) {
    throw new Error('Course name is required.');
  }

  const inserted = await db.query(
    `insert into subjects (user_id, name)
     values ($1, $2)
     on conflict (user_id, name) do update set name = excluded.name
     returning id, name`,
    [userId, normalizedName]
  );
  return inserted.rows[0] as { id: string; name: string };
}

export async function upsertGradeCourseSettings(input: {
  userId: string;
  courseId?: string | null;
  courseName?: string | null;
  calculationMode?: 'points' | 'weighted' | null;
  categoryWeights?: Record<string, number> | null;
  finalExamWeight?: number | null;
  gradingScale?: LetterGradeBand[] | null;
}) {
  await ensurePlatformSchema();
  const course = await findOrCreateCourse(input.userId, input.courseId, input.courseName);
  const settings = normalizeGradeSettings({
    calculationMode: input.calculationMode ?? undefined,
    categoryWeights: input.categoryWeights ?? undefined,
    finalExamWeight: input.finalExamWeight ?? undefined,
    gradingScale: input.gradingScale ?? undefined,
  });

  const result = await db.query(
    `insert into grade_course_settings (
       user_id, course_id, calculation_mode, category_weights_json, final_exam_weight, grading_scale_json
     )
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, course_id) do update set
       calculation_mode = excluded.calculation_mode,
       category_weights_json = excluded.category_weights_json,
       final_exam_weight = excluded.final_exam_weight,
       grading_scale_json = excluded.grading_scale_json,
       updated_at = now()
     returning *`,
    [
      input.userId,
      course.id,
      settings.calculationMode,
      JSON.stringify(settings.categoryWeights),
      settings.finalExamWeight,
      JSON.stringify(settings.gradingScale),
    ]
  );

  return { course, settings: result.rows[0] };
}

export async function createGradeItem(userId: string, input: GradeItemInput) {
  await ensurePlatformSchema();
  const course = await findOrCreateCourse(userId, input.courseId, input.courseName);
  const title = sanitizeText(input.title, 120);
  if (!title) {
    throw new Error('Grade title is required.');
  }

  const pointsEarned = toNumber(input.pointsEarned);
  const pointsPossible = toNumber(input.pointsPossible);
  const percent = input.percent !== null && input.percent !== undefined
    ? clampPercent(Number(input.percent))
    : (pointsEarned !== null && pointsPossible !== null && pointsPossible > 0
      ? clampPercent((pointsEarned / pointsPossible) * 100)
      : null);

  if (pointsEarned !== null && pointsPossible !== null && pointsEarned > pointsPossible) {
    throw new Error('Points earned cannot be greater than points possible.');
  }

  const weight = input.weight !== null && input.weight !== undefined ? clampPercent(Number(input.weight)) : null;
  const occurredOn = input.date ? new Date(input.date).toISOString().slice(0, 10) : null;

  const result = await db.query(
    `insert into grade_items (
       user_id, course_id, title, category, points_earned, points_possible, percent, weight, occurred_on, notes
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning *`,
    [
      userId,
      course.id,
      title,
      normalizeCategory(input.category),
      pointsEarned,
      pointsPossible,
      percent,
      weight,
      occurredOn,
      sanitizeText(input.notes, 500),
    ]
  );

  const item = result.rows[0] as GradeItemRow;
  const summary = await getCourseGradeSummary(userId, course.id);
  const studyEvent = await recordStudyEvent({
    userId,
    eventKey: `grade-item:${item.id}`,
    eventType: 'grade_item_saved',
    sourceType: 'grade_item',
    sourceId: item.id,
    courseId: course.id,
    score: (percent ?? 0) / 100,
    payload: {
      title,
      category: normalizeCategory(input.category),
      percent,
    },
  });
  if (summary.estimatedPercent !== null) {
    await db.query(
      `insert into progress_snapshots (
         user_id, course_id, source_event_id, snapshot_type, metric_key, metric_value, notes
       )
       values ($1, $2, $3, 'course_grade', 'estimated_percent', $4, $5)`,
      [userId, course.id, studyEvent.id, Number((summary.estimatedPercent / 100).toFixed(4)), 'Estimated course grade updated']
    );
    await writeMemorySummary({
      userId,
      summaryType: 'grade_tracking',
      summary: `Estimated grade in ${course.name} is ${summary.estimatedPercent.toFixed(1)}% (${summary.letterGrade ?? 'N/A'}).`,
      courseId: course.id,
      summaryKey: `grade:${course.id}:estimate`,
      importance: 4,
    });
  }

  return { item, course, summary };
}

export async function updateGradeItem(userId: string, itemId: string, input: Partial<GradeItemInput>) {
  await ensurePlatformSchema();
  const existingResult = await db.query(`select * from grade_items where id = $1 and user_id = $2 limit 1`, [itemId, userId]);
  const existing = existingResult.rows[0] as GradeItemRow | undefined;
  if (!existing) {
    throw new Error('Grade item not found.');
  }

  const course = await findOrCreateCourse(userId, input.courseId ?? existing.course_id, input.courseName);
  const pointsEarned = input.pointsEarned !== undefined ? toNumber(input.pointsEarned) : toNumber(existing.points_earned);
  const pointsPossible = input.pointsPossible !== undefined ? toNumber(input.pointsPossible) : toNumber(existing.points_possible);
  const derivedPercent =
    input.percent !== undefined
      ? toNumber(input.percent)
      : (pointsEarned !== null && pointsPossible !== null && pointsPossible > 0
        ? (pointsEarned / pointsPossible) * 100
        : toNumber(existing.percent));

  const result = await db.query(
    `update grade_items
     set course_id = $3,
         title = $4,
         category = $5,
         points_earned = $6,
         points_possible = $7,
         percent = $8,
         weight = $9,
         occurred_on = $10,
         notes = $11
     where id = $1
       and user_id = $2
     returning *`,
    [
      itemId,
      userId,
      course.id,
      sanitizeText(input.title ?? existing.title, 120) ?? existing.title,
      normalizeCategory(input.category ?? existing.category),
      pointsEarned,
      pointsPossible,
      derivedPercent !== null ? clampPercent(derivedPercent) : null,
      input.weight !== undefined ? toNumber(input.weight) : toNumber(existing.weight),
      input.date ? new Date(input.date).toISOString().slice(0, 10) : existing.occurred_on,
      sanitizeText(input.notes ?? existing.notes, 500),
    ]
  );

  return {
    item: result.rows[0],
    summary: await getCourseGradeSummary(userId, course.id),
  };
}

export async function deleteGradeItem(userId: string, itemId: string) {
  await ensurePlatformSchema();
  const result = await db.query(
    `delete from grade_items
     where id = $1
       and user_id = $2
     returning course_id`,
    [itemId, userId]
  );
  if (!result.rows[0]) {
    throw new Error('Grade item not found.');
  }

  return getCourseGradeSummary(userId, result.rows[0].course_id);
}

function mapSettingsRow(row: any): GradeCourseSettings {
  return normalizeGradeSettings({
    calculationMode: row?.calculation_mode === 'weighted' ? 'weighted' : 'points',
    categoryWeights: row?.category_weights_json ?? {},
    finalExamWeight: toNumber(row?.final_exam_weight),
    gradingScale: Array.isArray(row?.grading_scale_json) ? row.grading_scale_json : undefined,
  });
}

export async function getCourseGradeSummary(userId: string, courseId: string): Promise<GradeSummary> {
  await ensurePlatformSchema();
  const [courseResult, itemsResult, settingsResult] = await Promise.all([
    db.query(`select id, name from subjects where id = $1 and user_id = $2 limit 1`, [courseId, userId]),
    db.query(`select * from grade_items where user_id = $1 and course_id = $2 order by occurred_on desc nulls last, created_at desc`, [userId, courseId]),
    db.query(`select * from grade_course_settings where user_id = $1 and course_id = $2 limit 1`, [userId, courseId]),
  ]);

  const course = courseResult.rows[0];
  if (!course) {
    throw new Error('Course not found.');
  }

  const estimate = calculateCourseEstimate(itemsResult.rows as GradeItemRow[], settingsResult.rows[0] ? mapSettingsRow(settingsResult.rows[0]) : null);
  return {
    courseId: course.id,
    courseName: course.name,
    ...estimate,
  };
}

export async function listGradeDashboard(userId: string) {
  await ensurePlatformSchema();
  const [coursesResult, itemsResult, settingsResult, reviewsResult] = await Promise.all([
    db.query(`select id, name from subjects where user_id = $1 order by created_at asc`, [userId]),
    db.query(`select * from grade_items where user_id = $1 order by occurred_on desc nulls last, created_at desc`, [userId]),
    db.query(`select * from grade_course_settings where user_id = $1`, [userId]),
    db.query(
      `select war.*, s.name as course_name
       from wrong_answer_reviews war
       left join subjects s on s.id = war.course_id
       where war.user_id = $1
       order by war.occurred_on desc nulls last, war.created_at desc
       limit 40`,
      [userId]
    ),
  ]);

  const settingsByCourse = new Map(settingsResult.rows.map((row) => [row.course_id, mapSettingsRow(row)]));
  const itemsByCourse = new Map<string, GradeItemRow[]>();
  for (const row of itemsResult.rows as GradeItemRow[]) {
    const existing = itemsByCourse.get(row.course_id) ?? [];
    existing.push(row);
    itemsByCourse.set(row.course_id, existing);
  }

  const courseSummaries: GradeSummary[] = coursesResult.rows.map((course: any) => ({
    courseId: course.id,
    courseName: course.name,
    ...calculateCourseEstimate(itemsByCourse.get(course.id) ?? [], settingsByCourse.get(course.id)),
  }));

  const reviewPatterns = buildWrongAnswerInsightSummary(reviewsResult.rows as Array<{ concept_tags?: string[] | null }>);

  return {
    courses: courseSummaries,
    items: itemsResult.rows,
    settings: settingsResult.rows,
    wrongAnswers: reviewsResult.rows,
    reviewPatterns,
    overallAverage:
      courseSummaries.length
        ? Number(
            (
              courseSummaries.reduce((sum, course) => sum + (course.estimatedPercent ?? 0), 0) /
              Math.max(1, courseSummaries.filter((course) => course.estimatedPercent !== null).length)
            ).toFixed(2)
          )
        : null,
  };
}

export async function createWrongAnswerReview(userId: string, input: WrongAnswerInput) {
  await ensurePlatformSchema();
  const course = input.courseId || input.courseName
    ? await findOrCreateCourse(userId, input.courseId, input.courseName)
    : null;

  const conceptTags = normalizeConceptTags(input.conceptTags);
  const result = await db.query(
    `insert into wrong_answer_reviews (
       user_id, course_id, source_type, source_title, question_text, student_answer, correct_answer, explanation, concept_tags, difficulty, occurred_on, teacher_notes, attachment_refs_json
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     returning *`,
    [
      userId,
      course?.id ?? null,
      input.sourceType,
      sanitizeText(input.sourceTitle, 140),
      sanitizeText(input.questionText, 4000),
      sanitizeText(input.studentAnswer, 2000),
      sanitizeText(input.correctAnswer, 2000),
      sanitizeText(input.explanation, 2000),
      conceptTags,
      input.difficulty ?? null,
      input.date ? new Date(input.date).toISOString().slice(0, 10) : null,
      sanitizeText(input.teacherNotes, 1000),
      JSON.stringify(input.attachmentRefs ?? []),
    ]
  );

  const review = result.rows[0];
  await recordStudyEvent({
    userId,
    eventKey: `wrong-answer:${review.id}`,
    eventType: 'wrong_answer_logged',
    sourceType: 'wrong_answer_review',
    sourceId: review.id,
    courseId: course?.id ?? null,
    payload: {
      sourceType: input.sourceType,
      sourceTitle: input.sourceTitle,
      concepts: conceptTags,
    },
  });
  if (conceptTags[0]) {
    await writeMemorySummary({
      userId,
      summaryType: 'weak_area',
      summary: `Student keeps missing ${conceptTags[0]}.`,
      courseId: course?.id ?? null,
      summaryKey: `wrong-answer:${course?.id ?? 'general'}:${conceptTags[0].toLowerCase()}`,
      importance: 5,
    });
  }

  return review;
}

export async function updateWrongAnswerReview(userId: string, reviewId: string, input: Partial<WrongAnswerInput>) {
  await ensurePlatformSchema();
  const existingResult = await db.query(`select * from wrong_answer_reviews where id = $1 and user_id = $2 limit 1`, [reviewId, userId]);
  const existing = existingResult.rows[0];
  if (!existing) {
    throw new Error('Wrong-answer review not found.');
  }

  const course = input.courseId || input.courseName
    ? await findOrCreateCourse(userId, input.courseId, input.courseName)
    : existing.course_id
      ? await findOrCreateCourse(userId, existing.course_id, null)
      : null;

  const result = await db.query(
    `update wrong_answer_reviews
     set course_id = $3,
         source_type = $4,
         source_title = $5,
         question_text = $6,
         student_answer = $7,
         correct_answer = $8,
         explanation = $9,
         concept_tags = $10,
         difficulty = $11,
         occurred_on = $12,
         teacher_notes = $13,
         attachment_refs_json = $14
     where id = $1
       and user_id = $2
     returning *`,
    [
      reviewId,
      userId,
      course?.id ?? null,
      input.sourceType ?? existing.source_type,
      sanitizeText(input.sourceTitle ?? existing.source_title, 140),
      sanitizeText(input.questionText ?? existing.question_text, 4000),
      sanitizeText(input.studentAnswer ?? existing.student_answer, 2000),
      sanitizeText(input.correctAnswer ?? existing.correct_answer, 2000),
      sanitizeText(input.explanation ?? existing.explanation, 2000),
      normalizeConceptTags(input.conceptTags ?? existing.concept_tags),
      input.difficulty ?? existing.difficulty,
      input.date ? new Date(input.date).toISOString().slice(0, 10) : existing.occurred_on,
      sanitizeText(input.teacherNotes ?? existing.teacher_notes, 1000),
      JSON.stringify(input.attachmentRefs ?? existing.attachment_refs_json ?? []),
    ]
  );

  return result.rows[0];
}

export async function deleteWrongAnswerReview(userId: string, reviewId: string) {
  await ensurePlatformSchema();
  const result = await db.query(`delete from wrong_answer_reviews where id = $1 and user_id = $2 returning id`, [reviewId, userId]);
  if (!result.rows[0]) {
    throw new Error('Wrong-answer review not found.');
  }
}

export async function storeWrongAnswerExplanation(userId: string, reviewId: string, explanationPayload: Record<string, unknown>) {
  await ensurePlatformSchema();
  const result = await db.query(
    `update wrong_answer_reviews
     set last_explanation_json = $3,
         updated_at = now()
     where id = $1
       and user_id = $2
     returning *`,
    [reviewId, userId, JSON.stringify(explanationPayload)]
  );
  if (!result.rows[0]) {
    throw new Error('Wrong-answer review not found.');
  }
  return result.rows[0];
}

export async function getWrongAnswerReview(userId: string, reviewId: string) {
  await ensurePlatformSchema();
  const result = await db.query(
    `select war.*, s.name as course_name
     from wrong_answer_reviews war
     left join subjects s on s.id = war.course_id
     where war.id = $1
       and war.user_id = $2
     limit 1`,
    [reviewId, userId]
  );
  return result.rows[0] ?? null;
}

export async function resolveCourseSummaryByName(userId: string, courseName: string) {
  await ensurePlatformSchema();
  const result = await db.query(
    `select id, name
     from subjects
     where user_id = $1
       and lower(name) = lower($2)
     limit 1`,
    [userId, normalizeName(courseName)]
  );
  if (!result.rows[0]) {
    return null;
  }
  return getCourseGradeSummary(userId, result.rows[0].id);
}

export async function buildGradeTrackerContext(userId: string, query?: string | null) {
  const dashboard = await listGradeDashboard(userId);
  const tokens = String(query ?? '').toLowerCase();
  const matchingCourses = dashboard.courses.filter((course) => tokens.includes(course.courseName.toLowerCase()));
  const relevantCourses = (matchingCourses.length ? matchingCourses : dashboard.courses).slice(0, 3);
  const topConcepts = dashboard.reviewPatterns.slice(0, 4);

  return {
    line: relevantCourses.length
      ? `Grade tracker: ${relevantCourses
          .map((course) => `${course.courseName} ${course.estimatedPercent?.toFixed(1) ?? 'N/A'}% (${course.letterGrade ?? 'N/A'})`)
          .join(' | ')}`
      : 'Grade tracker: no grades entered yet.',
    conceptLine: topConcepts.length
      ? `Wrong-answer patterns: ${topConcepts.map((item) => `${item.concept} (${item.misses})`).join(' | ')}`
      : 'Wrong-answer patterns: none recorded yet.',
  };
}
