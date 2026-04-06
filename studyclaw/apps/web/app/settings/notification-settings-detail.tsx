'use client';

import { useEffect, useState } from 'react';
import StatusBanner from '../components/status-banner';
import { apiFetch, beginGoogleConnect } from '../../lib/api';
import type { GoogleIntegrationSummary, TelegramSettingsPayload } from './settings-core';
import { SettingsDetailShell, SettingsStatus, useSettingsSnapshot } from './settings-core';

export function NotificationSettingsDetail() {
  const { snapshot, status } = useSettingsSnapshot();
  const [connectStatus, setConnectStatus] = useState('');
  const [googleStatus, setGoogleStatus] = useState<GoogleIntegrationSummary | null>(null);
  const [telegramStatus, setTelegramStatus] = useState('');
  const [telegramCode, setTelegramCode] = useState('');
  const [telegramLoading, setTelegramLoading] = useState(true);
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramSettings, setTelegramSettings] = useState<TelegramSettingsPayload | null>(null);

  useEffect(() => {
    void loadTelegramSettings();
    void loadGoogleStatus();
  }, []);

  async function loadGoogleStatus() {
    const response = await apiFetch('/api/google');
    const data = (await response.json().catch(() => ({}))) as GoogleIntegrationSummary;

    if (!response.ok) {
      setGoogleStatus(null);
      setConnectStatus(data.error || 'Failed to load Google connection status');
      return;
    }

    setGoogleStatus(data);
  }

  async function loadTelegramSettings() {
    setTelegramLoading(true);
    const response = await apiFetch('/api/openclaw/telegram');
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setTelegramSettings(null);
      setTelegramStatus(data.message || 'Failed to load Telegram settings');
      setTelegramLoading(false);
      return;
    }

    setTelegramSettings(data);
    setTelegramStatus('');
    setTelegramLoading(false);
  }

  async function handleGoogleConnect() {
    try {
      setConnectStatus('');
      await beginGoogleConnect('/settings/notifications');
    } catch (error) {
      setConnectStatus(error instanceof Error ? error.message : 'Failed to start Google connection');
    }
  }

  async function handleTelegramApprove() {
    if (!telegramCode.trim()) {
      setTelegramStatus('Paste the pairing code from Telegram first.');
      return;
    }

    setTelegramSaving(true);
    const response = await apiFetch('/api/openclaw/telegram/approve', {
      method: 'POST',
      body: JSON.stringify({
        code: telegramCode.trim(),
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setTelegramStatus(data.message || 'Failed to approve Telegram pairing');
      setTelegramSaving(false);
      return;
    }

    setTelegramSettings(data);
    setTelegramCode('');
    setTelegramStatus('Telegram is now linked to your StudyClaw agent.');
    setTelegramSaving(false);
  }

  return (
    <SettingsDetailShell
      badge="Notification Settings"
      title="Control where your agent can reach you."
      description="This screen covers messaging and calendar-connected notification surfaces so the top-level Settings page stays focused on navigation."
    >
      <SettingsStatus status={status} probe={snapshot?.diagnostics.channelsProbe} />
      {connectStatus ? <StatusBanner tone="danger">{connectStatus}</StatusBanner> : null}
      {telegramStatus ? (
        <StatusBanner tone={telegramStatus.toLowerCase().includes('failed') || telegramStatus.toLowerCase().includes('required') ? 'danger' : 'neutral'}>
          {telegramStatus}
        </StatusBanner>
      ) : null}

      <section className="secondary-card">
        <p className="eyebrow">Connected services</p>
        <p className="muted-copy" style={{ marginTop: 10 }}>
          Use onboarding to update your base model access, and connect Google services if you want reminders and schedule-aware workflows.
        </p>
        <div className="settings-stack compact" style={{ marginTop: 14 }}>
          <div className="settings-row">
            <span className="muted-copy">Google Calendar / Drive</span>
            <strong>
              {googleStatus?.connected
                ? googleStatus.googleEmail || googleStatus.account || 'Connected'
                : googleStatus?.status === 'reconnect_required'
                  ? 'Reconnect needed'
                  : 'Not connected'}
            </strong>
          </div>
          {googleStatus?.error ? (
            <p className="muted-copy" style={{ marginTop: 8 }}>
              Connection detail: {googleStatus.error}
            </p>
          ) : null}
        </div>
        <div className="actions" style={{ marginTop: 14 }}>
          <a href="/onboarding" className="ghost-button">Change model or API key</a>
          <button type="button" className="ghost-button" onClick={() => void handleGoogleConnect()}>
            {googleStatus?.connected
              ? 'Reconnect Google Calendar/Drive'
              : googleStatus?.status === 'reconnect_required'
                ? 'Reconnect Google Calendar/Drive'
                : 'Connect Google Calendar/Drive'}
          </button>
        </div>
      </section>

      <section className="secondary-card">
        <p className="eyebrow">Telegram pairing</p>
        {telegramLoading ? (
          <p className="muted-copy" style={{ marginTop: 12 }}>Loading Telegram settings...</p>
        ) : !telegramSettings?.available ? (
          <p className="muted-copy" style={{ marginTop: 12 }}>
            {telegramSettings?.message || 'Choose Dixie or Willow during onboarding to unlock Telegram access.'}
          </p>
        ) : (
          <>
            <div className="settings-row" style={{ marginTop: 14 }}>
              <div>
                <strong>{telegramSettings.personaName} on Telegram</strong>
                <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                  Message <strong>{telegramSettings.botUsername}</strong> to continue talking to your agent outside the app.
                </p>
              </div>
              <span className={`settings-badge ${telegramSettings.paired ? 'is-live' : ''}`}>
                {telegramSettings.paired ? 'Paired' : 'Needs pairing'}
              </span>
            </div>

            <div className="settings-stack compact" style={{ marginTop: 14 }}>
              <div className="settings-row">
                <span className="muted-copy">Telegram channel</span>
                <strong>{telegramSettings.channelEnabled ? 'Enabled' : 'Disabled'}</strong>
              </div>
              <div className="settings-row">
                <span className="muted-copy">Bot account</span>
                <strong>{telegramSettings.accountConfigured ? 'Configured' : 'Missing token/config'}</strong>
              </div>
              <div className="settings-row">
                <span className="muted-copy">DM policy</span>
                <strong>{telegramSettings.dmPolicy || 'pairing'}</strong>
              </div>
              {telegramSettings.paired && telegramSettings.boundPeerId ? (
                <div className="settings-row">
                  <span className="muted-copy">Linked Telegram peer</span>
                  <strong>{telegramSettings.boundPeerId}</strong>
                </div>
              ) : null}
            </div>

            <div className="form-grid" style={{ marginTop: 18 }}>
              <div className="form-field">
                <label htmlFor="telegram-pairing-code">Telegram pairing code</label>
                <input
                  id="telegram-pairing-code"
                  value={telegramCode}
                  onChange={(event) => setTelegramCode(event.target.value.toUpperCase())}
                  placeholder="ABCD1234"
                />
              </div>
            </div>

            <p className="muted-copy" style={{ marginTop: 12 }}>
              1. Open Telegram and message {telegramSettings.botUsername}.
              {' '}
              2. Send any message or <strong>/start</strong>.
              {' '}
              3. Paste the pairing code you receive here.
              {' '}
              4. After approval, your Telegram DMs will route to your own StudyClaw agent.
            </p>

            <div className="actions" style={{ marginTop: 14 }}>
              <button
                type="button"
                onClick={() => void handleTelegramApprove()}
                disabled={telegramSaving || !telegramSettings.channelEnabled || !telegramSettings.accountConfigured}
              >
                {telegramSaving ? 'Approving...' : telegramSettings.paired ? 'Update Telegram link' : 'Approve Telegram'}
              </button>
              <button type="button" className="ghost-button" onClick={() => void loadTelegramSettings()}>
                Refresh Telegram status
              </button>
            </div>
          </>
        )}
      </section>

      <section className="secondary-card">
        <p className="eyebrow">Messaging channels</p>
        <div className="settings-stack" style={{ marginTop: 14 }}>
          {(snapshot?.channels ?? []).filter((channel) => channel.id !== 'whatsapp').map((channel) => (
            <article className="gateway-channel-card" key={channel.id}>
              <div className="gateway-channel-head">
                <div>
                  <h3 style={{ margin: 0 }}>{channel.label}</h3>
                  <p className="muted-copy" style={{ margin: '6px 0 0' }}>
                    {channel.enabled ? 'Enabled' : 'Disabled'}
                    {' · '}
                    Auth: {channel.authConfigured ? 'Configured' : 'Missing'}
                    {' · '}
                    Probe: {channel.capabilities.probe}
                  </p>
                </div>
                <span className={`settings-badge ${channel.enabled ? 'is-live' : ''}`}>
                  {channel.enabled ? 'Live' : 'Off'}
                </span>
              </div>

              <div className="settings-pill-row">
                {channel.capabilities.support.length ? (
                  channel.capabilities.support.slice(0, 8).map((item) => (
                    <span className="settings-pill" key={`${channel.id}-support-${item}`}>
                      {item}
                    </span>
                  ))
                ) : (
                  <span className="settings-pill muted">No live capability data</span>
                )}
              </div>

              <div className="settings-stack compact">
                {channel.settings.length ? (
                  channel.settings.map((setting) => (
                    <div className="settings-row" key={`${channel.id}-${setting.key}`}>
                      <span className="muted-copy">{setting.key}</span>
                      <strong>{setting.value}</strong>
                    </div>
                  ))
                ) : (
                  <p className="muted-copy">No safe settings are configured for this channel yet.</p>
                )}
              </div>

              <p className="muted-copy" style={{ margin: '12px 0 0' }}>
                Actions: {channel.capabilities.actions.length ? channel.capabilities.actions.join(', ') : 'Unavailable'}
              </p>
            </article>
          ))}
        </div>
      </section>
    </SettingsDetailShell>
  );
}
