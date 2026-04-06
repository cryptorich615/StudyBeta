import { chromium } from '@playwright/test';

const API_BASE = 'http://127.0.0.1:4000';
const WEB_BASE = 'http://127.0.0.1:3000';

type SignupPayload = {
  accessToken: string;
  user?: {
    id: string;
    email: string;
    full_name?: string;
    role?: string;
    agent_type?: string | null;
  };
};

async function api<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, init);
  const payload = await response.json().catch(() => ({}));
  return { response, payload: payload as T };
}

async function main() {
  const unique = Date.now();
  const email = `chat.ui.${unique}@example.com`;
  const password = 'strongpass123';

  const signup = await api<SignupPayload>('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!signup.response.ok || !signup.payload.accessToken || !signup.payload.user?.id) {
    throw new Error(`Signup failed: ${signup.response.status} ${JSON.stringify(signup.payload)}`);
  }

  const authHeader = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${signup.payload.accessToken}`,
  };

  const tier = await api('/api/onboarding/testing-tier', {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({ tier: 'tier_1' }),
  });
  if (!tier.response.ok) {
    throw new Error(`Tier setup failed: ${tier.response.status} ${JSON.stringify(tier.payload)}`);
  }

  const launch = await api('/api/onboarding/model-config', {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify({
      modelKey: 'minimax/MiniMax-M2.7',
      agentPreset: 'quick_start_1',
      usageMode: 'managed',
    }),
  });
  if (!launch.response.ok) {
    throw new Error(`Agent launch failed: ${launch.response.status} ${JSON.stringify(launch.payload)}`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedResponses: Array<{ url: string; status: number; body: string }> = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  page.on('response', async (response) => {
    if (response.status() >= 400 && response.url().includes('/api/')) {
      let body = '';
      try {
        body = await response.text();
      } catch {
        body = '<unavailable>';
      }
      failedResponses.push({
        url: response.url(),
        status: response.status(),
        body: body.slice(0, 2000),
      });
    }
  });

  const storedSession = {
    user: {
      id: signup.payload.user.id,
      email: signup.payload.user.email,
      role: signup.payload.user.role ?? 'student',
      agent_type: 'quick_start_1',
    },
    accessToken: signup.payload.accessToken,
    onboardingComplete: true,
  };

  await page.addInitScript((session) => {
    window.localStorage.setItem('studyclaw-user', JSON.stringify(session));
    document.cookie = `studyclaw_access_token=${encodeURIComponent((session as any).accessToken)}; Path=/; SameSite=Lax`;
    document.cookie = `studyclaw_role=${encodeURIComponent((session as any).user.role ?? 'student')}; Path=/; SameSite=Lax`;
  }, storedSession);

  await page.goto(`${WEB_BASE}/chat`, { waitUntil: 'networkidle' });
  await page.waitForSelector('textarea.study-chat-composer__textarea');
  await page.fill('textarea.study-chat-composer__textarea', 'What classes do I have today?');
  await page.click('button.study-chat-composer__send');
  let liveProgress: string[] = [];
  let sawLiveProgress = false;
  try {
    await page.waitForSelector('.study-chat-live-progress__item', { timeout: 10000 });
    liveProgress = await page.locator('.study-chat-live-progress__item').allTextContents();
    sawLiveProgress = liveProgress.length > 0;
  } catch {
    liveProgress = await page.locator('.study-chat-live-progress__item').allTextContents().catch(() => []);
  }
  const assistantSelector = '.study-chat-bubble.is-assistant .study-chat-bubble__content';

  try {
    await page.waitForFunction(
      (selector) => {
        const contents = Array.from(document.querySelectorAll(selector))
          .map((node) => node.textContent || '')
          .join('\n');
        const live = document.querySelector('.study-chat-bubble.is-assistant.is-streaming .study-chat-bubble__content')?.textContent || '';
        return /none scheduled|you have|today/i.test(`${contents}\n${live}`);
      },
      assistantSelector,
      { timeout: 60000 }
    );
  } catch (error) {
    const threadSnapshot = await page.locator('.study-chat-thread').innerText().catch(() => '');
    const screenshotPath = `/tmp/chat-ui-smoke-${unique}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    console.error(
      JSON.stringify(
        {
          ok: false,
          reason: 'assistant_content_timeout',
          sawLiveProgress,
          liveProgress,
          threadSnapshot,
          consoleErrors,
          pageErrors,
          failedResponses,
          screenshotPath,
        },
        null,
        2
      )
    );
    throw error;
  }

  const threadText = await page.locator('.study-chat-thread').innerText();

  await browser.close();

  console.log(
    JSON.stringify(
      {
        ok: true,
        sawLiveProgress,
        liveProgress,
        sawStreamingPhrase: liveProgress.some((item) => /thinking|opening your schedule/i.test(item)),
        threadExcerpt: threadText.slice(0, 800),
        consoleErrors,
        pageErrors,
        failedResponses,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
