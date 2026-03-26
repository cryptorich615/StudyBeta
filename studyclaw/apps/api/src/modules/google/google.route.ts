import { Router } from 'express';
import { db } from '../../lib/db';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { 
  getGoogleConnectionStatus, 
  listUpcomingCalendarEvents, 
  listRecentDriveFiles 
} from '../../lib/google-service';

export const googleRouter = Router();
googleRouter.use(requireAuth);

// GET / - returns connection status
googleRouter.get('/', async (req: AuthedRequest, res) => {
  try {
    const status = await getGoogleConnectionStatus(req.user!.id);
    res.json({
      connected: status.connected,
      account: status.googleEmail,
      gogInstalled: true,
    });
  } catch (error) {
    res.status(500).json({ error: 'server_error', message: 'Failed to check Google connection' });
  }
});

// GET /calendar - returns calendar events
googleRouter.get('/calendar', async (req: AuthedRequest, res) => {
  try {
    const status = await getGoogleConnectionStatus(req.user!.id);
    if (!status.connected) {
      return res.status(400).json({ error: 'not_connected', message: 'Google account not connected. Go to /api/auth/google to connect.' });
    }
    
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 90);
    const events = await listUpcomingCalendarEvents(req.user!.id, days * 10); // rough max per day
    res.json(events);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch calendar events';
    if (msg.includes('not connected') || msg.includes('401') || msg.includes('403')) {
      return res.status(400).json({ connected: false, error: msg });
    }
    res.status(500).json({ error: 'fetch_error', message: msg });
  }
});

// GET /gmail - returns Gmail messages
googleRouter.get('/gmail', async (req: AuthedRequest, res) => {
  try {
    const status = await getGoogleConnectionStatus(req.user!.id);
    if (!status.connected) {
      return res.status(400).json({ error: 'not_connected', message: 'Google account not connected' });
    }
    
    const max = Math.min(Math.max(parseInt(req.query.max as string) || 10, 1), 50);
    const q = (req.query.q as string) || 'is:unread';
    
    // Fetch message list
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${max}`,
      { headers: { Authorization: `Bearer ${await getAccessToken(req.user!.id)}` } }
    );
    
    if (!listRes.ok) {
      if (listRes.status === 401) {
        return res.status(400).json({ connected: false, error: 'Token expired or not authorized' });
      }
      throw new Error(`Gmail API error: ${listRes.status}`);
    }
    
    const listData = await listRes.json() as { messages?: Array<{ id: string }> };
    const messages = listData.messages ?? [];
    
    // Fetch metadata for each message
    const results = await Promise.all(
      messages.slice(0, max).map(async (msg) => {
        const detailRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=subject,from,date`,
          { headers: { Authorization: `Bearer ${await getAccessToken(req.user!.id)}` } }
        );
        if (!detailRes.ok) return null;
        const detail = await detailRes.json() as { payload?: { headers?: Array<{ name: string; value: string }> }; snippet?: string; id: string };
        const headers = detail.payload?.headers ?? [];
        return {
          id: detail.id,
          subject: headers.find(h => h.name === 'Subject')?.value ?? '',
          from: headers.find(h => h.name === 'From')?.value ?? '',
          date: headers.find(h => h.name === 'Date')?.value ?? '',
          snippet: detail.snippet ?? '',
        };
      })
    );
    
    res.json(results.filter(Boolean));
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch Gmail messages';
    res.status(500).json({ error: 'fetch_error', message: msg });
  }
});

// GET /drive - returns Drive files
googleRouter.get('/drive', async (req: AuthedRequest, res) => {
  try {
    const status = await getGoogleConnectionStatus(req.user!.id);
    if (!status.connected) {
      return res.status(400).json({ error: 'not_connected', message: 'Google account not connected' });
    }
    
    const max = Math.min(Math.max(parseInt(req.query.max as string) || 5, 1), 100);
    const files = await listRecentDriveFiles(req.user!.id, max);
    res.json(files);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch Drive files';
    res.status(500).json({ error: 'fetch_error', message: msg });
  }
});

// Helper to get access token (re-exported for internal use)
async function getAccessToken(userId: string) {
  const { getAccessToken: getToken } = await import('../../lib/google-service.js');
  const token = await getToken(userId);
  if (!token) {
    throw new Error('Google account not connected');
  }
  return token;
}
