import { loadRepoEnv } from './load-env';

loadRepoEnv();

export type OpenLibrarySearchBooksInput = {
  q?: string | null;
  title?: string | null;
  author?: string | null;
  subject?: string | null;
  isbn?: string | null;
  limit?: number | null;
};

export type OpenLibrarySubjectBooksInput = {
  subject: string;
  limit?: number | null;
  ebooks?: boolean | null;
  details?: boolean | null;
  publishedIn?: string | null;
};

export type OpenLibraryBookDetailsInput = {
  workKey?: string | null;
  editionKey?: string | null;
  olid?: string | null;
  isbn?: string | null;
};

export type OpenLibraryCoverInput = {
  coverId?: number | string | null;
  olid?: string | null;
  isbn?: string | null;
  size?: OpenLibraryCoverSize | null;
};

export type OpenLibrarySearchInsideInput = {
  q: string;
  bookId?: string | null;
  doc?: string | null;
  host?: string | null;
  path?: string | null;
};

export type OpenLibraryCoverSize = 'S' | 'M' | 'L';

export type NormalizedCover = {
  id: number | null;
  preferredUrl: string;
  urls: {
    small: string;
    medium: string;
    large: string;
  };
};

export type NormalizedBook = {
  title: string;
  subtitle: string | null;
  authors: string[];
  publishYear: number | null;
  firstPublishYear: number | null;
  subject: string[];
  isbn: string[];
  editionCount: number | null;
  language: string[];
  cover: NormalizedCover | null;
  openLibraryWorkKey: string | null;
  openLibraryEditionKey: string | null;
  openLibraryUrl: string | null;
  ebookAccess: 'full' | 'borrow' | 'preview' | 'none';
  description: string | null;
  publishers: string[];
  publishDate: string | null;
  pageCount: number | null;
  internetArchiveIds: string[];
  reason: string | null;
};

export type OpenLibrarySearchBooksResult = {
  query: string;
  totalFound: number;
  results: NormalizedBook[];
};

export type OpenLibrarySubjectBooksResult = {
  subject: string;
  normalizedSubject: string;
  results: NormalizedBook[];
};

export type OpenLibraryBookDetailsResult = {
  book: NormalizedBook | null;
  source: 'work' | 'edition' | 'isbn';
};

export type OpenLibrarySearchInsideResult = {
  enabled: boolean;
  supported: boolean;
  message: string;
  url: string | null;
};

type FetchLike = typeof fetch;

type OpenLibraryClientConfig = {
  baseUrl: string;
  coversBaseUrl: string;
  timeoutMs: number;
  minIntervalMs: number;
  cacheTtlMs: number;
  maxRetries: number;
  enableSearchInside: boolean;
  userAgentName: string;
  contactEmail: string;
  fetchImpl: FetchLike;
};

type CacheEntry = {
  expiresAt: number;
  payload: unknown;
};

type OpenLibrarySearchDoc = Record<string, any>;
type OpenLibrarySubjectResponse = Record<string, any> & {
  works?: OpenLibrarySearchDoc[];
};
type OpenLibraryEditionRecord = Record<string, any>;
type OpenLibraryWorkRecord = Record<string, any>;

const DEFAULT_TIMEOUT_MS = Number(process.env.OPENLIBRARY_TIMEOUT_MS ?? 7_500);
const DEFAULT_MIN_INTERVAL_MS = Number(process.env.OPENLIBRARY_MIN_INTERVAL_MS ?? 250);
const DEFAULT_CACHE_TTL_MS = Number(process.env.OPENLIBRARY_CACHE_TTL_MS ?? 10 * 60 * 1000);
const DEFAULT_MAX_RETRIES = Number(process.env.OPENLIBRARY_MAX_RETRIES ?? 2);
const OPENLIBRARY_BASE_URL = process.env.OPENLIBRARY_BASE_URL ?? 'https://openlibrary.org';
const OPENLIBRARY_COVERS_BASE_URL = process.env.OPENLIBRARY_COVERS_BASE_URL ?? 'https://covers.openlibrary.org';
const OPENLIBRARY_CONTACT_EMAIL = process.env.OPENLIBRARY_CONTACT_EMAIL ?? 'support@studyclaw.app';
const OPENLIBRARY_USER_AGENT_NAME = process.env.OPENLIBRARY_USER_AGENT_NAME ?? 'StudyClaw';
const OPENLIBRARY_ENABLE_SEARCH_INSIDE =
  String(process.env.OPENLIBRARY_ENABLE_SEARCH_INSIDE ?? 'false').toLowerCase() === 'true';

const subjectAliasMap: Array<[RegExp, string]> = [
  [/\bap\s+/gi, ''],
  [/\balgebra\s*(1|i)\b/gi, 'algebra'],
  [/\balgebra\s*(2|ii)\b/gi, 'algebra'],
  [/\bbiology\b/gi, 'biology'],
  [/\bworld\s+history\b/gi, 'history'],
  [/\bus\s+history\b/gi, 'history'],
  [/\bcalculus\s*(ab|bc)?\b/gi, 'calculus'],
  [/\bchem\b/gi, 'chemistry'],
  [/\benglish\s+literature\b/gi, 'literature'],
  [/\btextbooks?\b/gi, 'textbooks'],
];

export class OpenLibraryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retriable = false
  ) {
    super(message);
    this.name = 'OpenLibraryError';
  }
}

export function normalizeSubjectForLookup(subject: string) {
  const cleaned = subjectAliasMap.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    subject.trim().toLowerCase()
  );

  const normalizedWords = cleaned
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(and|for|the|an|a)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  const filteredWords =
    normalizedWords.length > 1
      ? normalizedWords.filter((word) => word !== 'textbook' && word !== 'textbooks')
      : normalizedWords;

  return filteredWords.join('_');
}

export function buildOpenLibraryCoverUrl(input: OpenLibraryCoverInput) {
  const size = normalizeCoverSize(input.size);

  if (input.coverId !== undefined && input.coverId !== null && String(input.coverId).trim()) {
    return `${OPENLIBRARY_COVERS_BASE_URL.replace(/\/$/, '')}/b/id/${encodeURIComponent(String(input.coverId).trim())}-${size}.jpg`;
  }

  if (input.olid?.trim()) {
    return `${OPENLIBRARY_COVERS_BASE_URL.replace(/\/$/, '')}/b/olid/${encodeURIComponent(input.olid.trim())}-${size}.jpg`;
  }

  if (input.isbn?.trim()) {
    return `${OPENLIBRARY_COVERS_BASE_URL.replace(/\/$/, '')}/b/isbn/${encodeURIComponent(normalizeIsbn(input.isbn))}-${size}.jpg`;
  }

  return null;
}

export function normalizeOpenLibraryBook(record: Record<string, any>, options?: { reason?: string | null }): NormalizedBook {
  const editionKey = normalizeEditionKey(
    record.openLibraryEditionKey ??
      record.edition_key?.[0] ??
      record.cover_edition_key ??
      record.key
  );
  const workKey = normalizeWorkKey(record.openLibraryWorkKey ?? record.key ?? record.works?.[0]?.key);
  const isbnList = uniqueStrings([
    ...(Array.isArray(record.isbn) ? record.isbn : []),
    ...(Array.isArray(record.isbn_13) ? record.isbn_13 : []),
    ...(Array.isArray(record.isbn_10) ? record.isbn_10 : []),
  ]).map(normalizeIsbn);
  const coverId = coerceNumber(
    record.cover_i ??
      record.cover_id ??
      record.covers?.[0] ??
      null
  );

  const cover = coverId || editionKey || isbnList[0]
    ? buildCoverMetadata({
        coverId,
        olid: editionKey,
        isbn: isbnList[0] ?? null,
      })
    : null;

  const description = normalizeDescription(record.description ?? record.subtitle ?? null);
  const ebookAccess = normalizeEbookAccess(record);
  const openLibraryUrl = workKey
    ? `${OPENLIBRARY_BASE_URL.replace(/\/$/, '')}${workKey}`
    : editionKey
      ? `${OPENLIBRARY_BASE_URL.replace(/\/$/, '')}/books/${editionKey}`
      : typeof record.url === 'string' && record.url.startsWith('http')
        ? record.url
        : null;

  return {
    title: String(record.title ?? 'Untitled').trim(),
    subtitle: normalizeOptionalString(record.subtitle),
    authors: normalizeAuthors(record),
    publishYear: coerceYear(record.publish_year?.[0] ?? record.publishYear ?? record.publish_date),
    firstPublishYear: coerceYear(record.first_publish_year ?? record.first_publish_date),
    subject: uniqueStrings([
      ...(Array.isArray(record.subject) ? record.subject : []),
      ...(Array.isArray(record.subjects) ? record.subjects : []),
    ]),
    isbn: isbnList,
    editionCount: coerceNumber(record.edition_count),
    language: normalizeLanguages(record.language ?? record.languages),
    cover,
    openLibraryWorkKey: workKey,
    openLibraryEditionKey: editionKey,
    openLibraryUrl,
    ebookAccess,
    description,
    publishers: uniqueStrings(Array.isArray(record.publishers) ? record.publishers : []),
    publishDate: normalizeOptionalString(record.publish_date),
    pageCount: coerceNumber(record.number_of_pages ?? record.pagination),
    internetArchiveIds: uniqueStrings([
      ...(Array.isArray(record.ia) ? record.ia : []),
      ...(record.ocaid ? [record.ocaid] : []),
    ]),
    reason: normalizeOptionalString(options?.reason) ?? deriveReason(record, ebookAccess),
  };
}

export function createOpenLibraryClient(partial: Partial<OpenLibraryClientConfig> = {}) {
  const config: OpenLibraryClientConfig = {
    baseUrl: partial.baseUrl ?? OPENLIBRARY_BASE_URL,
    coversBaseUrl: partial.coversBaseUrl ?? OPENLIBRARY_COVERS_BASE_URL,
    timeoutMs: partial.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    minIntervalMs: partial.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
    cacheTtlMs: partial.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    maxRetries: partial.maxRetries ?? DEFAULT_MAX_RETRIES,
    enableSearchInside: partial.enableSearchInside ?? OPENLIBRARY_ENABLE_SEARCH_INSIDE,
    userAgentName: partial.userAgentName ?? OPENLIBRARY_USER_AGENT_NAME,
    contactEmail: partial.contactEmail ?? OPENLIBRARY_CONTACT_EMAIL,
    fetchImpl: partial.fetchImpl ?? fetch,
  };

  const cache = new Map<string, CacheEntry>();
  let nextRequestAt = 0;
  let throttleChain = Promise.resolve();

  async function waitForThrottleSlot() {
    let release: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = throttleChain;
    throttleChain = previous.finally(() => ready);
    await previous;

    const now = Date.now();
    const delayMs = Math.max(0, nextRequestAt - now);
    nextRequestAt = now + delayMs + config.minIntervalMs;
    if (delayMs > 0) {
      await delay(delayMs);
    }

    release?.();
  }

  async function fetchJson<T>(pathname: string, query?: URLSearchParams, cacheTtlMs = config.cacheTtlMs): Promise<T> {
    const url = buildApiUrl(config.baseUrl, pathname, query);
    const cacheKey = url.toString();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.payload as T;
    }

    let attempt = 0;
    while (attempt <= config.maxRetries) {
      attempt += 1;
      await waitForThrottleSlot();

      const controller = AbortSignal.timeout(config.timeoutMs);
      try {
        const response = await config.fetchImpl(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': `${config.userAgentName} (${config.contactEmail})`,
          },
          signal: controller,
        });

        if (!response.ok) {
          const body = (await response.text()).slice(0, 240);
          const retriable = response.status === 429 || response.status >= 500;
          if (retriable && attempt <= config.maxRetries + 1) {
            await delay(150 * attempt);
            continue;
          }
          throw new OpenLibraryError(
            `Open Library request failed with ${response.status}${body ? `: ${body}` : ''}`,
            response.status,
            retriable
          );
        }

        const payload = (await response.json()) as T;
        cache.set(cacheKey, {
          expiresAt: Date.now() + cacheTtlMs,
          payload,
        });
        return payload;
      } catch (error) {
        if (
          attempt <= config.maxRetries + 1 &&
          shouldRetryOpenLibraryError(error)
        ) {
          await delay(150 * attempt);
          continue;
        }

        if (error instanceof OpenLibraryError) {
          throw error;
        }

        throw new OpenLibraryError(
          error instanceof Error ? error.message : 'Open Library request failed',
          undefined,
          shouldRetryOpenLibraryError(error)
        );
      }
    }

    throw new OpenLibraryError('Open Library request failed after retries');
  }

  async function searchBooks(input: OpenLibrarySearchBooksInput): Promise<OpenLibrarySearchBooksResult> {
    const limit = clampLimit(input.limit ?? 5);
    const params = new URLSearchParams();

    const q = normalizeOptionalString(input.q);
    const title = normalizeOptionalString(input.title);
    const author = normalizeOptionalString(input.author);
    const subject = normalizeOptionalString(input.subject);
    const isbn = normalizeOptionalString(input.isbn);

    if (q) params.set('q', q);
    if (title) params.set('title', title);
    if (author) params.set('author', author);
    if (subject) params.set('subject', subject);
    if (isbn) params.set('isbn', normalizeIsbn(isbn));
    params.set('limit', String(limit));

    if ([q, title, author, subject, isbn].every((value) => !value)) {
      throw new OpenLibraryError('Search requires at least one query field.');
    }

    const payload = await fetchJson<{ numFound?: number; docs?: OpenLibrarySearchDoc[] }>('/search.json', params);
    const normalizedResults = (payload.docs ?? []).slice(0, limit).map((doc) =>
      normalizeOpenLibraryBook(doc, {
        reason: buildSearchReason({ q, title, author, subject, isbn, doc }),
      })
    );

    return {
      query: q ?? [title, author, subject, isbn].filter(Boolean).join(' ').trim(),
      totalFound: Number(payload.numFound ?? normalizedResults.length),
      results: normalizedResults,
    };
  }

  async function getSubjectBooks(input: OpenLibrarySubjectBooksInput): Promise<OpenLibrarySubjectBooksResult> {
    const limit = clampLimit(input.limit ?? 8);
    const subject = input.subject.trim();
    const normalizedSubject = normalizeSubjectForLookup(subject);
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (input.ebooks) params.set('ebooks', 'true');
    if (input.details) params.set('details', 'true');
    if (normalizeOptionalString(input.publishedIn)) params.set('published_in', normalizeOptionalString(input.publishedIn)!);

    const payload = await fetchJson<OpenLibrarySubjectResponse>(`/subjects/${normalizedSubject}.json`, params);
    return {
      subject,
      normalizedSubject,
      results: (payload.works ?? []).slice(0, limit).map((work) =>
        normalizeOpenLibraryBook(work, {
          reason: `Useful for ${subject} reading or textbook discovery.`,
        })
      ),
    };
  }

  async function getBookDetails(input: OpenLibraryBookDetailsInput): Promise<OpenLibraryBookDetailsResult> {
    if (normalizeOptionalString(input.isbn)) {
      const searchResult = await searchBooks({ isbn: input.isbn, limit: 1 });
      if (!searchResult.results.length) {
        return { book: null, source: 'isbn' };
      }
      const match = searchResult.results[0];
      return getBookDetails({
        editionKey: match.openLibraryEditionKey,
        workKey: match.openLibraryWorkKey,
      }).then((result) => ({
        ...result,
        source: 'isbn',
      }));
    }

    const editionKey = normalizeEditionKey(input.editionKey ?? input.olid);
    const workKey = normalizeWorkKey(input.workKey);

    if (editionKey) {
      const edition = await fetchJson<OpenLibraryEditionRecord>(`/books/${editionKey}.json`);
      const linkedWorkKey = normalizeWorkKey(edition.works?.[0]?.key);
      const work = linkedWorkKey
        ? await fetchJson<OpenLibraryWorkRecord>(`${linkedWorkKey}.json`).catch((error) => {
            if (error instanceof OpenLibraryError && error.status === 404) {
              return null;
            }

            throw error;
          })
        : null;
      const authorNames = await resolveAuthorNames(fetchJson, [
        ...(Array.isArray(edition.authors) ? edition.authors : []),
        ...(Array.isArray(work?.authors) ? work!.authors : []),
      ]);

      return {
        source: 'edition',
        book: normalizeOpenLibraryBook(
          {
            ...work,
            ...edition,
            title: edition.title ?? work?.title,
            authors: authorNames.length ? authorNames : undefined,
            author_name: authorNames.length ? authorNames : undefined,
            openLibraryWorkKey: work?.key ?? linkedWorkKey,
            openLibraryEditionKey: edition.key ?? editionKey,
            edition_count: work?.edition_count ?? edition.edition_count,
            first_publish_year: work?.first_publish_date,
            subject: uniqueStrings([
              ...(Array.isArray(work?.subjects) ? work!.subjects : []),
              ...(Array.isArray(edition.subjects) ? edition.subjects : []),
            ]),
            ia: uniqueStrings([
              ...(Array.isArray(edition.ia) ? edition.ia : []),
              ...(edition.ocaid ? [edition.ocaid] : []),
            ]),
          },
          {
            reason: 'Detailed book metadata from Open Library.',
          }
        ),
      };
    }

    if (workKey) {
      const work = await fetchJson<OpenLibraryWorkRecord>(`${workKey}.json`);
      const authorNames = await resolveAuthorNames(fetchJson, Array.isArray(work.authors) ? work.authors : []);
      return {
        source: 'work',
        book: normalizeOpenLibraryBook(
          {
            ...work,
            author_name: authorNames,
            openLibraryWorkKey: work.key ?? workKey,
          },
          {
            reason: 'Detailed work metadata from Open Library.',
          }
        ),
      };
    }

    throw new OpenLibraryError('Book details require a work key, edition key, OLID, or ISBN.');
  }

  async function searchInsideBook(input: OpenLibrarySearchInsideInput): Promise<OpenLibrarySearchInsideResult> {
    if (!config.enableSearchInside) {
      return {
        enabled: false,
        supported: false,
        message:
          'Search inside is disabled. Open Library marks this API as experimental, so StudyClaw keeps it off unless OPENLIBRARY_ENABLE_SEARCH_INSIDE=true.',
        url: null,
      };
    }

    const bookId = normalizeOptionalString(input.bookId);
    if (!bookId) {
      return {
        enabled: true,
        supported: false,
        message:
          'Search inside needs an Internet Archive identifier from Open Library details. Ask for book details first, then retry with that archive ID.',
        url: null,
      };
    }

    const host = normalizeOptionalString(input.host) ?? 'archive.org';
    const doc = normalizeOptionalString(input.doc) ?? bookId;
    const path = normalizeOptionalString(input.path);
    const url = new URL(`https://${host.replace(/^https?:\/\//, '').replace(/\/$/, '')}/fulltext/inside.php`);
    url.searchParams.set('item_id', bookId);
    url.searchParams.set('doc', doc);
    if (path) {
      url.searchParams.set('path', path);
    }
    url.searchParams.set('q', input.q.trim());

    return {
      enabled: true,
      supported: true,
      message:
        'Search inside uses Open Library’s experimental Internet Archive endpoint. Results may vary by book and not all titles support it.',
      url: url.toString(),
    };
  }

  return {
    config,
    searchBooks,
    getSubjectBooks,
    getBookDetails,
    searchInsideBook,
  };
}

export const openLibraryClient = createOpenLibraryClient();

export async function openLibrarySearchBooks(input: OpenLibrarySearchBooksInput) {
  return openLibraryClient.searchBooks(input);
}

export async function openLibraryGetSubjectBooks(input: OpenLibrarySubjectBooksInput) {
  return openLibraryClient.getSubjectBooks(input);
}

export async function openLibraryGetBookDetails(input: OpenLibraryBookDetailsInput) {
  return openLibraryClient.getBookDetails(input);
}

export async function openLibrarySearchInsideBook(input: OpenLibrarySearchInsideInput) {
  return openLibraryClient.searchInsideBook(input);
}

function normalizeCoverSize(size: OpenLibraryCoverInput['size']) {
  const normalized = normalizeOptionalString(size ?? undefined)?.toUpperCase();
  return normalized === 'S' || normalized === 'L' ? normalized : 'M';
}

function buildCoverMetadata(input: { coverId?: number | null; olid?: string | null; isbn?: string | null }): NormalizedCover | null {
  const small = buildOpenLibraryCoverUrl({
    coverId: input.coverId,
    olid: input.olid,
    isbn: input.isbn,
    size: 'S',
  });
  const medium = buildOpenLibraryCoverUrl({
    coverId: input.coverId,
    olid: input.olid,
    isbn: input.isbn,
    size: 'M',
  });
  const large = buildOpenLibraryCoverUrl({
    coverId: input.coverId,
    olid: input.olid,
    isbn: input.isbn,
    size: 'L',
  });

  if (!small || !medium || !large) {
    return null;
  }

  return {
    id: input.coverId ?? null,
    preferredUrl: medium,
    urls: {
      small,
      medium,
      large,
    },
  };
}

function buildApiUrl(baseUrl: string, pathname: string, query?: URLSearchParams) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const url = new URL(`${baseUrl.replace(/\/$/, '')}${normalizedPath}`);
  if (query) {
    url.search = query.toString();
  }
  return url;
}

function clampLimit(limit: number) {
  return Math.min(20, Math.max(1, Math.trunc(limit || 5)));
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeDescription(value: unknown) {
  if (typeof value === 'string') {
    return value.trim() || null;
  }

  if (value && typeof value === 'object' && typeof (value as { value?: unknown }).value === 'string') {
    const nextValue = String((value as { value: string }).value).trim();
    return nextValue || null;
  }

  return null;
}

function normalizeEditionKey(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/OL\d+M/i);
  return match ? match[0].toUpperCase() : null;
}

function normalizeWorkKey(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('/works/')) {
    return trimmed;
  }

  const match = trimmed.match(/OL\d+W/i);
  return match ? `/works/${match[0].toUpperCase()}` : null;
}

function normalizeIsbn(value: string) {
  return value.replace(/[^0-9Xx]/g, '').toUpperCase();
}

function normalizeAuthors(record: Record<string, any>) {
  const byStatement = normalizeOptionalString(record.by_statement);
  const directAuthors = uniqueStrings([
    ...(Array.isArray(record.author_name) ? record.author_name : []),
    ...(Array.isArray(record.authors) ? record.authors.map(extractAuthorName).filter(Boolean) : []),
    ...(byStatement ? byStatement.split(/,| and /gi).map((entry) => entry.trim()) : []),
  ]);

  return directAuthors;
}

function extractAuthorName(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object') {
    const candidate =
      (value as { name?: unknown }).name ??
      (value as { author?: { name?: unknown } }).author?.name;

    return typeof candidate === 'string' ? candidate : null;
  }

  return null;
}

function normalizeLanguages(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueStrings(
    value.map((entry) => {
      if (typeof entry === 'string') {
        return entry.replace(/^\/languages\//, '').trim();
      }

      if (entry && typeof entry === 'object') {
        const key = (entry as { key?: unknown }).key;
        if (typeof key === 'string') {
          return key.replace(/^\/languages\//, '').trim();
        }
      }

      return null;
    })
  );
}

function coerceNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function coerceYear(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string') {
    const match = value.match(/\b(1[0-9]{3}|20[0-9]{2}|2100)\b/);
    return match ? Number.parseInt(match[1], 10) : null;
  }

  return null;
}

function uniqueStrings(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === 'string' ? value.trim() : null))
        .filter((value): value is string => Boolean(value))
    )
  );
}

function normalizeEbookAccess(record: Record<string, any>): NormalizedBook['ebookAccess'] {
  const raw = normalizeOptionalString(record.ebook_access ?? record.availability?.status)?.toLowerCase();
  if (!raw) {
    return record.has_fulltext || record.public_scan ? 'preview' : 'none';
  }

  if (raw.includes('full') || raw.includes('public')) {
    return 'full';
  }
  if (raw.includes('borrow') || raw.includes('loan')) {
    return 'borrow';
  }
  if (raw.includes('preview') || raw.includes('printdisabled') || raw.includes('readable')) {
    return 'preview';
  }
  return 'none';
}

function deriveReason(record: Record<string, any>, ebookAccess: NormalizedBook['ebookAccess']) {
  if (ebookAccess === 'full') {
    return 'Open Library marks this title as fully readable online.';
  }
  if (ebookAccess === 'borrow') {
    return 'Open Library shows this title as borrowable.';
  }

  const subjects = uniqueStrings([
    ...(Array.isArray(record.subject) ? record.subject : []),
    ...(Array.isArray(record.subjects) ? record.subjects : []),
  ]);
  if (subjects.length) {
    return `Relevant subjects include ${subjects.slice(0, 3).join(', ')}.`;
  }

  return null;
}

function buildSearchReason(input: {
  q: string | null;
  title: string | null;
  author: string | null;
  subject: string | null;
  isbn: string | null;
  doc: OpenLibrarySearchDoc;
}) {
  const reasons: string[] = [];
  if (input.isbn) {
    reasons.push('Matched the requested ISBN.');
  }
  if (input.title && String(input.doc.title ?? '').toLowerCase().includes(input.title.toLowerCase())) {
    reasons.push('Title closely matches the request.');
  }
  if (input.author && Array.isArray(input.doc.author_name)) {
    const hasAuthorMatch = input.doc.author_name.some((author: unknown) =>
      typeof author === 'string' && author.toLowerCase().includes(input.author!.toLowerCase())
    );
    if (hasAuthorMatch) {
      reasons.push('Author match found.');
    }
  }
  if (input.subject) {
    reasons.push(`Useful for ${input.subject}.`);
  }
  if (!reasons.length && input.q) {
    reasons.push(`Best match for "${input.q}".`);
  }
  return reasons.join(' ');
}

async function resolveAuthorNames(
  fetchJson: (pathname: string, query?: URLSearchParams, cacheTtlMs?: number) => Promise<Record<string, any>>,
  authorRefs: unknown[]
) {
  const keys = uniqueStrings(
    authorRefs.map((entry) => {
      if (entry && typeof entry === 'object') {
        const directKey = (entry as { key?: unknown }).key;
        if (typeof directKey === 'string') {
          return directKey;
        }

        const authorKey = (entry as { author?: { key?: unknown } }).author?.key;
        if (typeof authorKey === 'string') {
          return authorKey;
        }
      }

      return null;
    })
  ).slice(0, 3);

  if (!keys.length) {
    return [];
  }

  const names = await Promise.all(
    keys.map(async (key) => {
      try {
        const payload = await fetchJson(`${key}.json`);
        return normalizeOptionalString(payload.name);
      } catch {
        return null;
      }
    })
  );

  return uniqueStrings(names);
}

function shouldRetryOpenLibraryError(error: unknown) {
  if (error instanceof OpenLibraryError) {
    return error.retriable;
  }

  if (error instanceof Error) {
    return error.name === 'TimeoutError' || /fetch failed|network|timed out|abort/i.test(error.message);
  }

  return false;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
