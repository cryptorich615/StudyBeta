import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import {
  getGoogleConnectionStatus,
  listRecentGmailMessages,
  searchGmailMessages,
  sendGmailMessage,
  replyToGmailMessage,
  createGmailDraft,
  listGmailDrafts,
  sendGmailDraft,
} from '../../lib/google-service';

export const gmailRouter = Router();

gmailRouter.use(requireAuth);

// GET /api/gmail/messages — list recent emails
gmailRouter.get('/messages', async (req: AuthedRequest, res) => {
  const googleStatus = await getGoogleConnectionStatus(req.user!.id);
  if (!googleStatus.connected) {
    return res.status(400).json({ error: 'Google not connected. Please reconnect Google in Settings.' });
  }

  const maxResults = parseInt(req.query.limit as string) || 10;
  const messages = await listRecentGmailMessages(req.user!.id, maxResults).catch((err) => {
    console.error('Gmail fetch error:', err);
    return [];
  });

  res.json({ messages });
});

// GET /api/gmail/search?q=query&max=10 — search emails
gmailRouter.get('/search', async (req: AuthedRequest, res) => {
  const googleStatus = await getGoogleConnectionStatus(req.user!.id);
  if (!googleStatus.connected) {
    return res.status(400).json({ error: 'Google not connected.' });
  }

  const { q, max } = req.query as { q?: string; max?: string };
  if (!q) return res.status(400).json({ error: 'Missing query parameter: q' });

  const messages = await searchGmailMessages(req.user!.id, q, parseInt(max as string) || 10).catch((err) => {
    console.error('Gmail search error:', err);
    return [];
  });

  res.json({ messages });
});

// GET /api/gmail/drafts — list drafts
gmailRouter.get('/drafts', async (req: AuthedRequest, res) => {
  const googleStatus = await getGoogleConnectionStatus(req.user!.id);
  if (!googleStatus.connected) {
    return res.status(400).json({ error: 'Google not connected.' });
  }

  const drafts = await listGmailDrafts(req.user!.id).catch(() => []);
  res.json({ drafts });
});

// POST /api/gmail/send — send an email
gmailRouter.post('/send', async (req: AuthedRequest, res) => {
  const googleStatus = await getGoogleConnectionStatus(req.user!.id);
  if (!googleStatus.connected) {
    return res.status(400).json({ error: 'Google not connected. Please reconnect Google in Settings.' });
  }

  const { to, subject, body, threadId } = req.body as { to?: string; subject?: string; body?: string; threadId?: string };

  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(to)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    let result;
    if (threadId) {
      // Reply to existing thread
      result = await replyToGmailMessage(req.user!.id, threadId, to, subject, body);
    } else {
      result = await sendGmailMessage(req.user!.id, to, subject, body);
    }
    res.json({ ok: true, id: result.id, threadId: result.threadId });
  } catch (err: any) {
    console.error('Gmail send error:', err);
    res.status(500).json({ error: 'Failed to send email. ' + err.message });
  }
});

// POST /api/gmail/drafts — create a draft
gmailRouter.post('/drafts', async (req: AuthedRequest, res) => {
  const googleStatus = await getGoogleConnectionStatus(req.user!.id);
  if (!googleStatus.connected) {
    return res.status(400).json({ error: 'Google not connected.' });
  }

  const { to, subject, body } = req.body as { to?: string; subject?: string; body?: string };
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
  }

  try {
    const result = await createGmailDraft(req.user!.id, to, subject, body);
    res.json({ ok: true, id: result.id });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create draft. ' + err.message });
  }
});

// POST /api/gmail/drafts/:draftId/send — send a draft
gmailRouter.post('/drafts/:draftId/send', async (req: AuthedRequest, res) => {
  const googleStatus = await getGoogleConnectionStatus(req.user!.id);
  if (!googleStatus.connected) {
    return res.status(400).json({ error: 'Google not connected.' });
  }

  try {
    const result = await sendGmailDraft(req.user!.id, req.params.draftId);
    res.json({ ok: true, id: result.id, threadId: result.threadId });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to send draft. ' + err.message });
  }
});
