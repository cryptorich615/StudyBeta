import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { ensurePlatformSchema } from '../../lib/platform-schema';
import { canUserLaunchBrowser, enforceBrowserPolicy, getOrCreateBrowserSession } from '../../lib/browser-session';
import { getBrowserConfig } from '../../lib/browser-config';

export const browserRouter = Router();
browserRouter.use(requireAuth);

browserRouter.get('/session', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const config = getBrowserConfig();

  if (!config.enabled) {
    return res.status(503).json({
      error: 'browser_unavailable',
      message: config.unavailableReason || 'Browser Access is not configured on this server yet.',
      provider: config.provider,
      embedAllowed: config.embedAllowed,
      timeoutMinutes: config.timeoutMinutes,
      restrictionsEnabled: config.restrictionsEnabled,
    });
  }

  if (!canUserLaunchBrowser(req.user!.id)) {
    return res.status(403).json({
      error: 'access_denied',
      message: 'Browser access is temporarily disabled for this account.',
    });
  }

  const session = await getOrCreateBrowserSession(req.user!.id);
  await enforceBrowserPolicy(session.id, session.policySnapshot);

  res.json({
    sessionId: session.id,
    remoteUrl: session.remoteUrl,
    launchUrl: session.launchUrl,
    embedUrl: session.embedUrl,
    status: session.status,
    policySnapshot: session.policySnapshot,
    embedAllowed: config.embedAllowed,
    provider: config.provider,
    timeoutMinutes: config.timeoutMinutes,
    restrictionsEnabled: config.restrictionsEnabled,
  });
});
