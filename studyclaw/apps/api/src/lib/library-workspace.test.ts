import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLibraryBookKey } from './library-workspace';

test('buildLibraryBookKey prefers stable ids before title fallback', () => {
  assert.equal(
    buildLibraryBookKey({
      key: '/works/OL123W',
      gb_id: 'ignored',
      openLibraryUrl: 'https://openlibrary.org/works/OL123W',
      title: 'Biology',
    }),
    '/works/OL123W'
  );

  assert.equal(
    buildLibraryBookKey({
      gb_id: 'google-book-id',
      openLibraryUrl: 'https://openlibrary.org/books/OL1M',
      title: 'Chemistry',
    }),
    'google-book-id'
  );

  assert.equal(
    buildLibraryBookKey({
      title: 'Physics Textbook',
    }),
    'Physics Textbook'
  );
});
