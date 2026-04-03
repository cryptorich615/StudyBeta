import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { ensurePlatformSchema } from '../../lib/platform-schema';
import {
  buildScheduleContext,
  createScheduleEntry,
  deleteScheduleEntry,
  getScheduleSnapshot,
  updateScheduleEntry,
} from '../../lib/class-scheduler';

export const scheduleRouter = Router();
scheduleRouter.use(requireAuth);

function requireParam(value: string | string[] | undefined, name: string) {
  const resolved = Array.isArray(value) ? value[0] : value;
  if (!resolved) {
    throw new Error(`Missing route param: ${name}`);
  }
  return resolved;
}

scheduleRouter.get('/', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const timezone = typeof req.query?.timezone === 'string' ? req.query.timezone : null;
  const snapshot = await getScheduleSnapshot(req.user!.id, { timezone });
  const enriched = await buildScheduleContext(req.user!.id, {
    timezone,
    query: typeof req.query?.query === 'string' ? req.query.query : null,
  });

  res.json({
    entries: snapshot.entries,
    currentContext: snapshot.context,
    contextLines: {
      line: enriched.line,
      todayLine: enriched.todayLine,
      detailLine: enriched.detailLine,
    },
  });
});

scheduleRouter.post('/entries', async (req: AuthedRequest, res) => {
  try {
    const entry = await createScheduleEntry(req.user!.id, req.body);
    const snapshot = await getScheduleSnapshot(req.user!.id);
    res.status(201).json({ entry, currentContext: snapshot.context });
  } catch (error) {
    res.status(400).json({
      error: 'schedule_entry_failed',
      message: error instanceof Error ? error.message : 'Failed to create schedule entry',
    });
  }
});

scheduleRouter.patch('/entries/:entryId', async (req: AuthedRequest, res) => {
  try {
    const entry = await updateScheduleEntry(req.user!.id, requireParam(req.params.entryId, 'entryId'), req.body);
    const snapshot = await getScheduleSnapshot(req.user!.id);
    res.json({ entry, currentContext: snapshot.context });
  } catch (error) {
    res.status(400).json({
      error: 'schedule_entry_failed',
      message: error instanceof Error ? error.message : 'Failed to update schedule entry',
    });
  }
});

scheduleRouter.delete('/entries/:entryId', async (req: AuthedRequest, res) => {
  try {
    await deleteScheduleEntry(req.user!.id, requireParam(req.params.entryId, 'entryId'));
    const snapshot = await getScheduleSnapshot(req.user!.id);
    res.json({ ok: true, currentContext: snapshot.context });
  } catch (error) {
    res.status(404).json({
      error: 'schedule_entry_failed',
      message: error instanceof Error ? error.message : 'Failed to delete schedule entry',
    });
  }
});
