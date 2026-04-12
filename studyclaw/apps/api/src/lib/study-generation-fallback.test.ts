import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFallbackFlashcards, buildFallbackQuiz } from './study-generation-fallback';

const sourceText = `
Photosynthesis lets plants convert sunlight, water, and carbon dioxide into glucose.
The chloroplast is the organelle where photosynthesis happens in plant cells.
Glucose stores chemical energy that plants can use later.
Carbon dioxide enters the leaf through tiny openings called stomata.
Oxygen is released as a byproduct of photosynthesis.
`;

test('buildFallbackFlashcards returns a usable study set', () => {
  const cards = buildFallbackFlashcards({
    title: 'Photosynthesis',
    text: sourceText,
    desiredCount: 6,
  });

  assert.equal(cards.length >= 4, true);
  assert.equal(cards.every((card) => card.front && card.back), true);
});

test('buildFallbackQuiz returns the requested number of questions', () => {
  const questions = buildFallbackQuiz({
    title: 'Photosynthesis Quiz',
    text: sourceText,
    questionCount: 5,
  });

  assert.equal(questions.length, 5);
  assert.equal(questions.some((question) => question.question_type === 'multiple_choice'), true);
  assert.equal(questions.some((question) => question.question_type === 'fill_in_the_blank'), true);
  assert.equal(questions.every((question) => question.question_text && question.answer.correct), true);
});
