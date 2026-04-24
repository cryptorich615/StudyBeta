import assert from 'node:assert/strict';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { db } from '../lib/db';
import { ensureAdminAgent } from '../lib/user-agent';

const baseUrl = process.env.STUDYCLAW_SMOKE_WEB_BASE ?? 'https://studyclaw.vercel.app';
const password = process.env.STUDYCLAW_SMOKE_PASSWORD ?? 'strongpass123';

type SmokeResult = {
  route: string;
  pageErrors: string[];
  consoleErrors: string[];
  requestFailures: string[];
  badResponses: string[];
  appErrorBanner: boolean;
};

async function callApi(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  assert.ok(response.ok, `${path} failed: ${response.status} ${text}`);
  return payload;
}

async function loginThroughUi(page: Page, email: string, loginPassword: string) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', loginPassword);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 }),
    page.getByRole('button', { name: /log in|sign in/i }).first().click(),
  ]);
}

function isIgnorableAbort(url: string, errorText: string) {
  return errorText.includes('ERR_ABORTED') && (url.includes('/?_rsc=') || url.includes('&_rsc='));
}

async function checkRoute(page: Page, route: string): Promise<SmokeResult> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const requestFailures: string[] = [];
  const badResponses: string[] = [];

  const onPageError = (error: Error) => pageErrors.push(error.message);
  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  };
  const onRequestFailed = (request: { method(): string; url(): string; failure(): { errorText?: string } | null }) => {
    const errorText = request.failure()?.errorText ?? 'unknown';
    if (errorText.includes('ERR_ABORTED') || isIgnorableAbort(request.url(), errorText)) {
      return;
    }
    requestFailures.push(`${request.method()} ${request.url()} :: ${errorText}`);
  };
  const onResponse = (response: { status(): number; url(): string }) => {
    const status = response.status();
    if (status >= 400) {
      badResponses.push(`${status} ${response.url()}`);
    }
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4_000);

  const bodyText = await page.locator('body').innerText();
  const appErrorBanner = /Application error/i.test(bodyText);
  page.off('pageerror', onPageError);
  page.off('console', onConsole);
  page.off('requestfailed', onRequestFailed);
  page.off('response', onResponse);

  return {
    route,
    pageErrors,
    consoleErrors,
    requestFailures,
    badResponses,
    appErrorBanner,
  };
}

function summarize(result: SmokeResult) {
  return {
    route: result.route,
    appErrorBanner: result.appErrorBanner,
    pageErrors: result.pageErrors.length,
    consoleErrors: result.consoleErrors.length,
    requestFailures: result.requestFailures.length,
    badResponses: result.badResponses.length,
  };
}

async function main() {
  const unique = Date.now();
  const studentEmail = `ui.smoke.student.${unique}@example.com`;
  const adminEmail = `ui.smoke.admin.${unique}@example.com`;

  const studentSignup = await callApi('/api/auth/signup', { email: studentEmail, password });
  const adminSignup = await callApi('/api/auth/signup', { email: adminEmail, password });

  await db.query(`update users set role = 'admin' where id = $1`, [adminSignup.user.id]);
  await ensureAdminAgent({ ownerUserId: adminSignup.user.id, email: adminEmail });

  const browser = await chromium.launch({ headless: true });
  try {
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await loginThroughUi(studentPage, studentEmail, password);

    const studentResults = [];
    studentResults.push(await checkRoute(studentPage, '/settings'));
    studentResults.push(await checkRoute(studentPage, '/coach'));
    studentResults.push(await checkRoute(studentPage, '/chat'));
    await studentContext.close();

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginThroughUi(adminPage, adminEmail, password);
    const adminResult = await checkRoute(adminPage, '/admin/audit');
    await adminContext.close();

    const allResults = [...studentResults, adminResult];
    const routeErrors = allResults.map((result) => ({
      route: result.route,
      server5xx: result.badResponses.filter((line) => /^5\d\d /.test(line)),
      server4xx: result.badResponses.filter((line) => /^4\d\d /.test(line)),
    }));
    const failures = allResults.filter(
      (result) =>
        result.appErrorBanner ||
        result.pageErrors.length > 0 ||
        result.requestFailures.length > 0 ||
        result.badResponses.some((line) => /^5\d\d /.test(line))
    );

    console.log(
      JSON.stringify(
        {
          ok: failures.length === 0,
          summary: allResults.map(summarize),
          routeErrors,
          failures,
          accounts: {
            studentEmail,
            adminEmail,
          },
        },
        null,
        2
      )
    );
    assert.equal(failures.length, 0, 'UI smoke found route failures');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
