import assert from 'node:assert/strict';
import { db } from '../lib/db';
import { ensureAdminAgent } from '../lib/user-agent';

const apiBase = process.env.STUDYCLAW_SMOKE_API_BASE ?? 'https://studyclaw.vercel.app';

type JsonRecord = Record<string, any>;

async function callApi(path: string, options: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload: any = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  assert.ok(response.ok, `${path} failed with ${response.status}: ${text}`);
  return { response, payload };
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

function logStep(label: string) {
  console.log(`[targeted-smoke] ${label}`);
}

async function main() {
  const unique = Date.now();
  const studentEmail = `targeted.student.${unique}@example.com`;
  const adminEmail = `targeted.admin.${unique}@example.com`;
  const password = 'strongpass123';

  logStep('signup student');
  const studentSignup = await callApi('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email: studentEmail, password }),
  });

  logStep('signup admin');
  const adminSignup = await callApi('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email: adminEmail, password }),
  });

  logStep('promote admin');
  await db.query(`update users set role = 'admin' where id = $1`, [adminSignup.payload.user.id]);
  await ensureAdminAgent({ ownerUserId: adminSignup.payload.user.id, email: adminEmail });

  logStep('login admin');
  const adminLogin = await callApi('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: adminEmail, password }),
  });

  const studentToken = String(studentSignup.payload.accessToken);
  const adminToken = String(adminLogin.payload.accessToken);
  const studentUserId = String(studentSignup.payload.user.id);

  logStep('onboarding');
  await callApi('/api/onboarding/options', {
    headers: authHeaders(studentToken),
  });
  await callApi('/api/onboarding/testing-tier', {
    method: 'POST',
    headers: authHeaders(studentToken),
    body: JSON.stringify({
      tier: 'tier_1',
    }),
  });
  await callApi('/api/onboarding/model-config', {
    method: 'POST',
    headers: authHeaders(studentToken),
    body: JSON.stringify({
      modelKey: 'minimax/MiniMax-M2.7',
      agentPreset: 'quick_start_2',
      usageMode: 'managed',
    }),
  });

  logStep('openclaw settings');
  const settings = await callApi('/api/openclaw/settings', {
    headers: authHeaders(studentToken),
  });
  assert.ok(settings.payload?.diagnostics, 'openclaw settings missing diagnostics');

  logStep('telegram status before');
  const telegramBefore = await callApi('/api/openclaw/telegram', {
    headers: authHeaders(studentToken),
  });
  assert.equal(telegramBefore.payload?.available, true);

  const testChatId = String(5550000000 + (unique % 100000));
  logStep('telegram approve');
  const telegramApprove = await callApi('/api/openclaw/telegram/approve', {
    method: 'POST',
    headers: authHeaders(studentToken),
    body: JSON.stringify({
      code: `pair-${testChatId}`,
    }),
  });
  assert.equal(telegramApprove.payload?.paired, true, 'telegram approval did not pair');

  logStep('telegram status after');
  const telegramAfter = await callApi('/api/openclaw/telegram', {
    headers: authHeaders(studentToken),
  });
  assert.equal(String(telegramAfter.payload?.boundPeerId), testChatId, 'telegram bound peer mismatch');

  logStep('cron create');
  const cronCreate = await callApi('/api/openclaw/cron', {
    method: 'POST',
    headers: authHeaders(studentToken),
    body: JSON.stringify({
      name: 'Targeted smoke job',
      message: 'Write a short study check-in.',
      scheduleKind: 'every',
      scheduleValue: '5m',
    }),
  });
  const cronJobs = Array.isArray(cronCreate.payload?.cron?.jobs) ? cronCreate.payload.cron.jobs : [];
  const cronJob = cronJobs.find((job: JsonRecord) => job.name === 'Targeted smoke job');
  assert.ok(cronJob, 'cron create missing job');

  logStep('cron delete');
  await callApi(`/api/openclaw/cron/${String(cronJob.id)}`, {
    method: 'DELETE',
    headers: authHeaders(studentToken),
  });

  logStep('coach process');
  const coachProcess = await callApi('/api/coach/process', {
    method: 'POST',
    headers: authHeaders(studentToken),
    body: JSON.stringify({
      title: 'Targeted backpack note',
      text: 'Mitochondria help cells release usable energy.',
    }),
  });
  assert.ok(coachProcess.payload?.assetId, 'coach process missing asset id');

  logStep('coach assets');
  const coachAssets = await callApi('/api/coach/assets', {
    headers: authHeaders(studentToken),
  });
  assert.ok(
    Array.isArray(coachAssets.payload?.assets) &&
      coachAssets.payload.assets.some((asset: JsonRecord) => asset.id === coachProcess.payload.assetId),
    'coach assets missing saved asset'
  );

  logStep('seed research thread');
  const researchThread = await db.query(
    `insert into chat_threads (user_id, openclaw_session_id, title)
     values ($1, $2, $3)
     returning id`,
    [studentUserId, `targeted_${unique}`, 'Targeted research']
  );
  const researchThreadId = String(researchThread.rows[0]?.id);
  const researchMessage = await db.query(
    `insert into chat_messages (thread_id, role, content, metadata_json)
     values ($1, 'assistant', $2, $3)
     returning id`,
    [
      researchThreadId,
      'Research summary ready.',
      JSON.stringify({
        researchResult: {
          title: 'Targeted note',
          summary: 'ATP production overview.',
          sources: [{ label: 'Biology text', url: 'https://example.com' }],
          checkedAt: new Date().toISOString(),
        },
      }),
    ]
  );
  const researchMessageId = String(researchMessage.rows[0]?.id);

  logStep('chat save-to-Backpack');
  const researchSave = await callApi('/api/chat/research-note', {
    method: 'POST',
    headers: authHeaders(studentToken),
    body: JSON.stringify({
      threadId: researchThreadId,
      messageId: researchMessageId,
    }),
  });
  assert.equal(researchSave.payload?.saved, true, 'research save did not report saved');
  assert.ok(researchSave.payload?.assetId, 'research save missing asset id');

  logStep('admin overview');
  await callApi('/api/admin/overview', {
    headers: authHeaders(adminToken),
  });
  logStep('admin users');
  const adminUsers = await callApi('/api/admin/users', {
    headers: authHeaders(adminToken),
  });
  assert.ok(Array.isArray(adminUsers.payload?.users), 'admin users missing');

  logStep('admin system');
  await callApi('/api/admin/system', {
    headers: authHeaders(adminToken),
  });
  logStep('admin content');
  await callApi('/api/admin/content', {
    headers: authHeaders(adminToken),
  });
  logStep('admin audit');
  await callApi('/api/admin/audit?limit=20', {
    headers: authHeaders(adminToken),
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        studentEmail,
        adminEmail,
        telegramChatId: testChatId,
        cronJobId: String(cronJob.id),
        coachAssetId: coachProcess.payload.assetId,
        researchAssetId: researchSave.payload.assetId,
        adminUsers: adminUsers.payload.users.length,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
