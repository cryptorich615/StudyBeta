export const MIN_STUDY_SOURCE_TEXT_LENGTH = 24;
export const MAX_STUDY_SOURCE_TEXT_LENGTH = 12000;

export function normalizeStudySourceText(value: unknown) {
  return String(value ?? '')
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '')
    .trim();
}

export function prepareStudySourceText(value: unknown, maxLength = MAX_STUDY_SOURCE_TEXT_LENGTH) {
  const normalized = normalizeStudySourceText(value);
  if (normalized.length <= maxLength) {
    return {
      text: normalized,
      wasTruncated: false,
      originalLength: normalized.length,
    };
  }

  const truncated = normalized.slice(0, maxLength);
  const safeBoundary = Math.max(truncated.lastIndexOf('\n\n'), truncated.lastIndexOf('. '), truncated.lastIndexOf(' '));
  const clippedText = (safeBoundary > Math.floor(maxLength * 0.6) ? truncated.slice(0, safeBoundary) : truncated).trim();

  return {
    text: `${clippedText}\n\n[Source text truncated for study generation.]`,
    wasTruncated: true,
    originalLength: normalized.length,
  };
}

export function hasUsableStudySourceText(value: unknown) {
  const normalized = normalizeStudySourceText(value);
  if (normalized.length < MIN_STUDY_SOURCE_TEXT_LENGTH) {
    return false;
  }

  const alphaNumericCount = (normalized.match(/[a-z0-9]/gi) ?? []).length;
  return alphaNumericCount >= 12;
}

export function isRetryableGenerationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /OpenClaw error 5\d\d/i.test(message) || /internal error/i.test(message) || /timed out/i.test(message);
}

export function normalizeGenerationErrorMessage(input: {
  error: unknown;
  kind: 'flashcards' | 'quiz';
}) {
  const fallback =
    input.kind === 'flashcards'
      ? 'StudyClaw could not create flashcards right now. Try again in a moment.'
      : 'StudyClaw could not create a quiz right now. Try again in a moment.';
  const message = input.error instanceof Error ? input.error.message : String(input.error ?? '').trim();

  if (!message) {
    return fallback;
  }

  if (/Missing OPENCLAW_GATEWAY_TOKEN/i.test(message)) {
    return 'Study generation is not configured correctly right now. Please try again later.';
  }

  if (/timed out/i.test(message)) {
    return `This ${input.kind === 'flashcards' ? 'flashcard' : 'quiz'} request took too long. Try a shorter note or try again.`;
  }

  if (/OpenClaw error 500: internal error/i.test(message) || /OpenClaw error 5\d\d/i.test(message)) {
    return `Study generation hit a temporary upstream problem. Please try again in a moment.`;
  }

  return message;
}
