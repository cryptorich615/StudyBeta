import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenLibraryError,
  buildOpenLibraryCoverUrl,
  createOpenLibraryClient,
  normalizeOpenLibraryBook,
  normalizeSubjectForLookup,
} from './openlibrary';

test('normalizeSubjectForLookup broadens class-friendly subjects safely', () => {
  assert.equal(normalizeSubjectForLookup('Algebra 1'), 'algebra');
  assert.equal(normalizeSubjectForLookup('World History'), 'history');
  assert.equal(normalizeSubjectForLookup('AP Biology Textbook'), 'biology');
});

test('buildOpenLibraryCoverUrl supports cover IDs, OLIDs, and ISBNs', () => {
  assert.equal(
    buildOpenLibraryCoverUrl({ coverId: 1234, size: 'L' }),
    'https://covers.openlibrary.org/b/id/1234-L.jpg'
  );
  assert.equal(
    buildOpenLibraryCoverUrl({ olid: 'OL7353617M', size: 'S' }),
    'https://covers.openlibrary.org/b/olid/OL7353617M-S.jpg'
  );
  assert.equal(
    buildOpenLibraryCoverUrl({ isbn: '978-0-13-110362-7', size: 'M' }),
    'https://covers.openlibrary.org/b/isbn/9780131103627-M.jpg'
  );
});

test('normalizeOpenLibraryBook produces predictable student-facing fields', () => {
  const result = normalizeOpenLibraryBook({
    title: 'Campbell Biology',
    subtitle: 'Concepts & Connections',
    author_name: ['Jane B. Reece', 'Martha R. Taylor'],
    publish_year: [2020],
    first_publish_year: 1987,
    subject: ['Biology', 'Textbooks'],
    isbn: ['9780135269169'],
    edition_count: 12,
    language: ['eng'],
    cover_i: 9876,
    key: '/works/OL82563W',
    edition_key: ['OL123M'],
    ebook_access: 'borrowable',
    description: 'A standard introductory biology textbook.',
  });

  assert.equal(result.title, 'Campbell Biology');
  assert.deepEqual(result.authors, ['Jane B. Reece', 'Martha R. Taylor']);
  assert.equal(result.publishYear, 2020);
  assert.equal(result.firstPublishYear, 1987);
  assert.equal(result.cover?.preferredUrl, 'https://covers.openlibrary.org/b/id/9876-M.jpg');
  assert.equal(result.openLibraryWorkKey, '/works/OL82563W');
  assert.equal(result.openLibraryEditionKey, 'OL123M');
  assert.equal(result.ebookAccess, 'borrow');
});

test('searchBooks normalizes Open Library search results', async () => {
  const client = createOpenLibraryClient({
    fetchImpl: async (input) =>
      new Response(
        JSON.stringify({
          numFound: 1,
          docs: [
            {
              title: 'Linear Algebra Done Right',
              author_name: ['Sheldon Axler'],
              first_publish_year: 1995,
              edition_key: ['OL1M'],
              key: '/works/OL1W',
              cover_i: 123,
              subject: ['Algebra'],
              isbn: ['9783319110790'],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      ),
  });

  const result = await client.searchBooks({ title: 'Linear Algebra', limit: 5 });

  assert.equal(result.totalFound, 1);
  assert.equal(result.results[0]?.title, 'Linear Algebra Done Right');
  assert.equal(result.results[0]?.reason, 'Title closely matches the request.');
});

test('getSubjectBooks normalizes subject responses', async () => {
  const calls: string[] = [];
  const client = createOpenLibraryClient({
    fetchImpl: async (input) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({
          works: [
            {
              title: 'OpenStax Biology',
              authors: [{ name: 'OpenStax' }],
              first_publish_year: 2018,
              edition_count: 1,
              cover_id: 456,
              key: '/works/OL77W',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    },
  });

  const result = await client.getSubjectBooks({ subject: 'Biology', limit: 3, ebooks: true });

  assert.match(calls[0] ?? '', /subjects\/biology\.json/);
  assert.equal(result.normalizedSubject, 'biology');
  assert.equal(result.results[0]?.title, 'OpenStax Biology');
});

test('getBookDetails merges edition and work metadata', async () => {
  const client = createOpenLibraryClient({
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes('/books/OL123M.json')) {
        return new Response(
          JSON.stringify({
            key: '/books/OL123M',
            title: 'Chemistry: The Central Science',
            isbn_13: ['9780134414233'],
            languages: [{ key: '/languages/eng' }],
            works: [{ key: '/works/OL900W' }],
            authors: [{ key: '/authors/OL1A' }],
            publish_date: '2017',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/works/OL900W.json')) {
        return new Response(
          JSON.stringify({
            key: '/works/OL900W',
            description: { value: 'General chemistry textbook.' },
            subjects: ['Chemistry', 'Textbooks'],
            edition_count: 4,
            authors: [{ author: { key: '/authors/OL1A' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/authors/OL1A.json')) {
        return new Response(
          JSON.stringify({ name: 'Theodore E. Brown' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected URL ${url}`);
    },
  });

  const result = await client.getBookDetails({ editionKey: 'OL123M' });

  assert.equal(result.source, 'edition');
  assert.equal(result.book?.title, 'Chemistry: The Central Science');
  assert.deepEqual(result.book?.authors, ['Theodore E. Brown']);
  assert.deepEqual(result.book?.subject, ['Chemistry', 'Textbooks']);
});

test('getBookDetails falls back to edition metadata when a linked work is missing', async () => {
  const client = createOpenLibraryClient({
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes('/books/OL404M.json')) {
        return new Response(
          JSON.stringify({
            key: '/books/OL404M',
            title: 'Introductory Algebra',
            isbn_13: ['9780134462707'],
            works: [{ key: '/works/OL404W' }],
            authors: [{ key: '/authors/OL2A' }],
            publish_date: '2016',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/works/OL404W.json')) {
        return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      }

      if (url.includes('/authors/OL2A.json')) {
        return new Response(
          JSON.stringify({ name: 'Margaret L. Lial' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected URL ${url}`);
    },
  });

  const result = await client.getBookDetails({ editionKey: 'OL404M' });

  assert.equal(result.book?.title, 'Introductory Algebra');
  assert.deepEqual(result.book?.authors, ['Margaret L. Lial']);
  assert.equal(result.book?.openLibraryEditionKey, 'OL404M');
});

test('searchBooks retries transient upstream failures safely', async () => {
  let attempts = 0;
  const client = createOpenLibraryClient({
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response('retry later', { status: 503 });
      }

      return new Response(
        JSON.stringify({ numFound: 0, docs: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    },
  });

  const result = await client.searchBooks({ q: 'history of science' });

  assert.equal(attempts, 2);
  assert.equal(result.totalFound, 0);
});

test('searchBooks raises a clear error on permanent failures', async () => {
  const client = createOpenLibraryClient({
    maxRetries: 0,
    fetchImpl: async () => new Response('not found', { status: 404 }),
  });

  await assert.rejects(
    () => client.searchBooks({ q: 'missing book' }),
    (error: unknown) =>
      error instanceof OpenLibraryError &&
      error.status === 404 &&
      /Open Library request failed/.test(error.message)
  );
});

test('searchInsideBook stays feature-gated unless enabled explicitly', async () => {
  const client = createOpenLibraryClient({
    enableSearchInside: false,
  });

  const result = await client.searchInsideBook({
    q: 'library science',
    bookId: 'designevaluation25clin',
  });

  assert.equal(result.enabled, false);
  assert.equal(result.supported, false);
  assert.equal(result.url, null);
});
