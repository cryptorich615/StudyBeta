import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWrongAnswerInsightSummary,
  calculateCourseEstimate,
  calculateRequiredFinalExamScore,
  deriveLetterGrade,
  normalizeGradeSettings,
  parseEstimatedGradeIntent,
  parseFinalTargetIntent,
  parseGradeEntryIntent,
} from './grade-tracker';

test('deriveLetterGrade uses the default scale safely', () => {
  assert.equal(deriveLetterGrade(92), 'A');
  assert.equal(deriveLetterGrade(81), 'B');
  assert.equal(deriveLetterGrade(69), 'D');
});

test('calculateCourseEstimate handles simple point-based grades', () => {
  const result = calculateCourseEstimate([
    {
      id: '1',
      user_id: 'u',
      course_id: 'c',
      title: 'Quiz 1',
      category: 'quiz',
      points_earned: 18,
      points_possible: 20,
      percent: null,
      weight: null,
      occurred_on: '2026-03-01',
      notes: null,
      created_at: '2026-03-01T00:00:00Z',
    },
    {
      id: '2',
      user_id: 'u',
      course_id: 'c',
      title: 'Homework 1',
      category: 'homework',
      points_earned: 9,
      points_possible: 10,
      percent: null,
      weight: null,
      occurred_on: '2026-03-02',
      notes: null,
      created_at: '2026-03-02T00:00:00Z',
    },
  ]);

  assert.equal(result.estimatedPercent, 90);
  assert.equal(result.letterGrade, 'A');
  assert.equal(result.weighted, false);
});

test('calculateCourseEstimate supports weighted categories and warns on partial coverage', () => {
  const settings = normalizeGradeSettings({
    calculationMode: 'weighted',
    categoryWeights: {
      homework: 30,
      test: 50,
      participation: 20,
    },
  });

  const result = calculateCourseEstimate([
    {
      id: '1',
      user_id: 'u',
      course_id: 'c',
      title: 'Homework',
      category: 'homework',
      points_earned: 45,
      points_possible: 50,
      percent: null,
      weight: null,
      occurred_on: null,
      notes: null,
      created_at: '2026-03-01T00:00:00Z',
    },
    {
      id: '2',
      user_id: 'u',
      course_id: 'c',
      title: 'Unit test',
      category: 'test',
      points_earned: 80,
      points_possible: 100,
      percent: null,
      weight: null,
      occurred_on: null,
      notes: null,
      created_at: '2026-03-02T00:00:00Z',
    },
  ], settings);

  assert.equal(result.weighted, true);
  assert.equal(result.estimatedPercent, 83.75);
  assert.match(result.warnings[0] ?? '', /80\.0%/);
});

test('calculateCourseEstimate falls back to entered percentages when points are incomplete', () => {
  const result = calculateCourseEstimate([
    {
      id: '1',
      user_id: 'u',
      course_id: 'c',
      title: 'Participation',
      category: 'participation',
      points_earned: null,
      points_possible: null,
      percent: 88,
      weight: null,
      occurred_on: null,
      notes: null,
      created_at: '2026-03-01T00:00:00Z',
    },
  ]);

  assert.equal(result.estimatedPercent, 88);
  assert.match(result.warnings[0] ?? '', /percentages/);
});

test('calculateRequiredFinalExamScore handles explicit final weight', () => {
  const result = calculateRequiredFinalExamScore({
    currentPercent: 84,
    targetPercent: 90,
    finalWeightPercent: 20,
  });

  assert.equal(result.requiredOnFinal, 114);
  assert.equal(result.canReachTarget, false);
});

test('calculateRequiredFinalExamScore explains incomplete data clearly', () => {
  const result = calculateRequiredFinalExamScore({
    currentPercent: null,
    targetPercent: 80,
  });

  assert.equal(result.requiredOnFinal, null);
  assert.equal(result.canReachTarget, null);
  assert.match(result.assumptions.join(' '), /current estimated grade/i);
});

test('parseGradeEntryIntent extracts course, category, and score', () => {
  const parsed = parseGradeEntryIntent('Add my Biology quiz grade: 18/25 for Chapter 4 quiz');
  assert.deepEqual(parsed, {
    courseName: 'Biology',
    category: 'quiz',
    pointsEarned: 18,
    pointsPossible: 25,
    title: 'Chapter 4 quiz',
  });
});

test('parseEstimatedGradeIntent finds the course name', () => {
  assert.equal(parseEstimatedGradeIntent("What's my estimated grade in Algebra II?"), 'Algebra II');
});

test('parseFinalTargetIntent understands letter-grade targets', () => {
  const parsed = parseFinalTargetIntent('What do I need on the final in Chemistry to get a B?');
  assert.deepEqual(parsed, {
    courseName: 'Chemistry',
    targetPercent: 80,
    targetLabel: 'B',
  });
});

test('buildWrongAnswerInsightSummary groups concept misses safely', () => {
  const result = buildWrongAnswerInsightSummary([
    { concept_tags: ['factoring', 'negatives'] },
    { concept_tags: ['factoring'] },
    { concept_tags: ['stoichiometry'] },
  ]);

  assert.deepEqual(result[0], { concept: 'factoring', misses: 2 });
});
