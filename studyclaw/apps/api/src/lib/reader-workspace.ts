export type ReaderFormat = 'pdf' | 'epub' | 'text' | 'html' | 'word' | 'image' | 'audio' | 'unknown';

type ReaderAttachment = {
  name?: string | null;
  type?: string | null;
  size?: number | null;
};

type InferReaderFormatInput = {
  assetType?: string | null;
  title?: string | null;
  fileUrl?: string | null;
  attachments?: ReaderAttachment[] | null;
};

function getExtension(value: string | null | undefined) {
  const cleaned = String(value ?? '').trim().toLowerCase();
  const withoutQuery = cleaned.split('?')[0];
  const lastDot = withoutQuery.lastIndexOf('.');
  return lastDot >= 0 ? withoutQuery.slice(lastDot + 1) : '';
}

export function inferReaderFormat(input: InferReaderFormatInput): ReaderFormat {
  const candidates = [
    getExtension(input.title),
    getExtension(input.fileUrl),
    ...(input.attachments ?? []).flatMap((item) => [getExtension(item.name), String(item.type ?? '').toLowerCase()]),
  ].filter(Boolean);

  if (input.assetType === 'uploaded_pdf' || candidates.some((value) => value === 'pdf' || value.includes('application/pdf'))) {
    return 'pdf';
  }
  if (candidates.some((value) => value === 'epub' || value.includes('application/epub'))) {
    return 'epub';
  }
  if (candidates.some((value) => value === 'html' || value === 'htm' || value.includes('text/html'))) {
    return 'html';
  }
  if (candidates.some((value) => ['doc', 'docx', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(value))) {
    return 'word';
  }
  if (input.assetType === 'image_note' || candidates.some((value) => value.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(value))) {
    return 'image';
  }
  if (input.assetType === 'audio_note' || candidates.some((value) => value.startsWith('audio/') || ['mp3', 'wav', 'aac', 'ogg', 'm4a'].includes(value))) {
    return 'audio';
  }
  if (candidates.some((value) => value === 'txt' || value === 'md' || value.includes('text/plain'))) {
    return 'text';
  }
  if (input.assetType === 'typed_note') {
    return 'text';
  }
  return 'unknown';
}

export function isReaderSupported(format: ReaderFormat) {
  return format === 'pdf' || format === 'epub' || format === 'text' || format === 'html' || format === 'word';
}

export function getDocumentBody(input: { processedText?: string | null; originalText?: string | null }) {
  const processed = String(input.processedText ?? '').replace(/\u0000/g, '').trim();
  if (processed) {
    return processed;
  }

  return String(input.originalText ?? '').replace(/\u0000/g, '').trim();
}

export function splitDocumentIntoPages(text: string, charsPerPage = 2200) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [] as string[];
  }

  if (normalized.length <= charsPerPage) {
    return [normalized];
  }

  const pages: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    let nextCursor = Math.min(cursor + charsPerPage, normalized.length);
    if (nextCursor < normalized.length) {
      const paragraphBreak = normalized.lastIndexOf('\n\n', nextCursor);
      const sentenceBreak = normalized.lastIndexOf('. ', nextCursor);
      const softBreak = normalized.lastIndexOf(' ', nextCursor);
      const breakPoint = [paragraphBreak, sentenceBreak, softBreak].find((value) => value > cursor + 400);
      if (breakPoint) {
        nextCursor = breakPoint + 1;
      }
    }

    pages.push(normalized.slice(cursor, nextCursor).trim());
    cursor = nextCursor;
  }

  return pages.filter(Boolean);
}

export function summarizeReaderAvailability(input: {
  format: ReaderFormat;
  hasContent: boolean;
  hasFileUrl: boolean;
}) {
  if (isReaderSupported(input.format) && (input.hasContent || input.hasFileUrl)) {
    return {
      supported: true,
      message:
        input.format === 'word'
          ? 'Word documents open in extracted-text mode for reading and study actions.'
          : input.format === 'pdf'
            ? 'PDFs open in StudyClaw reader mode with extracted text when available.'
            : 'This document can be opened directly in StudyClaw reader mode.',
    };
  }

  if (input.hasFileUrl) {
    return {
      supported: false,
      message: 'This file type is not fully supported in-reader yet. Preview metadata is available, and the original file link can be used as fallback.',
    };
  }

  return {
    supported: false,
    message: 'StudyClaw could not prepare a readable in-app version of this file yet.',
  };
}
