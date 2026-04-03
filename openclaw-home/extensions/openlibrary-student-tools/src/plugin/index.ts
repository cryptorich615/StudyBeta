import openLibraryModule from 'file:///home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/openlibrary.ts';

const {
  buildOpenLibraryCoverUrl,
  openLibraryGetBookDetails,
  openLibraryGetSubjectBooks,
  openLibrarySearchBooks,
  openLibrarySearchInsideBook,
} = openLibraryModule as Record<string, any>;

function jsonToolResult(payload: Record<string, unknown>) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

function describeBook(book: any) {
  const authorText = Array.isArray(book?.authors) && book.authors.length
    ? ` by ${book.authors.slice(0, 3).join(', ')}`
    : '';
  const yearText = book?.publishYear ?? book?.firstPublishYear ? ` (${book.publishYear ?? book.firstPublishYear})` : '';
  const reasonText = typeof book?.reason === 'string' && book.reason.trim() ? ` — ${book.reason.trim()}` : '';
  return `- ${book?.title ?? 'Untitled'}${authorText}${yearText}${reasonText}`;
}

function summarizeSearch(payload: { results?: any[]; totalFound?: number; query?: string }) {
  const lines = [
    `Open Library search results${payload.query ? ` for "${payload.query}"` : ''}: ${payload.totalFound ?? payload.results?.length ?? 0} found.`,
    '',
  ];

  for (const book of payload.results ?? []) {
    lines.push(describeBook(book));
  }

  return lines.join('\n').trim();
}

const openLibraryPlugin = {
  id: 'openlibrary-student-tools',
  name: 'Open Library Student Tools',
  description: 'Book, textbook, and subject lookup tools for student research and study planning.',
  register(api: any) {
    api.registerTool(() => ({
      name: 'openlibrary_search_books',
      label: 'Open Library Search Books',
      description:
        'Search Open Library by keyword, title, author, subject, or ISBN to find textbooks and books for student research.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          q: { type: 'string', description: 'General keyword query.' },
          title: { type: 'string', description: 'Book title to search for.' },
          author: { type: 'string', description: 'Author name to search for.' },
          subject: { type: 'string', description: 'Subject or class topic to search for.' },
          isbn: { type: 'string', description: 'ISBN-10 or ISBN-13.' },
          limit: { type: 'number', minimum: 1, maximum: 20 },
        },
      },
      async execute(_toolCallId: string, params: any) {
        try {
          const result = await openLibrarySearchBooks(params ?? {});
          return {
            content: [{ type: 'text', text: summarizeSearch(result) }],
            details: result,
          };
        } catch (error) {
          api.logger.error?.(`[openlibrary] search failed: ${error instanceof Error ? error.message : String(error)}`);
          return jsonToolResult({
            error: error instanceof Error ? error.message : 'Open Library search failed',
          });
        }
      },
    }));

    api.registerTool(() => ({
      name: 'openlibrary_get_subject_books',
      label: 'Open Library Subject Books',
      description:
        'Get book and textbook matches for a subject like algebra, biology, chemistry, literature, or history.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['subject'],
        properties: {
          subject: { type: 'string', description: 'Subject to search, like algebra or biology.' },
          limit: { type: 'number', minimum: 1, maximum: 20 },
          ebooks: { type: 'boolean' },
          details: { type: 'boolean' },
          publishedIn: { type: 'string', description: 'Optional publish year range filter.' },
        },
      },
      async execute(_toolCallId: string, params: any) {
        try {
          const result = await openLibraryGetSubjectBooks({
            subject: String(params?.subject ?? ''),
            limit: params?.limit,
            ebooks: params?.ebooks,
            details: params?.details,
            publishedIn: params?.publishedIn,
          });
          return {
            content: [
              {
                type: 'text',
                text: [
                  `Open Library subject results for "${result.subject}" (${result.results.length} shown):`,
                  '',
                  ...result.results.map(describeBook),
                ].join('\n').trim(),
              },
            ],
            details: result,
          };
        } catch (error) {
          api.logger.error?.(`[openlibrary] subject lookup failed: ${error instanceof Error ? error.message : String(error)}`);
          return jsonToolResult({
            error: error instanceof Error ? error.message : 'Open Library subject lookup failed',
          });
        }
      },
    }));

    api.registerTool(() => ({
      name: 'openlibrary_get_book_details',
      label: 'Open Library Book Details',
      description:
        'Fetch detailed metadata for a selected Open Library work, edition, OLID, or ISBN.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workKey: { type: 'string', description: 'Open Library work key like /works/OL82563W.' },
          editionKey: { type: 'string', description: 'Open Library edition key like OL7353617M.' },
          olid: { type: 'string', description: 'Edition OLID.' },
          isbn: { type: 'string', description: 'ISBN-10 or ISBN-13.' },
        },
      },
      async execute(_toolCallId: string, params: any) {
        try {
          const result = await openLibraryGetBookDetails(params ?? {});
          return {
            content: [
              {
                type: 'text',
                text: result.book
                  ? `Open Library book details:\n\n${describeBook(result.book)}`
                  : 'No Open Library book details were found for that identifier.',
              },
            ],
            details: result,
          };
        } catch (error) {
          api.logger.error?.(`[openlibrary] details lookup failed: ${error instanceof Error ? error.message : String(error)}`);
          return jsonToolResult({
            error: error instanceof Error ? error.message : 'Open Library book details lookup failed',
          });
        }
      },
    }));

    api.registerTool(() => ({
      name: 'openlibrary_get_cover_url',
      label: 'Open Library Cover URL',
      description: 'Builds a valid Open Library Covers API URL for a book cover.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          coverId: { type: ['number', 'string'], description: 'Open Library cover ID.' },
          olid: { type: 'string', description: 'Open Library edition OLID.' },
          isbn: { type: 'string', description: 'ISBN-10 or ISBN-13.' },
          size: { type: 'string', enum: ['S', 'M', 'L'] },
        },
      },
      async execute(_toolCallId: string, params: any) {
        try {
          const url = buildOpenLibraryCoverUrl(params ?? {});
          return jsonToolResult({
            url,
            available: Boolean(url),
          });
        } catch (error) {
          api.logger.error?.(`[openlibrary] cover lookup failed: ${error instanceof Error ? error.message : String(error)}`);
          return jsonToolResult({
            error: error instanceof Error ? error.message : 'Open Library cover lookup failed',
          });
        }
      },
    }));

    api.registerTool(() => ({
      name: 'openlibrary_search_inside_book',
      label: 'Open Library Search Inside Book',
      description:
        'Experimental search-inside lookup using Open Library and Internet Archive identifiers when supported.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['q'],
        properties: {
          q: { type: 'string', description: 'Text to search for inside the book.' },
          bookId: { type: 'string', description: 'Internet Archive item ID from Open Library details.' },
          doc: { type: 'string' },
          host: { type: 'string' },
          path: { type: 'string' },
        },
      },
      async execute(_toolCallId: string, params: any) {
        try {
          const result = await openLibrarySearchInsideBook({
            q: String(params?.q ?? ''),
            bookId: params?.bookId,
            doc: params?.doc,
            host: params?.host,
            path: params?.path,
          });
          return jsonToolResult(result);
        } catch (error) {
          api.logger.error?.(`[openlibrary] search-inside failed: ${error instanceof Error ? error.message : String(error)}`);
          return jsonToolResult({
            error: error instanceof Error ? error.message : 'Open Library search-inside failed',
          });
        }
      },
    }));

    api.logger.info?.('[openlibrary] student tools loaded');
  },
};

export default openLibraryPlugin;
