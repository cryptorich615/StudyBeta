 'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import StatusBanner from '../components/status-banner';
import { apiFetch, beginGoogleConnect } from '../../lib/api';
import { readStoredSession } from '../../lib/session';
import {
  findPreset,
  GOOGLE_AI_STUDIO_URL,
  isGoogleAiStudioApiKey,
  PROVIDER_PRESETS,
} from '../../lib/model-setup';
import {
  type CronJobItem,
  type GoogleIntegrationSummary,
  type ManagedUsageAccountSummary,
  type ManagedUsageEventItem,
  type ModelSettingsPayload,
  type SavedModelConfig,
  type TelegramSettingsPayload,
  type UsageAccessProfile,
  SettingsDetailShell,
  SettingsStatus,
  formatNumber,
  formatTime,
  useSettingsSnapshot,
} from './settings-core';

export function ModelSettingsDetail() {
  const { loading, snapshot, status } = useSettingsSnapshot();
  const [modelStatus, setModelStatus] = useState('');
  const [modelSettings, setModelSettings] = useState<ModelSettingsPayload | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState('');
  const [savingModel, setSavingModel] = useState('');
  const [providerName, setProviderName] = useState('');
  const [serviceBaseUrl, setServiceBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('');
  const [maxContextWindow, setMaxContextWindow] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState('');
  const [selectedPresetKey, setSelectedPresetKey] = useState('');
  const [pasteStatus, setPasteStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [pasteMessage, setPasteMessage] = useState('');
  const [isPasteLoading, setIsPasteLoading] = useState(false);

  useEffect(() => {
    void loadModelSettings();
  }, []);

  function populateForm(config: SavedModelConfig | null) {
    if (!config) {
      return;
    }

    setSelectedConfigId(config.id);
    setProviderName(config.providerName);
    setServiceBaseUrl(config.serviceBaseUrl);
    setApiKey('');
    setModelName(config.modelName);
    setMaxContextWindow(config.maxContextWindow ? String(config.maxContextWindow) : '');
    setMaxOutputTokens(config.maxOutputTokens ? String(config.maxOutputTokens) : '');
    const matchedPreset = PROVIDER_PRESETS.find(
      (preset) =>
        preset.providerName.toLowerCase() === config.providerName.toLowerCase() &&
        preset.modelName === config.modelName &&
        preset.serviceBaseUrl === config.serviceBaseUrl
    );
    setSelectedPresetKey(matchedPreset?.key ?? '');
    setPasteStatus('idle');
    setPasteMessage('');
  }

  function seedNewModelForm(source?: SavedModelConfig | null) {
    setSelectedConfigId('');
    setProviderName(source?.providerName ?? '');
    setServiceBaseUrl(source?.serviceBaseUrl ?? '');
    setApiKey('');
    setModelName('');
    setMaxContextWindow(source?.maxContextWindow ? String(source.maxContextWindow) : '');
    setMaxOutputTokens(source?.maxOutputTokens ? String(source.maxOutputTokens) : '');
    setSelectedPresetKey('');
    setPasteStatus('idle');
    setPasteMessage('');
  }

  function applyProviderPreset(presetKey: string) {
    setSelectedPresetKey(presetKey);
    const preset = findPreset(presetKey);
    if (!preset) {
      return;
    }

    setSelectedConfigId('');
    setProviderName(preset.providerName);
    setServiceBaseUrl(preset.serviceBaseUrl);
    setModelName(preset.modelName);
    setMaxContextWindow('');
    setMaxOutputTokens('');
    setModelStatus(`${preset.label} preset loaded.`);
    setPasteStatus('idle');
    setPasteMessage('');
  }

  function handleOpenGoogleAiStudio() {
    applyProviderPreset('google-gemini');
    window.open(GOOGLE_AI_STUDIO_URL, '_blank', 'noopener,noreferrer');
  }

  async function handlePasteApiKey() {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      setPasteStatus('error');
      setPasteMessage('Clipboard paste is not available in this browser.');
      return;
    }

    setIsPasteLoading(true);
    setPasteStatus('idle');
    setPasteMessage('');
    setModelStatus('');

    try {
      const clipboardText = (await navigator.clipboard.readText()).trim();
      if (!clipboardText) {
        setPasteStatus('error');
        setPasteMessage('Clipboard is empty.');
        return;
      }

      setApiKey(clipboardText);

      if (isGoogleAiStudioApiKey(clipboardText)) {
        applyProviderPreset('google-gemini');
        setApiKey(clipboardText);
        setPasteMessage('Pasted! Google Gemini preset was selected automatically.');
      } else {
        setPasteMessage('Pasted! Keep the current preset or choose a different one below.');
      }

      setPasteStatus('success');
    } catch {
      setPasteStatus('error');
      setPasteMessage('Clipboard read failed. Paste the key manually if needed.');
    } finally {
      setIsPasteLoading(false);
    }
  }

  async function loadModelSettings(nextSelectedId?: string) {
    const response = await apiFetch('/api/openclaw/model-settings');
    const data = await response.json();

    if (!response.ok) {
      setModelStatus(data.message || 'Failed to load model settings');
      return;
    }

    setModelSettings(data);
    setModelStatus('');

    const targetId = nextSelectedId ?? data.selectedConfigId ?? data.activeConfigId ?? data.configs[0]?.id ?? '';
    const targetConfig = data.configs.find((config: SavedModelConfig) => config.id === targetId) ?? data.configs[0] ?? null;

    if (targetConfig) {
      populateForm(targetConfig);
    } else {
      seedNewModelForm();
    }
  }

  async function saveModelConfig(activate: boolean) {
    if (!providerName.trim() || !serviceBaseUrl.trim() || !modelName.trim()) {
      setModelStatus('Provider name, Service Base URL, and model name are required.');
      return;
    }

    setSavingModel(activate ? 'activate' : 'save');
    const response = await apiFetch('/api/openclaw/model-settings', {
      method: 'POST',
      body: JSON.stringify({
        configId: selectedConfigId || undefined,
        providerName: providerName.trim(),
        serviceBaseUrl: serviceBaseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        modelName: modelName.trim(),
        maxContextWindow: maxContextWindow.trim() || undefined,
        maxOutputTokens: maxOutputTokens.trim() || undefined,
        activate,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      setModelStatus(data.message || 'Failed to save model settings');
      setSavingModel('');
      return;
    }

    setApiKey('');
    setModelSettings(data);
    setModelStatus(activate ? 'Model settings saved and loaded.' : 'Model settings saved.');
    const targetId = data.selectedConfigId ?? data.activeConfigId ?? selectedConfigId ?? data.configs[0]?.id ?? '';
    const targetConfig = data.configs.find((config: SavedModelConfig) => config.id === targetId) ?? data.configs[0] ?? null;
    if (targetConfig) {
      populateForm(targetConfig);
    }
    setSavingModel('');
  }

  async function activateSelectedConfig() {
    if (!selectedConfigId) {
      setModelStatus('Select a saved model before loading it.');
      return;
    }

    setSavingModel('load');
    const response = await apiFetch(`/api/openclaw/model-settings/${encodeURIComponent(selectedConfigId)}/activate`, {
      method: 'POST',
    });
    const data = await response.json();

    if (!response.ok) {
      setModelStatus(data.message || 'Failed to load saved model');
      setSavingModel('');
      return;
    }

    setApiKey('');
    setModelSettings(data);
    setModelStatus('Saved model loaded.');
    const targetConfig = data.configs.find((config: SavedModelConfig) => config.id === (data.selectedConfigId ?? data.activeConfigId ?? selectedConfigId)) ?? null;
    if (targetConfig) {
      populateForm(targetConfig);
    }
    setSavingModel('');
  }

  return (
    <SettingsDetailShell
      badge="Model Settings"
      title="Manage the model setup behind your StudyClaw agent."
      description="This page holds provider-level setup and the model-specific usage summary that was previously mixed into the main settings screen."
    >
      <SettingsStatus status={status} probe={snapshot?.diagnostics.channelsProbe} />
      {modelStatus ? <StatusBanner tone={modelStatus.toLowerCase().includes('failed') ? 'danger' : 'neutral'}>{modelStatus}</StatusBanner> : null}

      <div className="card-grid">
        <section className="secondary-card">
          <p className="eyebrow">Saved model configs</p>
          <div className="form-field" style={{ marginTop: 12 }}>
            <label htmlFor="saved-model-config">Previously saved provider/model</label>
            <select
              id="saved-model-config"
              value={selectedConfigId}
              onChange={(event) => {
                const nextId = event.target.value;
                const nextConfig = modelSettings?.configs.find((config) => config.id === nextId) ?? null;
                if (nextConfig) {
                  populateForm(nextConfig);
                } else {
                  seedNewModelForm(modelSettings?.configs.find((config) => config.isActive) ?? null);
                }
              }}
            >
              <option value="">Select a saved model</option>
              {(modelSettings?.configs ?? []).map((config) => (
                <option key={config.id} value={config.id}>
                  {config.label}{config.isActive ? ' (active)' : ''}{!config.isFunctional ? ' (needs key)' : ''}
                </option>
              ))}
            </select>
          </div>
          <p className="muted-copy" style={{ marginTop: 10 }}>
            Loading a saved config prefills the form below so the user can keep the suggested values or customize them before saving again.
          </p>
          <div className="actions">
            <button type="button" onClick={() => void activateSelectedConfig()} disabled={!selectedConfigId || savingModel === 'load'}>
              {savingModel === 'load' ? 'Loading...' : 'Load selected model'}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => seedNewModelForm(modelSettings?.configs.find((config) => config.isActive) ?? null)}
            >
              Add new model
            </button>
          </div>
        </section>

        <section className="secondary-card">
          <p className="eyebrow">Usage snapshot</p>
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
              <strong>{loading ? '...' : snapshot?.usage.models.length ?? 0}</strong>
              <span>Models used</span>
            </div>
          </div>
          {modelSettings?.accessProfile ? (
            <div className="settings-stack compact" style={{ marginTop: 16 }}>
              <div className="settings-row">
                <span className="muted-copy">Billing mode</span>
                <strong>{modelSettings.accessProfile.billingMode}</strong>
              </div>
              <div className="settings-row">
                <span className="muted-copy">Tier</span>
                <strong>{modelSettings.accessProfile.tier ?? 'n/a'}</strong>
              </div>
              <div className="settings-row">
                <span className="muted-copy">Managed usage</span>
                <strong>{modelSettings.accessProfile.isManaged ? 'Active' : modelSettings.accessProfile.isByok ? 'BYOK' : 'Not managed'}</strong>
              </div>
              <div className="settings-row">
                <span className="muted-copy">Rolling window</span>
                <strong>
                  {modelSettings.accessProfile.windowLimit === null
                    ? 'Not limited'
                    : `${modelSettings.accessProfile.usedInWindow}/${modelSettings.accessProfile.windowLimit} used`}
                </strong>
              </div>
              {modelSettings.accessProfile.remainingInWindow !== null ? (
                <div className="settings-row">
                  <span className="muted-copy">Remaining</span>
                  <strong>{modelSettings.accessProfile.remainingInWindow}</strong>
                </div>
              ) : null}
              {modelSettings.accessProfile.creditsRemaining !== null ? (
                <div className="settings-row">
                  <span className="muted-copy">Credits remaining</span>
                  <strong>{modelSettings.accessProfile.creditsRemaining}</strong>
                </div>
              ) : null}
              {modelSettings.accessProfile.internalUsageIdentity ? (
                <div className="settings-row">
                  <span className="muted-copy">Internal identity</span>
                  <strong>{modelSettings.accessProfile.internalUsageIdentity}</strong>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <section className="secondary-card">
        <p className="eyebrow">Quick setup</p>
        <div className="provider-setup-card">
          <div className="provider-setup-card__header">
            <div className="provider-setup-card__icon" aria-hidden="true">🔑</div>
            <div>
              <strong>Open Google AI Studio</strong>
              <p className="muted-copy" style={{ marginTop: 8 }}>
                If you skipped this during onboarding, generate a Gemini key in AI Studio and bring it back here.
              </p>
            </div>
          </div>

          <div className="provider-setup-card__actions">
            <button type="button" className="provider-setup-card__primary" onClick={handleOpenGoogleAiStudio}>
              Open Google AI Studio
            </button>
            <button
              type="button"
              className="provider-setup-card__secondary"
              onClick={() => void handlePasteApiKey()}
              disabled={isPasteLoading}
            >
              {isPasteLoading ? 'Reading clipboard...' : pasteStatus === 'success' ? '✓ Pasted!' : '📋 Paste'}
            </button>
          </div>

          <ol className="provider-setup-card__steps">
            <li>Click <strong>Open Google AI Studio</strong>.</li>
            <li>Open or sign into AI Studio in the new tab.</li>
            <li>Create an API key and copy it.</li>
            <li>Return here and click <strong>📋 Paste</strong>.</li>
          </ol>

          <div className="provider-setup-card__footer">
            <p>AIza... keys auto-select the Google Gemini preset and fill the API key field.</p>
            <p>For OpenRouter or any other provider, use the preset dropdown below or keep your current saved model.</p>
          </div>
        </div>
      </section>

      <section className="secondary-card">
        <p className="eyebrow">Provider and model form</p>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="provider-preset">Quick provider preset</label>
            <select
              id="provider-preset"
              value={selectedPresetKey}
              onChange={(event) => {
                const nextPreset = event.target.value;
                if (!nextPreset) {
                  setSelectedPresetKey('');
                  return;
                }
                applyProviderPreset(nextPreset);
              }}
            >
              <option value="">Choose a preset</option>
              {PROVIDER_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.label}
                </option>
              ))}
            </select>
            <p className="form-help">
              Pick a preset for Google Gemini, OpenRouter, MiniMax, or Ollama. You can still edit every field below.
            </p>
          </div>
          <div className="form-field">
            <label htmlFor="provider-name">Provider name</label>
            <input
              id="provider-name"
              value={providerName}
              onChange={(event) => setProviderName(event.target.value)}
              placeholder="OpenRouter"
            />
          </div>
          <div className="form-field">
            <label htmlFor="service-base-url">Service Base URL</label>
            <input
              id="service-base-url"
              value={serviceBaseUrl}
              onChange={(event) => setServiceBaseUrl(event.target.value)}
              placeholder="https://openrouter.ai/api/v1"
            />
          </div>
          <div className="form-field">
            <label htmlFor="api-key">API Key</label>
            <div className="api-key-input-wrap">
              <input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setPasteStatus('idle');
                  setPasteMessage('');
                }}
                placeholder={
                  providerName.trim().toLowerCase() === 'google'
                    ? 'AIza...'
                    : 'Leave blank to keep a stored key for this provider'
                }
              />
              <button
                type="button"
                className="api-key-clipboard-button"
                onClick={() => void handlePasteApiKey()}
                disabled={isPasteLoading}
              >
                {isPasteLoading ? '...' : pasteStatus === 'success' ? '✓ Pasted!' : '📋 Paste'}
              </button>
            </div>
            {pasteMessage ? <p className={`form-status${pasteStatus === 'error' ? ' is-error' : ''}`}>{pasteMessage}</p> : null}
          </div>
          <div className="form-field">
            <label htmlFor="model-name">Model name</label>
            <input
              id="model-name"
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
              placeholder="auto"
            />
          </div>
          <div className="form-field">
            <label htmlFor="max-context-window">Max Context Window</label>
            <input
              id="max-context-window"
              inputMode="numeric"
              value={maxContextWindow}
              onChange={(event) => setMaxContextWindow(event.target.value)}
              placeholder="200000"
            />
          </div>
          <div className="form-field">
            <label htmlFor="max-output-tokens">Max Output Tokens</label>
            <input
              id="max-output-tokens"
              inputMode="numeric"
              value={maxOutputTokens}
              onChange={(event) => setMaxOutputTokens(event.target.value)}
              placeholder="8192"
            />
          </div>
        </div>
        <p className="muted-copy" style={{ marginTop: 14 }}>
          Required: provider name, Service Base URL, and model name. API key is optional here and will be reused automatically for the same provider when one is already stored.
        </p>
        {selectedConfigId && modelSettings?.configs.find((config) => config.id === selectedConfigId)?.hasApiKey ? (
          <p className="muted-copy" style={{ marginTop: 8 }}>
            A stored API key already exists for this saved config. Leave the API key field blank to keep it.
          </p>
        ) : null}
        <div className="actions">
          <button type="button" onClick={() => void saveModelConfig(false)} disabled={savingModel === 'save' || savingModel === 'activate'}>
            {savingModel === 'save' ? 'Saving...' : selectedConfigId ? 'Save changes' : 'Save model'}
          </button>
          <button type="button" onClick={() => void saveModelConfig(true)} disabled={savingModel === 'save' || savingModel === 'activate'}>
            {savingModel === 'activate' ? 'Saving and loading...' : 'Save and load'}
          </button>
          <a href="/onboarding" className="ghost-button">Open onboarding</a>
        </div>
      </section>

      <section className="secondary-card">
        <p className="eyebrow">Model usage</p>
        <div className="settings-stack" style={{ marginTop: 14 }}>
          {(snapshot?.usage.models ?? []).length ? (
            snapshot?.usage.models.map((item) => (
              <div className="settings-row" key={item.model}>
                <div>
                  <strong>{item.model}</strong>
                  <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                    {item.sessions} session{item.sessions === 1 ? '' : 's'}
                  </p>
                </div>
                <span className="settings-badge">{formatNumber(item.totalTokens)} tokens</span>
              </div>
            ))
          ) : (
            <p className="muted-copy">No session usage has been recorded for this personal agent yet.</p>
          )}
        </div>
      </section>
    </SettingsDetailShell>
  );
}
