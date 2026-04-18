import { Router } from 'express';
import { db } from '../../lib/db';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { ensurePlatformSchema } from '../../lib/platform-schema';

type FileType = 'doc' | 'spreadsheet' | 'note';

const VALID_FILE_TYPES = new Set<FileType>(['doc', 'spreadsheet', 'note']);

export const filesRouter = Router();
filesRouter.use(requireAuth);

function normalizeText(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeFileType(value: unknown): FileType {
  if (typeof value !== 'string') {
    return 'note';
  }

  const normalized = value.trim().toLowerCase() as FileType;
  return VALID_FILE_TYPES.has(normalized) ? normalized : 'note';
}

function mapFileRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    fileType: row.file_type,
    content: row.content ?? '',
    metadata: row.metadata_json ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: 'studyclaw' as const,
  };
}

filesRouter.get('/', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const result = await db.query(
    `select *
     from studyclaw_files
     where user_id = $1
     order by updated_at desc, created_at desc`,
    [req.user!.id]
  );

  res.json({ files: result.rows.map(mapFileRow) });
});

filesRouter.post('/', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const name = normalizeText(req.body?.name);
  if (!name) {
    return res.status(400).json({ error: 'bad_request', message: 'name is required' });
  }

  const result = await db.query(
    `insert into studyclaw_files (
       user_id, name, file_type, content, metadata_json
     )
     values ($1, $2, $3, $4, $5)
     returning *`,
    [
      req.user!.id,
      name,
      normalizeFileType(req.body?.fileType ?? req.body?.file_type),
      typeof req.body?.content === 'string' ? req.body.content : '',
      JSON.stringify(normalizeMetadata(req.body?.metadata ?? req.body?.metadata_json)),
    ]
  );

  res.status(201).json(mapFileRow(result.rows[0]));
});

filesRouter.patch('/:fileId', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const existing = await db.query(
    `select *
     from studyclaw_files
     where id = $1 and user_id = $2
     limit 1`,
    [req.params.fileId, req.user!.id]
  );

  if (!existing.rows[0]) {
    return res.status(404).json({ error: 'not_found', message: 'File not found' });
  }

  const current = existing.rows[0];
  const result = await db.query(
    `update studyclaw_files
     set
       name = $3,
       file_type = $4,
       content = $5,
       metadata_json = $6,
       updated_at = now()
     where id = $1 and user_id = $2
     returning *`,
    [
      req.params.fileId,
      req.user!.id,
      normalizeText(req.body?.name) ?? current.name,
      normalizeFileType(req.body?.fileType ?? req.body?.file_type ?? current.file_type),
      typeof req.body?.content === 'string' ? req.body.content : current.content,
      JSON.stringify(
        req.body && (Object.prototype.hasOwnProperty.call(req.body, 'metadata') || Object.prototype.hasOwnProperty.call(req.body, 'metadata_json'))
          ? normalizeMetadata(req.body?.metadata ?? req.body?.metadata_json)
          : (current.metadata_json ?? {})
      ),
    ]
  );

  res.json(mapFileRow(result.rows[0]));
});

filesRouter.delete('/:fileId', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const result = await db.query(
    `delete from studyclaw_files
     where id = $1 and user_id = $2
     returning id`,
    [req.params.fileId, req.user!.id]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'not_found', message: 'File not found' });
  }

  res.json({ ok: true });
});
