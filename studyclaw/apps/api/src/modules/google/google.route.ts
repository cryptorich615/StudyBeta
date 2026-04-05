import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { 
  buildGoogleAuthUrl,
  createCalendarEvent,
  disconnectGoogleIntegration,
  getGoogleConnectionStatus,
  getGoogleWorkspacePreview,
  listUpcomingCalendarEvents,
  listRecentDriveFiles,
  syncGoogleSkillForUser,
} from '../../lib/google-service';

export const googleRouter = Router();
googleRouter.use(requireAuth);

function sanitizeFrontendOrigin(value: string | undefined | null) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
}

function resolveFrontendOrigin(req: any) {
  const queryOrigin = sanitizeFrontendOrigin(
    typeof req.query?.frontendOrigin === 'string' ? req.query.frontendOrigin : undefined
  );
  if (queryOrigin) {
    return queryOrigin;
  }

  const originHeader = sanitizeFrontendOrigin(req.get?.('origin'));
  if (originHeader) {
    return originHeader;
  }

  const referer = req.get?.('referer');
  if (referer) {
    const refererOrigin = sanitizeFrontendOrigin(referer);
    if (refererOrigin) {
      return refererOrigin;
    }
  }

  const forwardedProto = req.get?.('x-forwarded-proto');
  const forwardedHost = req.get?.('x-forwarded-host');
  if (forwardedProto && forwardedHost) {
    const forwardedOrigin = sanitizeFrontendOrigin(`${forwardedProto}://${forwardedHost}`);
    if (forwardedOrigin) {
      return forwardedOrigin;
    }
  }

  const host = req.get?.('host');
  if (host) {
    const inferredOrigin = sanitizeFrontendOrigin(`${req.protocol}://${host}`);
    if (inferredOrigin) {
      return inferredOrigin;
    }
  }

  return sanitizeFrontendOrigin(process.env.CLIENT_URL || process.env.FRONTEND_URL) || 'http://localhost:3000';
}

googleRouter.get('/connect', async (req: AuthedRequest, res) => {
  const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/settings';
  const url = buildGoogleAuthUrl({
    purpose: 'connect',
    userId: req.user!.id,
    returnTo,
    frontendOrigin: resolveFrontendOrigin(req),
  });
  console.info('[google] starting oauth connect redirect', {
    userId: req.user!.id,
    returnTo,
  });

  res.redirect(url);
});

googleRouter.get('/connect-url', async (req: AuthedRequest, res) => {
  const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/settings';
  const url = buildGoogleAuthUrl({
    purpose: 'connect',
    userId: req.user!.id,
    returnTo,
    frontendOrigin: resolveFrontendOrigin(req),
  });
  console.info('[google] issued oauth connect url', {
    userId: req.user!.id,
    returnTo,
  });

  res.json({ url });
});

// GET / - returns connection status
googleRouter.get('/', async (req: AuthedRequest, res) => {
  try {
    const status = await getGoogleConnectionStatus(req.user!.id);
    console.info('[google] status requested', {
      userId: req.user!.id,
      status: status.status,
      canReadCalendar: status.canReadCalendar,
      canWriteCalendar: status.canWriteCalendar,
      canReadDrive: status.canReadDrive,
      canUseDocs: status.canUseDocs,
      canUseSheets: status.canUseSheets,
      canUseSlides: status.canUseSlides,
      hasRefreshToken: status.hasRefreshToken,
      error: status.error,
    });
    res.json({
      status: status.status,
      connected: status.connected,
      needsReconnect: status.needsReconnect,
      account: status.googleEmail,
      googleEmail: status.googleEmail,
      scopes: status.scopes,
      grantedScopes: status.grantedScopes,
      canReadCalendar: status.canReadCalendar,
      canWriteCalendar: status.canWriteCalendar,
      canReadDrive: status.canReadDrive,
      canUseDocs: status.canUseDocs,
      canUseSheets: status.canUseSheets,
      canUseSlides: status.canUseSlides,
      canUseWorkspaceSkill: status.canUseWorkspaceSkill,
      hasAccessToken: status.hasAccessToken,
      hasRefreshToken: status.hasRefreshToken,
      expiresAt: status.expiresAt,
      lastSyncAt: status.lastSyncAt,
      calendarsFound: null,
      error: status.error,
    });
  } catch (error) {
    console.error('[google] status request failed', {
      userId: req.user!.id,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({ error: 'server_error', message: 'Failed to check Google connection' });
  }
});

googleRouter.post('/disconnect', async (req: AuthedRequest, res) => {
  try {
    await disconnectGoogleIntegration(req.user!.id);
    res.json({
      ok: true,
      status: 'not_connected',
      connected: false,
    });
  } catch (error) {
    res.status(500).json({
      error: 'disconnect_failed',
      message: error instanceof Error ? error.message : 'Failed to disconnect Google',
    });
  }
});

// GET /calendar - returns calendar events
googleRouter.get('/calendar', async (req: AuthedRequest, res) => {
  try {
    const status = await getGoogleConnectionStatus(req.user!.id);
    if (!status.connected) {
      console.warn('[google] calendar fetch blocked by connection state', {
        userId: req.user!.id,
        status: status.status,
        error: status.error,
      });
      return res.status(400).json({
        connected: false,
        status: status.status,
        error: status.needsReconnect ? 'reconnect_required' : 'not_connected',
        message: status.needsReconnect
          ? 'Google Calendar needs to be reconnected before events can load.'
          : 'Google account not connected.',
      });
    }
    
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 90);
    console.info('[google] fetching calendar events', {
      userId: req.user!.id,
      days,
    });
    const events = await listUpcomingCalendarEvents(req.user!.id, days * 10, { windowDays: days }); // rough max per day
    console.info('[google] calendar events fetched', {
      userId: req.user!.id,
      count: events.length,
    });
    res.json(events);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch calendar events';
    console.error('[google] calendar fetch failed', {
      userId: req.user!.id,
      message: msg,
    });
    if (msg.includes('not connected') || msg.includes('401') || msg.includes('403')) {
      return res.status(400).json({ connected: false, error: msg });
    }
    res.status(500).json({ error: 'fetch_error', message: msg });
  }
});

googleRouter.post('/calendar/events', async (req: AuthedRequest, res) => {
  try {
    const { title, startsAt, endsAt, description, timeZone } = req.body as {
      title?: string;
      startsAt?: string;
      endsAt?: string;
      description?: string;
      timeZone?: string;
    };

    if (!title?.trim() || !startsAt?.trim()) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'title and startsAt are required',
      });
    }

    const event = await createCalendarEvent(req.user!.id, {
      title: title.trim(),
      startsAt: startsAt.trim(),
      endsAt: endsAt?.trim() || null,
      description: description?.trim() || null,
      timeZone: timeZone?.trim() || null,
    });
    await syncGoogleSkillForUser(req.user!.id).catch(() => undefined);

    res.status(201).json({
      id: event.id,
      title: event.summary ?? title.trim(),
      htmlLink: event.htmlLink ?? null,
      startsAt: event.start?.dateTime ?? startsAt.trim(),
      endsAt: event.end?.dateTime ?? endsAt?.trim() ?? null,
    });
  } catch (error) {
    res.status(400).json({
      error: 'calendar_event_create_failed',
      message: error instanceof Error ? error.message : 'Failed to create calendar event',
    });
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
    const kind =
      req.query.kind === 'docs' || req.query.kind === 'sheets' || req.query.kind === 'slides'
        ? req.query.kind
        : 'all';
    const files = await listRecentDriveFiles(req.user!.id, max, kind);
    res.json(files);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch Drive files';
    res.status(500).json({ error: 'fetch_error', message: msg });
  }
});

googleRouter.get('/drive/:fileId/reader', async (req: AuthedRequest, res) => {
  try {
    const status = await getGoogleConnectionStatus(req.user!.id);
    if (!status.connected) {
      return res.status(400).json({ error: 'not_connected', message: 'Google account not connected' });
    }

    const preview = await getGoogleWorkspacePreview(req.user!.id, String(req.params.fileId));
    res.json(preview);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to load Google file preview';
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
