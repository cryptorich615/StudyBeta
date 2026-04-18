import { Router } from 'express';
import { db } from '../../lib/db';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { ensurePlatformSchema } from '../../lib/platform-schema';

type EventType = 'class' | 'assignment' | 'exam' | 'personal';

const VALID_EVENT_TYPES = new Set<EventType>(['class', 'assignment', 'exam', 'personal']);

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

function normalizeText(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeEventType(value: unknown): EventType {
  if (typeof value !== 'string') {
    return 'personal';
  }
  const normalized = value.trim().toLowerCase() as EventType;
  return VALID_EVENT_TYPES.has(normalized) ? normalized : 'personal';
}

function parseDateInput(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date`);
  }

  return date.toISOString();
}

function parseOptionalDateInput(value: unknown, fieldName: string) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return parseDateInput(value, fieldName);
}

function normalizeMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function mapEventRow(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    startsAt: row.start_time,
    endsAt: row.end_time ?? null,
    eventType: row.event_type,
    metadata: row.metadata_json ?? {},
    source: 'studyclaw' as const,
    htmlLink: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

eventsRouter.get('/', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const result = await db.query(
    `select *
     from studyclaw_events
     where user_id = $1
     order by start_time asc, created_at asc`,
    [req.user!.id]
  );

  res.json({ events: result.rows.map(mapEventRow) });
});

eventsRouter.post('/', async (req: AuthedRequest, res) => {
  try {
    await ensurePlatformSchema();
    const title = normalizeText(req.body?.title);
    if (!title) {
      return res.status(400).json({ error: 'bad_request', message: 'title is required' });
    }

    const startsAt = parseDateInput(req.body?.startsAt ?? req.body?.start_time, 'startsAt');
    const endsAt = parseOptionalDateInput(req.body?.endsAt ?? req.body?.end_time, 'endsAt');
    if (endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
      return res.status(400).json({ error: 'bad_request', message: 'endsAt must be after startsAt' });
    }

    const result = await db.query(
      `insert into studyclaw_events (
         user_id, title, description, start_time, end_time, event_type, metadata_json
       )
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [
        req.user!.id,
        title,
        normalizeText(req.body?.description),
        startsAt,
        endsAt,
        normalizeEventType(req.body?.eventType ?? req.body?.event_type),
        JSON.stringify(normalizeMetadata(req.body?.metadata ?? req.body?.metadata_json)),
      ]
    );

    res.status(201).json(mapEventRow(result.rows[0]));
  } catch (error) {
    res.status(400).json({ error: 'bad_request', message: error instanceof Error ? error.message : 'Failed to create event' });
  }
});

eventsRouter.patch('/:eventId', async (req: AuthedRequest, res) => {
  try {
    await ensurePlatformSchema();

    const existing = await db.query(
      `select *
       from studyclaw_events
       where id = $1 and user_id = $2
       limit 1`,
      [req.params.eventId, req.user!.id]
    );

    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'not_found', message: 'Event not found' });
    }

    const current = existing.rows[0];
    const title = normalizeText(req.body?.title) ?? current.title;
    const description =
      req.body && Object.prototype.hasOwnProperty.call(req.body, 'description')
        ? normalizeText(req.body.description)
        : current.description;
    const startsAt =
      req.body && (Object.prototype.hasOwnProperty.call(req.body, 'startsAt') || Object.prototype.hasOwnProperty.call(req.body, 'start_time'))
        ? parseDateInput(req.body?.startsAt ?? req.body?.start_time, 'startsAt')
        : current.start_time;
    const endsAt =
      req.body && (Object.prototype.hasOwnProperty.call(req.body, 'endsAt') || Object.prototype.hasOwnProperty.call(req.body, 'end_time'))
        ? parseOptionalDateInput(req.body?.endsAt ?? req.body?.end_time, 'endsAt')
        : current.end_time;

    if (endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
      return res.status(400).json({ error: 'bad_request', message: 'endsAt must be after startsAt' });
    }

    const metadata =
      req.body && (Object.prototype.hasOwnProperty.call(req.body, 'metadata') || Object.prototype.hasOwnProperty.call(req.body, 'metadata_json'))
        ? normalizeMetadata(req.body?.metadata ?? req.body?.metadata_json)
        : current.metadata_json ?? {};

    const result = await db.query(
      `update studyclaw_events
       set
         title = $3,
         description = $4,
         start_time = $5,
         end_time = $6,
         event_type = $7,
         metadata_json = $8,
         updated_at = now()
       where id = $1 and user_id = $2
       returning *`,
      [
        req.params.eventId,
        req.user!.id,
        title,
        description,
        startsAt,
        endsAt,
        normalizeEventType(req.body?.eventType ?? req.body?.event_type ?? current.event_type),
        JSON.stringify(metadata),
      ]
    );

    res.json(mapEventRow(result.rows[0]));
  } catch (error) {
    res.status(400).json({ error: 'bad_request', message: error instanceof Error ? error.message : 'Failed to update event' });
  }
});

eventsRouter.delete('/:eventId', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const result = await db.query(
    `delete from studyclaw_events
     where id = $1 and user_id = $2
     returning id`,
    [req.params.eventId, req.user!.id]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'not_found', message: 'Event not found' });
  }

  res.json({ ok: true });
});
