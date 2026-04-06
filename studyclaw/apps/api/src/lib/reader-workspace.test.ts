import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDocumentBody,
  inferReaderFormat,
  isReaderSupported,
  splitDocumentIntoPages,
  summarizeReaderAvailability,
} from './reader-workspace';

test('inferReaderFormat recognizes uploaded pdfs and common student document formats safely', () => {
  assert.equal(inferReaderFormat({ assetType: 'uploaded_pdf', title: 'lecture.pdf' }), 'pdf');
  assert.equal(inferReaderFormat({ title: 'essay.docx' }), 'word');
  assert.equal(inferReaderFormat({ title: 'lab-data.xlsx' }), 'spreadsheet');
  assert.equal(inferReaderFormat({ title: 'review-slides.pptx' }), 'presentation');
  assert.equal(inferReaderFormat({ title: 'teacher-note.rtf' }), 'richtext');
  assert.equal(inferReaderFormat({ title: 'chapter.epub' }), 'epub');
  assert.equal(inferReaderFormat({ title: 'table.csv' }), 'text');
  assert.equal(inferReaderFormat({ assetType: 'typed_note', title: 'notes.txt' }), 'text');
});

test('getDocumentBody prefers processed text and strips null bytes', () => {
  assert.equal(getDocumentBody({ processedText: 'Clean text', originalText: 'Raw' }), 'Clean text');
  assert.equal(getDocumentBody({ processedText: '', originalText: 'Raw\u0000 text' }), 'Raw text');
});

test('splitDocumentIntoPages creates stable page chunks for long text', () => {
  const text = `${'A short paragraph. '.repeat(120)}\n\n${'Another paragraph. '.repeat(120)}`;
  const pages = splitDocumentIntoPages(text, 800);
  assert.ok(pages.length >= 3);
  assert.ok(pages.every((page) => page.length <= 900));
});

test('summarizeReaderAvailability explains support and fallbacks clearly', () => {
  const supported = summarizeReaderAvailability({ format: 'pdf', hasContent: true, hasFileUrl: false });
  assert.equal(supported.supported, true);
  assert.match(supported.message, /PDF/i);

  const spreadsheet = summarizeReaderAvailability({ format: 'spreadsheet', hasContent: true, hasFileUrl: false });
  assert.equal(spreadsheet.supported, true);
  assert.match(spreadsheet.message, /Spreadsheet/i);

  const unsupported = summarizeReaderAvailability({ format: 'unknown', hasContent: false, hasFileUrl: true });
  assert.equal(isReaderSupported('unknown'), false);
  assert.equal(isReaderSupported('presentation'), true);
  assert.equal(unsupported.supported, false);
  assert.match(unsupported.message, /not fully supported/i);
});
