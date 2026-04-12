import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendarWindow, dedupeCalendarEvents, deriveGoogleIntegrationStatus, getGoogleScopesForPurpose } from './google-service';

test('deriveGoogleIntegrationStatus treats read-only calendar scope as connected', () => {
  const status = deriveGoogleIntegrationStatus({
    hasStoredToken: true,
    hasAccessToken: true,
    hasRefreshToken: false,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  assert.equal(status.connected, true);
  assert.equal(status.status, 'connected');
  assert.equal(status.canReadCalendar, true);
  assert.equal(status.canWriteCalendar, false);
  assert.equal(status.canUseWorkspaceSkill, true);
  assert.equal(status.error, null);
});

test('deriveGoogleIntegrationStatus exposes workspace capability flags for Drive, Docs, Sheets, and Slides', () => {
  const status = deriveGoogleIntegrationStatus({
    hasStoredToken: true,
    hasAccessToken: true,
    hasRefreshToken: true,
    scopes: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/presentations.readonly',
    ],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  assert.equal(status.canReadDrive, true);
  assert.equal(status.canUseGmail, false);
  assert.equal(status.canSendGmail, false);
  assert.equal(status.canUseDocs, true);
  assert.equal(status.canUseSheets, true);
  assert.equal(status.canUseSlides, true);
  assert.equal(status.canUseWorkspaceSkill, true);
});

test('deriveGoogleIntegrationStatus treats Gmail-only workspace access as connected', () => {
  const status = deriveGoogleIntegrationStatus({
    hasStoredToken: true,
    hasAccessToken: true,
    hasRefreshToken: true,
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  assert.equal(status.connected, true);
  assert.equal(status.status, 'connected');
  assert.equal(status.canUseGmail, true);
  assert.equal(status.canSendGmail, false);
  assert.equal(status.canUseWorkspaceSkill, true);
  assert.equal(status.error, null);
});

test('deriveGoogleIntegrationStatus exposes Gmail send capability when granted', () => {
  const status = deriveGoogleIntegrationStatus({
    hasStoredToken: true,
    hasAccessToken: true,
    hasRefreshToken: true,
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  assert.equal(status.connected, true);
  assert.equal(status.canUseGmail, false);
  assert.equal(status.canSendGmail, true);
  assert.equal(status.canUseWorkspaceSkill, true);
});

test('deriveGoogleIntegrationStatus requires reconnect when workspace scopes are missing', () => {
  const status = deriveGoogleIntegrationStatus({
    hasStoredToken: true,
    hasAccessToken: true,
    hasRefreshToken: true,
    scopes: ['openid', 'email', 'profile'],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  assert.equal(status.connected, false);
  assert.equal(status.status, 'reconnect_required');
  assert.equal(status.error, 'missing_workspace_scope');
});

test('deriveGoogleIntegrationStatus requires reconnect when an expired token has no refresh token', () => {
  const status = deriveGoogleIntegrationStatus({
    hasStoredToken: true,
    hasAccessToken: true,
    hasRefreshToken: false,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
  });

  assert.equal(status.connected, false);
  assert.equal(status.status, 'reconnect_required');
  assert.equal(status.error, 'missing_refresh_token');
});

test('getGoogleScopesForPurpose includes calendar scopes for connect and sign-in scopes for signin', () => {
  const connectScopes = getGoogleScopesForPurpose('connect');
  const signinScopes = getGoogleScopesForPurpose('signin');

  assert.equal(connectScopes.includes('https://www.googleapis.com/auth/calendar.readonly'), true);
  assert.equal(connectScopes.includes('https://www.googleapis.com/auth/calendar.events'), true);
  assert.equal(connectScopes.includes('https://www.googleapis.com/auth/drive.readonly'), true);
  assert.equal(connectScopes.includes('https://www.googleapis.com/auth/gmail.readonly'), true);
  assert.equal(connectScopes.includes('https://www.googleapis.com/auth/gmail.send'), true);
  assert.equal(connectScopes.includes('https://www.googleapis.com/auth/documents'), true);
  assert.equal(connectScopes.includes('https://www.googleapis.com/auth/spreadsheets.readonly'), true);
  assert.equal(connectScopes.includes('https://www.googleapis.com/auth/presentations.readonly'), true);
  assert.equal(signinScopes.includes('https://www.googleapis.com/auth/calendar.readonly'), false);
  assert.equal(signinScopes.includes('openid'), true);
});

test('dedupeCalendarEvents removes duplicate upcoming events while preserving order', () => {
  const deduped = dedupeCalendarEvents([
    {
      id: 'evt_1',
      title: 'Biology review',
      startsAt: '2026-04-05T14:00:00.000Z',
      endsAt: '2026-04-05T15:00:00.000Z',
      htmlLink: 'https://calendar.google.com/event?1',
    },
    {
      id: 'evt_1',
      title: 'Biology review',
      startsAt: '2026-04-05T14:00:00.000Z',
      endsAt: '2026-04-05T15:00:00.000Z',
      htmlLink: 'https://calendar.google.com/event?1',
    },
    {
      id: 'evt_2',
      title: 'English essay',
      startsAt: '2026-04-06T16:00:00.000Z',
      endsAt: '2026-04-06T17:00:00.000Z',
      htmlLink: 'https://calendar.google.com/event?2',
    },
  ]);

  assert.equal(deduped.length, 2);
  assert.deepEqual(
    deduped.map((event) => event.id),
    ['evt_1', 'evt_2']
  );
});

test('buildCalendarWindow constrains recurring event fetches to the requested day range', () => {
  const window = buildCalendarWindow(14, new Date('2026-04-05T12:00:00.000Z'));

  assert.equal(window.timeMin, '2026-04-05T12:00:00.000Z');
  assert.equal(window.timeMax, '2026-04-19T12:00:00.000Z');
});
