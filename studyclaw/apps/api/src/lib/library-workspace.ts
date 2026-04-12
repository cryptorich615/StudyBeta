import { db } from './db';

export type SavedLibraryBook = {
  key?: string;
  title: string;
  author_name?: string[];
  cover_i?: string | number;
  ia?: string[];
  gb_id?: string;
  first_publish_year?: number;
  subtitle?: string | null;
  ebookAccess?: 'full' | 'borrow' | 'preview' | 'none';
  description?: string | null;
  openLibraryUrl?: string | null;
  savedAt?: string;
  lastOpenedAt?: string | null;
};

export type ContinueReadingItem = {
  kind: 'asset' | 'book';
  id: string;
  title: string;
  progressPercent: number;
  lastOpenedAt: string | null;
  href: string;
  detail: string;
};

function normalizeAuthorNames(input: unknown) {
  return Array.isArray(input)
    ? input.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
}

export function buildLibraryBookKey(book: Pick<SavedLibraryBook, 'key' | 'gb_id' | 'openLibraryUrl' | 'title'>) {
  return String(book.key || book.gb_id || book.openLibraryUrl || book.title).trim();
}

function normalizeSavedLibraryBook(payload: Record<string, unknown>, timestamps: { createdAt?: string | null; lastOpenedAt?: string | null }) {
  const normalized: SavedLibraryBook = {
    key: typeof payload.key === 'string' && payload.key.trim() ? payload.key.trim() : undefined,
    title: String(payload.title ?? '').trim(),
    author_name: normalizeAuthorNames(payload.author_name),
    cover_i: typeof payload.cover_i === 'string' || typeof payload.cover_i === 'number' ? payload.cover_i : undefined,
    ia: Array.isArray(payload.ia) ? payload.ia.map((value) => String(value ?? '').trim()).filter(Boolean) : undefined,
    gb_id: typeof payload.gb_id === 'string' && payload.gb_id.trim() ? payload.gb_id.trim() : undefined,
    first_publish_year:
      typeof payload.first_publish_year === 'number'
        ? payload.first_publish_year
        : typeof payload.first_publish_year === 'string' && payload.first_publish_year.trim()
          ? Number(payload.first_publish_year)
          : undefined,
    subtitle: typeof payload.subtitle === 'string' ? payload.subtitle : null,
    ebookAccess:
      payload.ebookAccess === 'full' || payload.ebookAccess === 'borrow' || payload.ebookAccess === 'preview' || payload.ebookAccess === 'none'
        ? payload.ebookAccess
        : undefined,
    description: typeof payload.description === 'string' ? payload.description : null,
    openLibraryUrl: typeof payload.openLibraryUrl === 'string' ? payload.openLibraryUrl : null,
    savedAt: typeof payload.savedAt === 'string' && payload.savedAt.trim() ? payload.savedAt : timestamps.createdAt ?? new Date().toISOString(),
    lastOpenedAt: timestamps.lastOpenedAt ?? (typeof payload.lastOpenedAt === 'string' ? payload.lastOpenedAt : null),
  };

  if (!normalized.title) {
    throw new Error('Saved book title is required');
  }

  return normalized;
}

export async function listSavedLibraryBooks(userId: string) {
  const result = await db.query(
    `select library_key, payload_json, created_at, last_opened_at
     from study_library_books
     where user_id = $1
     order by last_opened_at desc, created_at desc`,
    [userId]
  );

  return result.rows.map((row) =>
    normalizeSavedLibraryBook(row.payload_json ?? {}, {
      createdAt: row.created_at ?? null,
      lastOpenedAt: row.last_opened_at ?? null,
    })
  );
}

export async function upsertSavedLibraryBook(userId: string, input: SavedLibraryBook) {
  const normalized = normalizeSavedLibraryBook(input as Record<string, unknown>, {
    createdAt: input.savedAt ?? null,
    lastOpenedAt: input.lastOpenedAt ?? null,
  });
  const libraryKey = buildLibraryBookKey(normalized);

  if (!libraryKey) {
    throw new Error('Saved book key is required');
  }

  const payload = {
    ...normalized,
    savedAt: normalized.savedAt ?? new Date().toISOString(),
  };

  const result = await db.query(
    `insert into study_library_books (user_id, library_key, payload_json, last_opened_at)
     values ($1, $2, $3::jsonb, coalesce($4::timestamptz, now()))
     on conflict (user_id, library_key) do update set
       payload_json = excluded.payload_json,
       last_opened_at = coalesce(excluded.last_opened_at, study_library_books.last_opened_at),
       updated_at = now()
     returning payload_json, created_at, last_opened_at`,
    [userId, libraryKey, JSON.stringify(payload), normalized.lastOpenedAt]
  );

  const row = result.rows[0];
  return normalizeSavedLibraryBook(row.payload_json ?? {}, {
    createdAt: row.created_at ?? null,
    lastOpenedAt: row.last_opened_at ?? null,
  });
}

export async function markSavedLibraryBookOpened(userId: string, libraryKey: string) {
  const result = await db.query(
    `update study_library_books
     set last_opened_at = now(),
         updated_at = now()
     where user_id = $1
       and library_key = $2
     returning payload_json, created_at, last_opened_at`,
    [userId, libraryKey]
  );

  if (!result.rows[0]) {
    return null;
  }

  const row = result.rows[0];
  return normalizeSavedLibraryBook(row.payload_json ?? {}, {
    createdAt: row.created_at ?? null,
    lastOpenedAt: row.last_opened_at ?? null,
  });
}

export async function deleteSavedLibraryBook(userId: string, libraryKey: string) {
  const result = await db.query(
    `delete from study_library_books
     where user_id = $1
       and library_key = $2
     returning library_key`,
    [userId, libraryKey]
  );

  return Boolean(result.rows[0]);
}

export async function listContinueReadingItems(userId: string, limit = 6): Promise<ContinueReadingItem[]> {
  const [assetResult, bookResult] = await Promise.all([
    db.query(
      `select sa.id,
              sa.title,
              coalesce(rs.progress_percent, 0) as progress_percent,
              rs.last_opened_at
       from study_assets sa
       join study_asset_reader_state rs
         on rs.asset_id = sa.id
        and rs.user_id = sa.user_id
       where sa.user_id = $1
       order by rs.last_opened_at desc
       limit $2`,
      [userId, limit]
    ),
    db.query(
      `select library_key, payload_json, last_opened_at
       from study_library_books
       where user_id = $1
       order by last_opened_at desc
       limit $2`,
      [userId, limit]
    ),
  ]);

  const assets: ContinueReadingItem[] = assetResult.rows.map((row) => ({
    kind: 'asset',
    id: row.id,
    title: String(row.title ?? 'Untitled document'),
    progressPercent: Number(row.progress_percent ?? 0),
    lastOpenedAt: row.last_opened_at ?? null,
    href: `/study?doc=${row.id}`,
    detail: `${Math.round(Number(row.progress_percent ?? 0))}% read`,
  }));

  const books: ContinueReadingItem[] = bookResult.rows.map((row) => {
    const payload = normalizeSavedLibraryBook(row.payload_json ?? {}, {
      createdAt: null,
      lastOpenedAt: row.last_opened_at ?? null,
    });
    const key = encodeURIComponent(buildLibraryBookKey(payload));
    return {
      kind: 'book',
      id: buildLibraryBookKey(payload),
      title: payload.title,
      progressPercent: 0,
      lastOpenedAt: row.last_opened_at ?? null,
      href: `/study?book=${key}`,
      detail: payload.author_name?.[0] || 'Saved book',
    };
  });

  return [...assets, ...books]
    .sort((left, right) => String(right.lastOpenedAt ?? '').localeCompare(String(left.lastOpenedAt ?? '')))
    .slice(0, limit);
}
