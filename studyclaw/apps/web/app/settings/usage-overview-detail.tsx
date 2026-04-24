'use client';

import { useEffect, useState } from 'react';
import StatusBanner from '../components/status-banner';
import { apiFetch } from '../../lib/api';
import { readStoredSession } from '../../lib/session';
import type { ManagedUsageAccountSummary, ManagedUsageEventItem, UsageAccessProfile } from './settings-core';
import { SettingsDetailShell, SettingsStatus, formatNumber, formatTime, useSettingsSnapshot } from './settings-core';

export function UsageOverviewDetail() {
  const { loading, snapshot, status } = useSettingsSnapshot();
  const [accessProfile, setAccessProfile] = useState<UsageAccessProfile | null>(null);
  const [adminAccounts, setAdminAccounts] = useState<ManagedUsageAccountSummary[]>([]);
  const [selectedAdminAccount, setSelectedAdminAccount] = useState<string>('');
  const [selectedAdminEvents, setSelectedAdminEvents] = useState<ManagedUsageEventItem[]>([]);
  const [adminStatus, setAdminStatus] = useState('');
  const [updatingTierFor, setUpdatingTierFor] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const nextIsAdmin = readStoredSession()?.user?.role === 'admin';
    setIsAdmin(nextIsAdmin);
    void loadUsageState(nextIsAdmin);
  }, []);

  async function loadUsageState(adminOverride = isAdmin) {
    if (!readStoredSession()?.accessToken) {
      return;
    }

    const modelResponse = await apiFetch('/api/openclaw/model-settings');
    const modelData = await modelResponse.json().catch(() => ({}));
    if (modelResponse.ok) {
      setAccessProfile(modelData.accessProfile ?? null);
    }

    if (!adminOverride) {
      return;
    }

    const adminResponse = await apiFetch('/api/admin/managed-usage');
    const adminData = await adminResponse.json().catch(() => ({}));
    if (!adminResponse.ok) {
      setAdminStatus(adminData.message || 'Failed to load managed usage accounts');
      return;
    }

    setAdminAccounts(adminData.accounts ?? []);
    setAdminStatus('');
  }

  async function updateTier(userId: string, tier: 'tier_1' | 'tier_2' | 'tier_3') {
    setUpdatingTierFor(userId);
    const response = await apiFetch(`/api/admin/managed-usage/${encodeURIComponent(userId)}/tier`, {
      method: 'PATCH',
      body: JSON.stringify({ tier }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setAdminStatus(data.message || 'Failed to update tier');
      setUpdatingTierFor('');
      return;
    }

    await loadUsageState();
    setUpdatingTierFor('');
  }

  async function inspectManagedUsageUser(userId: string) {
    setSelectedAdminAccount(userId);
    const response = await apiFetch(`/api/admin/managed-usage/${encodeURIComponent(userId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setAdminStatus(data.message || 'Failed to load managed usage events');
      return;
    }

    setSelectedAdminEvents(data.events ?? []);
    setAdminStatus('');
  }

  return (
    <SettingsDetailShell
      badge="Usage Overview"
      title="Review token usage and session activity."
      description="This page keeps the account-wide usage numbers and session history together as a dedicated detail view."
    >
      <SettingsStatus status={status} probe={snapshot?.diagnostics.channelsProbe} />
      {adminStatus ? <StatusBanner tone="danger">{adminStatus}</StatusBanner> : null}

      <section className="secondary-card">
        <p className="eyebrow">Usage</p>
        <div className="metrics-grid" style={{ marginTop: 12 }}>
          <div className="metric-panel">
            <strong>{loading ? '...' : formatNumber(snapshot?.usage.inputTokens)}</strong>
            <span>Input tokens</span>
          </div>
          <div className="metric-panel">
            <strong>{loading ? '...' : formatNumber(snapshot?.usage.outputTokens)}</strong>
            <span>Output tokens</span>
          </div>
          <div className="metric-panel">
            <strong>{loading ? '...' : formatNumber(snapshot?.usage.totalTokens)}</strong>
            <span>Total tokens</span>
          </div>
          <div className="metric-panel">
            <strong>{loading ? '...' : snapshot?.sessions.length ?? 0}</strong>
            <span>Sessions</span>
          </div>
        </div>
        {accessProfile ? (
          <div className="settings-stack compact" style={{ marginTop: 16 }}>
            <div className="settings-row">
              <span className="muted-copy">Billing mode</span>
              <strong>{accessProfile.billingMode}</strong>
            </div>
            <div className="settings-row">
              <span className="muted-copy">Provider selection</span>
              <strong>{accessProfile.providerSelection ?? 'n/a'}</strong>
            </div>
            <div className="settings-row">
              <span className="muted-copy">Model selection</span>
              <strong>{accessProfile.modelSelection ?? 'n/a'}</strong>
            </div>
            <div className="settings-row">
              <span className="muted-copy">Tier</span>
              <strong>{accessProfile.tier ?? 'n/a'}</strong>
            </div>
            <div className="settings-row">
              <span className="muted-copy">Rolling 5-hour usage</span>
              <strong>
                {accessProfile.windowLimit === null
                  ? 'Not limited'
                  : `${accessProfile.usedInWindow}/${accessProfile.windowLimit}`}
              </strong>
            </div>
            {accessProfile.remainingInWindow !== null ? (
              <div className="settings-row">
                <span className="muted-copy">Remaining quota</span>
                <strong>{accessProfile.remainingInWindow}</strong>
              </div>
            ) : null}
            {accessProfile.creditsRemaining !== null ? (
              <div className="settings-row">
                <span className="muted-copy">Remaining credits</span>
                <strong>{accessProfile.creditsRemaining}</strong>
              </div>
            ) : null}
            {accessProfile.resetsAt ? (
              <div className="settings-row">
                <span className="muted-copy">Window resets</span>
                <strong>{formatTime(new Date(accessProfile.resetsAt).getTime())}</strong>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="secondary-card">
        <p className="eyebrow">Sessions</p>
        <div className="settings-stack" style={{ marginTop: 14 }}>
          {(snapshot?.sessions ?? []).length ? (
            snapshot?.sessions.map((session) => (
              <div className="settings-row session-row" key={session.sessionId ?? session.key}>
                <div>
                  <strong>{session.model ?? 'Unknown model'}</strong>
                  <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                    {session.kind ?? 'direct'}
                    {' · '}
                    {session.modelProvider ?? 'unknown provider'}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong>{formatNumber(session.totalTokens)} tokens</strong>
                  <p className="muted-copy" style={{ margin: '4px 0 0' }}>{formatTime(session.updatedAt)}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="muted-copy">No sessions found for this user agent yet.</p>
          )}
        </div>
      </section>

      {isAdmin ? (
        <section className="secondary-card">
          <p className="eyebrow">Managed account inspection</p>
          <div className="settings-stack" style={{ marginTop: 14 }}>
            {adminAccounts.length ? (
              adminAccounts.map((account) => (
                <div className="settings-row session-row" key={account.userId}>
                  <div>
                    <strong>{account.email}</strong>
                    <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                      {account.billingMode}
                      {' · '}
                      {account.modelSelection ?? 'No model'}
                      {' · '}
                      {account.internalUsageIdentity ?? 'No identity'}
                      {' · '}
                      {account.creditsRemaining} credits
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <strong>
                      {account.windowLimit === null
                        ? 'Not limited'
                        : `${account.usedInWindow}/${account.windowLimit}`}
                    </strong>
                    <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                      <select
                        value={account.tier ?? 'tier_1'}
                        onChange={(event) => void updateTier(account.userId, event.target.value as 'tier_1' | 'tier_2' | 'tier_3')}
                        disabled={updatingTierFor === account.userId}
                      >
                        <option value="tier_1">tier_1</option>
                        <option value="tier_2">tier_2</option>
                        <option value="tier_3">tier_3</option>
                      </select>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => void inspectManagedUsageUser(account.userId)}
                      >
                        Inspect events
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted-copy">No managed usage accounts found yet.</p>
            )}
          </div>
        </section>
      ) : null}

      {isAdmin && selectedAdminAccount ? (
        <section className="secondary-card">
          <p className="eyebrow">Recent usage events</p>
          <div className="settings-stack" style={{ marginTop: 14 }}>
            {selectedAdminEvents.length ? (
              selectedAdminEvents.map((event) => (
                <div className="settings-row session-row" key={event.id}>
                  <div>
                    <strong>{event.feature}</strong>
                    <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                      {event.modelKey}
                      {' · '}
                      {event.status}
                      {' · '}
                      {event.requestUnits} unit{event.requestUnits === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <strong>{formatTime(new Date(event.reservedAt).getTime())}</strong>
                    <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                      {event.finalizedAt ? `Finalized ${formatTime(new Date(event.finalizedAt).getTime())}` : 'Pending finalization'}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted-copy">No recent usage events found for this account.</p>
            )}
          </div>
        </section>
      ) : null}
    </SettingsDetailShell>
  );
}
