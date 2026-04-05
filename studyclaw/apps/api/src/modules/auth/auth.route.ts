import { Router } from 'express';
import { hashPassword, issueAccessToken, requireAuth, type AuthedRequest, verifyPassword } from '../../lib/auth';
import { db } from '../../lib/db';
import { ensureAdminAgent } from '../../lib/user-agent';
import { buildGoogleAuthUrl, decodeGoogleAuthState, exchangeGoogleCode, getGoogleScopesForPurpose, saveUserGoogleTokens, syncGoogleSkillForUser } from '../../lib/google-service';
import { ensurePlatformSchema } from '../../lib/platform-schema';
import { getUserUsageSnapshot } from '../../lib/managed-usage';
import { logAdminAuditEvent } from '../../lib/admin-ops';

export const authRouter = Router();

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

function resolveFrontendOrigin(req: Parameters<typeof authRouter.get>[1] extends never ? never : any) {
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

function resolveOnboardingComplete(user: { role?: string | null }, onboardingComplete?: boolean | null) {
  if (user.role === 'admin') {
    return true;
  }

  return !!onboardingComplete;
}

function sanitizeFrontendPath(value: string | undefined, fallbackPath: string) {
  if (!value || !value.startsWith('/')) {
    return fallbackPath;
  }

  return value;
}

async function ensureStudentProfileRecord(userId: string) {
  await db.query(
    `insert into student_profiles (user_id)
     values ($1)
     on conflict (user_id) do nothing`,
    [userId]
  );
}

async function getUsageSnapshotOrNull(userId: string, context: string) {
  try {
    return await getUserUsageSnapshot(userId);
  } catch (error) {
    console.warn('[auth] usage snapshot lookup failed', {
      context,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

authRouter.get('/me', requireAuth, async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const [userResult, usageProfileResult, studentProfileResult] = await Promise.all([
    db.query(`select id, email, full_name, role from users where id = $1 limit 1`, [req.user!.id]),
    getUserUsageSnapshot(req.user!.id),
    db.query(`select onboarding_complete from student_profiles where user_id = $1 limit 1`, [req.user!.id]),
  ]);

  const user = userResult.rows[0];
  if (!user) {
    return res.status(404).json({ error: 'not_found', message: 'User not found' });
  }

  return res.json({
    user,
    onboardingComplete: resolveOnboardingComplete(user, studentProfileResult.rows[0]?.onboarding_complete),
    usageProfile: usageProfileResult,
  });
});

authRouter.get('/google', (req, res) => {
  const url = buildGoogleAuthUrl({
    purpose: 'signin',
    frontendOrigin: resolveFrontendOrigin(req),
  });
  console.log('Initiating Google OAuth redirect to:', url);
  res.redirect(url);
});

authRouter.get('/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Missing code');
  }

  try {
    await ensurePlatformSchema();
    const state = decodeGoogleAuthState(typeof req.query.state === 'string' ? req.query.state : undefined);
    const { tokens, userInfo } = await exchangeGoogleCode(code as string);
    const { email, name, sub: googleId } = userInfo;
    const frontendUrl = sanitizeFrontendOrigin(state?.frontendOrigin)
      || sanitizeFrontendOrigin(process.env.CLIENT_URL || process.env.FRONTEND_URL)
      || 'http://localhost:3000';
    console.info('[auth] google signin callback received', {
      email,
      frontendUrl,
      hasName: !!name,
      hasAccessToken: !!tokens.access_token,
    });

    if (state?.purpose === 'connect') {
      console.info('[google] oauth callback for calendar connect', {
        userId: state.userId ?? null,
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        scopeCount: String(tokens.scope ?? '').split(/\s+/).filter(Boolean).length,
      });

      if (!state.userId) {
        return res.status(400).send('Missing user context');
      }

      if (!tokens.access_token) {
        return res.status(500).send('Google connection did not return access tokens');
      }

      const expiresAt = tokens.expiry_date
        ? new Date(tokens.expiry_date)
        : new Date(Date.now() + 55 * 60 * 1000);

      await saveUserGoogleTokens({
        userId: state.userId,
        googleSubject: googleId,
        googleEmail: email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        scope: tokens.scope ?? getGoogleScopesForPurpose('connect').join(' '),
        tokenType: tokens.token_type ?? 'Bearer',
        expiresAt,
      });
      console.info('[google] oauth tokens persisted', {
        userId: state.userId,
        googleEmail: email,
        hasRefreshToken: !!tokens.refresh_token,
        expiresAt: expiresAt.toISOString(),
      });
      await syncGoogleSkillForUser(state.userId).catch(() => undefined);

      const returnTo = sanitizeFrontendPath(state.returnTo, '/settings');
      const separator = returnTo.includes('?') ? '&' : '?';
      return res.redirect(`${frontendUrl}${returnTo}${separator}google=connected`);
    }

    const isAdmin = email === process.env.STUDYCLAW_ADMIN_EMAIL;

    let userResult = await db.query(
      `select u.id, u.email, u.full_name, u.auth_provider, u.role, sp.onboarding_complete
       from users u 
       left join student_profiles sp on sp.user_id = u.id
       where u.email = $1`,
      [email]
    );

    let user;
    let isNewUser = false;

    if (!userResult.rows[0]) {
      const created = await db.query(
        `insert into users (email, full_name, auth_provider, google_id, role)
         values ($1, $2, $3, $4, $5)
         returning id, email, full_name, role`,
        [email, name, 'google', googleId, isAdmin ? 'admin' : 'student']
      );
      user = created.rows[0];
      isNewUser = true;
    } else {
      user = userResult.rows[0];
      await db.query(
        `update users
         set auth_provider = 'google',
             google_id = $2,
             role = $3,
             updated_at = now()
         where id = $1`,
        [user.id, googleId, isAdmin ? 'admin' : user.role ?? 'student']
      );
      user.role = isAdmin ? 'admin' : user.role ?? 'student';
    }

    if (user.role !== 'admin') {
      await ensureStudentProfileRecord(user.id);
    }

    if (isAdmin) {
      const adminAgent = await ensureAdminAgent({ ownerUserId: user.id, email: user.email });
      await db.query(
        `insert into admin_agents (owner_user_id, openclaw_agent_id, config)
         values ($1, $2, $3)
         on conflict (owner_user_id) do update set
           openclaw_agent_id = excluded.openclaw_agent_id,
           config = excluded.config,
           updated_at = now()`,
        [
          user.id,
          adminAgent.openclawAgentId,
          JSON.stringify({
            role: 'master_admin',
            permissions: [
              'manage_templates',
              'manage_policy',
              'manage_rules',
              'manage_runtime',
              'debug_agents',
              'reset_agents',
              'inspect_platform',
            ],
          }),
        ]
      );
    }

    const accessToken = issueAccessToken(user);
    const onboardingComplete = resolveOnboardingComplete(user, user.onboarding_complete);
    const usageProfile = await getUsageSnapshotOrNull(user.id, 'google_callback');
    if (user.role === 'admin') {
      await logAdminAuditEvent({
        actorUserId: user.id,
        targetUserId: user.id,
        eventType: isNewUser ? 'admin_account_created' : 'admin_login',
        entityType: 'session',
        entityId: user.id,
        summary: isNewUser ? 'Admin account authenticated with Google for the first time.' : 'Admin signed in with Google.',
        metadata: { authProvider: 'google' },
      });
    }
    const session = {
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role ?? 'student' },
      accessToken,
      onboardingComplete,
      usageProfile,
    };

    const encodedSession = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
    res.redirect(`${frontendUrl}/auth/callback?payload=${encodeURIComponent(encodedSession)}`);
  } catch (error) {
    console.error('Google Auth Error:', error);
    res.status(500).send('Authentication failed');
  }
});

authRouter.post('/signup', async (req, res) => {
  await ensurePlatformSchema();
  const { email, password } = req.body as any;
  if (!email || !password) {
    return res.status(400).json({ error: 'bad_request', message: 'email and password are required' });
  }

  const existing = await db.query(
    `select u.id, u.email, u.full_name, u.password_hash, u.role, sp.onboarding_complete
     from users u
     left join student_profiles sp on sp.user_id = u.id
     where u.email = $1`,
    [email]
  );

  if (existing.rows[0]) {
    const user = existing.rows[0];
    if (user.password_hash) {
      if (!verifyPassword(password, user.password_hash)) {
        return res.status(409).json({ error: 'account_exists', message: 'Account already exists. Use the correct password to log in.' });
      }
    } else {
      await db.query(`update users set password_hash = $2 where id = $1`, [user.id, hashPassword(password)]);
    }

    const usageProfile = await getUserUsageSnapshot(user.id);
    if ((user.role ?? 'student') === 'admin') {
      await logAdminAuditEvent({
        actorUserId: user.id,
        targetUserId: user.id,
        eventType: 'admin_login',
        entityType: 'session',
        entityId: user.id,
        summary: 'Admin signed in through the email auth path.',
        metadata: { authProvider: 'email' },
      });
    }
    return res.json({ 
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role ?? 'student' }, 
      accessToken: issueAccessToken(user), 
      existingUser: true,
      onboardingComplete: resolveOnboardingComplete(user, user.onboarding_complete),
      usageProfile,
    });
  }

  const created = await db.query(
    `insert into users (email, password_hash, role)
     values ($1, $2, 'student')
     returning id, email, full_name, role`,
    [email, hashPassword(password)]
  );

  const user = created.rows[0];
  const usageProfile = await getUserUsageSnapshot(user.id);
  res.status(201).json({ 
    user, 
    accessToken: issueAccessToken(user), 
    existingUser: false,
    onboardingComplete: resolveOnboardingComplete(user, false),
    usageProfile,
  });
});

authRouter.post('/login', async (req, res) => {
  await ensurePlatformSchema();
  const { email, password } = req.body as any;
  if (!email || !password) {
    return res.status(400).json({ error: 'bad_request', message: 'email and password are required' });
  }

  const result = await db.query(
    `select u.id, u.email, u.full_name, u.password_hash, u.role, sp.onboarding_complete
     from users u
     left join student_profiles sp on sp.user_id = u.id
     where u.email = $1`,
    [email]
  );
  if (!result.rows[0]) {
    return res.status(404).json({ error: 'not_found', message: 'User not found' });
  }

  const user = result.rows[0];
  if (!user.password_hash || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password' });
  }

  const usageProfile = await getUserUsageSnapshot(user.id);
  if ((user.role ?? 'student') === 'admin') {
    await logAdminAuditEvent({
      actorUserId: user.id,
      targetUserId: user.id,
      eventType: 'admin_login',
      entityType: 'session',
      entityId: user.id,
      summary: 'Admin signed in with email credentials.',
      metadata: { authProvider: 'email' },
    });
  }
  res.json({ 
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role ?? 'student' }, 
    accessToken: issueAccessToken(user),
    onboardingComplete: resolveOnboardingComplete(user, user.onboarding_complete),
    usageProfile,
  });
});
