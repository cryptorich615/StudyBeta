import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasUsableStudySourceText,
  isRetryableGenerationError,
  prepareStudySourceText,
  normalizeGenerationErrorMessage,
  normalizeStudySourceText,
} from './study-generation';

test('normalizeStudySourceText trims null bytes and whitespace', () => {
  assert.equal(normalizeStudySourceText('  line one\r\nline two\u0000  '), 'line one\nline two');
});

test('hasUsableStudySourceText rejects empty or too-short content', () => {
  assert.equal(hasUsableStudySourceText('too short'), false);
  assert.equal(hasUsableStudySourceText('Photosynthesis uses sunlight, water, and carbon dioxide to make glucose.'), true);
});

test('prepareStudySourceText truncates oversized note payloads safely', () => {
  const input = `Intro paragraph.\n\n${'Algebra practice content '.repeat(900)}`;
  const prepared = prepareStudySourceText(input, 500);
  assert.equal(prepared.wasTruncated, true);
  assert.equal(prepared.originalLength > 500, true);
  assert.equal(prepared.text.includes('[Source text truncated for study generation.]'), true);
  assert.equal(prepared.text.length <= 550, true);
});

test('isRetryableGenerationError identifies transient upstream failures', () => {
  assert.equal(isRetryableGenerationError(new Error('OpenClaw error 500: internal error')), true);
  assert.equal(isRetryableGenerationError(new Error('OpenClaw request timed out after 180000ms')), true);
  assert.equal(isRetryableGenerationError(new Error('Complete onboarding first')), false);
});

test('normalizeGenerationErrorMessage returns student-facing upstream guidance', () => {
  assert.equal(
    normalizeGenerationErrorMessage({
      error: new Error('OpenClaw error 500: internal error'),
      kind: 'flashcards',
    }),
    'Study generation hit a temporary upstream problem. Please try again in a moment.'
  );
});
