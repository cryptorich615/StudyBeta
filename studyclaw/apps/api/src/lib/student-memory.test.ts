import assert from 'node:assert/strict';
import test from 'node:test';
import { buildImprovementSummary, clamp, inferRelevantEntityIds } from './student-memory';

test('inferRelevantEntityIds prioritizes matching courses and topics from the query', () => {
  const result = inferRelevantEntityIds({
    query: 'I need help with algebra factoring before my chemistry quiz',
    courses: [
      { id: 'course-algebra', name: 'Algebra II' },
      { id: 'course-chem', name: 'Chemistry' },
    ],
    topics: [
      {
        id: 'topic-factoring',
        name: 'Factoring negatives',
        course_id: 'course-algebra',
        course_name: 'Algebra II',
        mastery_score: 0.42,
        last_reviewed_at: null,
      },
      {
        id: 'topic-stoich',
        name: 'Stoichiometry',
        course_id: 'course-chem',
        course_name: 'Chemistry',
        mastery_score: 0.63,
        last_reviewed_at: null,
      },
    ],
  });

  assert.deepEqual(result.matchedCourseIds.sort(), ['course-algebra', 'course-chem']);
  assert.deepEqual(result.matchedTopicIds.sort(), ['topic-factoring', 'topic-stoich']);
});

test('clamp keeps mastery scores inside the supported range', () => {
  assert.equal(clamp(-1), 0);
  assert.equal(clamp(0.55), 0.55);
  assert.equal(clamp(2), 1);
});

test('buildImprovementSummary creates short durable progress summaries', () => {
  const summary = buildImprovementSummary({
    topicName: 'factoring negatives',
    previousScore: 0.55,
    nextScore: 0.72,
    timeframe: 'this week',
  });

  assert.equal(summary, 'Student improved factoring negatives mastery from 0.55 to 0.72 this week.');
});
