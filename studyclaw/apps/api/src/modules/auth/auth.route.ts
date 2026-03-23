import { Router } from 'express';
import { hashPassword, issueAccessToken, verifyPassword } from '../../lib/auth';
import { db } from '../../lib/db';
import { ensurePersonalAgent, ensureAdminAgent } from '../../lib/user-agent';
import { buildGoogleAuthUrl, exchangeGoogleCode, saveUserGoogleTokens } from '../../lib/google-service';
import { ensurePlatformSchema } from '../../lib/platform-schema';

export const authRouter = Router();

authRouter.get('/google', (req, res) => {
  const url = buildGoogleAuthUrl();
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
    const { tokens, userInfo } = await exchangeGoogleCode(code as string);
    const { email, name, sub: googleId } = userInfo;
    const isAdmin = email === process.env.STUDYCLAW_ADMIN_EMAIL;

    let userResult = await db.query(
      `select u.id, u.email, u.full_name, u.auth_provider, u.role, a.agent_type
       from users u 
       left join agents a on a.user_id = u.id 
       where u.email = $1`,
      [email]
    );

    let user;
    let existingUser = true;

    if (!userResult.rows[0]) {
      const created = await db.query(
        `insert into users (email, full_name, auth_provider, google_id, role)
         values ($1, $2, $3, $4, $5)
         returning id, email, full_name, role`,
        [email, name, 'google', googleId, isAdmin ? 'admin' : 'student']
      );
      user = created.rows[0];
      existingUser = false;
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

    if (!isAdmin) {
      await ensurePersonalAgent({ userId: user.id, email: user.email });
      await db.query(
        `insert into agents (user_id, openclaw_agent_id, name, agent_type, config)
         values ($1, $2, $3, $4, $5)
         on conflict (user_id) do nothing`,
        [user.id, `student_${user.id.replace(/-/g, '').slice(0, 12)}`, 'My Study Agent', 'custom', JSON.stringify({})]
      );
    }

    if (tokens.access_token && tokens.expiry_date) {
      await saveUserGoogleTokens({
        userId: user.id,
        googleSubject: googleId,
        googleEmail: email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        scope: tokens.scope ?? '',
        tokenType: tokens.token_type ?? 'Bearer',
        expiresAt: new Date(tokens.expiry_date),
      });
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
            permissions: ['manage_templates', 'manage_policy', 'debug_agents'],
          }),
        ]
      );
    }

    const accessToken = issueAccessToken(user);
    const session = {
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role ?? 'student' },
      accessToken,
      onboardingComplete: !!user.agent_type
    };

    const frontendUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
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

  const existing = await db.query(`select u.id, u.email, u.full_name, u.password_hash, u.role, a.agent_type from users u left join agents a on a.user_id = u.id where u.email = $1`, [email]);

  if (existing.rows[0]) {
    const user = existing.rows[0];
    if (user.password_hash) {
      if (!verifyPassword(password, user.password_hash)) {
        return res.status(409).json({ error: 'account_exists', message: 'Account already exists. Use the correct password to log in.' });
      }
    } else {
      await db.query(`update users set password_hash = $2 where id = $1`, [user.id, hashPassword(password)]);
    }

    await ensurePersonalAgent({ userId: user.id, email: user.email });
    await db.query(
      `insert into agents (user_id, openclaw_agent_id, name, agent_type, config)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id) do nothing`,
      [user.id, `student_${user.id.replace(/-/g, '').slice(0, 12)}`, 'My Study Agent', 'custom', JSON.stringify({})]
    );
    return res.json({ 
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role ?? 'student' }, 
      accessToken: issueAccessToken(user), 
      existingUser: true,
      onboardingComplete: !!user.agent_type
    });
  }

  const created = await db.query(
    `insert into users (email, password_hash, role)
     values ($1, $2, 'student')
     returning id, email, full_name, role`,
    [email, hashPassword(password)]
  );

  const user = created.rows[0];
  await ensurePersonalAgent({ userId: user.id, email: user.email });
  await db.query(
    `insert into agents (user_id, openclaw_agent_id, name, agent_type, config)
     values ($1, $2, $3, $4, $5)`,
    [user.id, `student_${user.id.replace(/-/g, '').slice(0, 12)}`, 'My Study Agent', 'custom', JSON.stringify({})]
  );
  res.status(201).json({ 
    user, 
    accessToken: issueAccessToken(user), 
    existingUser: false,
    onboardingComplete: false
  });
});

authRouter.post('/login', async (req, res) => {
  await ensurePlatformSchema();
  const { email, password } = req.body as any;
  if (!email || !password) {
    return res.status(400).json({ error: 'bad_request', message: 'email and password are required' });
  }

  const result = await db.query(`select u.id, u.email, u.full_name, u.password_hash, u.role, a.agent_type from users u left join agents a on a.user_id = u.id where u.email = $1`, [email]);
  if (!result.rows[0]) {
    return res.status(404).json({ error: 'not_found', message: 'User not found' });
  }

  const user = result.rows[0];
  if (!user.password_hash || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password' });
  }

  await ensurePersonalAgent({ userId: user.id, email: user.email });
  await db.query(
    `insert into agents (user_id, openclaw_agent_id, name, agent_type, config)
     values ($1, $2, $3, $4, $5)
     on conflict (user_id) do nothing`,
    [user.id, `student_${user.id.replace(/-/g, '').slice(0, 12)}`, 'My Study Agent', 'custom', JSON.stringify({})]
  );
  res.json({ 
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role ?? 'student' }, 
    accessToken: issueAccessToken(user),
    onboardingComplete: !!user.agent_type
  });
});
