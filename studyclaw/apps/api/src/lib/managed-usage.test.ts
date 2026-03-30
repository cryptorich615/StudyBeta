import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MANAGED_USAGE_WINDOW_HOURS,
  buildManagedVirtualApiKey,
  getTierStartingCredits,
  getTierLimit,
  isManagedMiniMaxModelKey,
  summarizeUsageWindow,
  verifyManagedVirtualApiKey,
} from './managed-usage';

test('managed MiniMax model detection only allows configured StudyClaw profiles', () => {
  assert.equal(isManagedMiniMaxModelKey('minimax/MiniMax-M2.5'), true);
  assert.equal(isManagedMiniMaxModelKey('minimax/MiniMax-M2.7'), true);
  assert.equal(isManagedMiniMaxModelKey('openrouter/auto'), false);
  assert.equal(isManagedMiniMaxModelKey('minimax/custom'), false);
  assert.equal(isManagedMiniMaxModelKey(''), false);
});

test('virtual API keys validate only when the signed identity is intact', () => {
  const identity = 'scu_testidentity123';
  const key = buildManagedVirtualApiKey(identity);

  assert.equal(verifyManagedVirtualApiKey(key), identity);
  assert.equal(verifyManagedVirtualApiKey(`${key}tampered`), null);
  assert.equal(verifyManagedVirtualApiKey(key.replace(identity, 'scu_other')), null);
  assert.equal(verifyManagedVirtualApiKey('Bearer something-else'), null);
});

test('rolling 5-hour usage window counts reserved and consumed events, but not failed events', () => {
  const now = new Date('2026-03-28T12:00:00.000Z');
  const withinWindow = new Date(now.getTime() - (MANAGED_USAGE_WINDOW_HOURS - 1) * 60 * 60 * 1000);
  const outsideWindow = new Date(now.getTime() - (MANAGED_USAGE_WINDOW_HOURS + 1) * 60 * 60 * 1000);

  const summary = summarizeUsageWindow({
    tier: 'tier_2',
    now,
    events: [
      { status: 'reserved', reservedAt: withinWindow, requestUnits: 2 },
      { status: 'consumed', reservedAt: withinWindow, requestUnits: 3 },
      { status: 'failed', reservedAt: withinWindow, requestUnits: 99 },
      { status: 'consumed', reservedAt: outsideWindow, requestUnits: 10 },
    ],
  });

  assert.equal(summary.windowLimit, getTierLimit('tier_2'));
  assert.equal(summary.usedInWindow, 5);
  assert.equal(summary.remainingInWindow, getTierLimit('tier_2') - 5);
  assert.equal(summary.resetsAt, new Date(withinWindow.getTime() + MANAGED_USAGE_WINDOW_HOURS * 60 * 60 * 1000).toISOString());
});

test('rolling window treats events exactly on the boundary as active and protects against zero-unit abuse', () => {
  const now = new Date('2026-03-28T12:00:00.000Z');
  const boundary = new Date(now.getTime() - MANAGED_USAGE_WINDOW_HOURS * 60 * 60 * 1000);

  const summary = summarizeUsageWindow({
    tier: 'tier_1',
    now,
    events: [
      { status: 'reserved', reservedAt: boundary, requestUnits: 0 },
      { status: 'consumed', reservedAt: new Date(now.getTime() - 1_000), requestUnits: 1 },
    ],
  });

  assert.equal(summary.usedInWindow, 2);
  assert.equal(summary.remainingInWindow, getTierLimit('tier_1') - 2);
});

test('testing tiers expose deterministic starting credit balances', () => {
  assert.equal(getTierStartingCredits('tier_1'), 1000);
  assert.equal(getTierStartingCredits('tier_2'), 2000);
  assert.equal(getTierStartingCredits('tier_3'), 3000);
});
