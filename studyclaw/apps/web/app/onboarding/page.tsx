'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '../../lib/api';
import { isOnboardingComplete, readStoredSession, writeStoredSession } from '../../lib/session';
import { consumePayloadFromUrl } from '../../lib/consumePayload';

const ONBOARDING_DRAFT_KEY = 'studyclaw-onboarding-draft';

const AGENTS = [
  {
    key: 'quick_start_2',
    name: 'Willow',
    emoji: '🌿',
    tagline: 'Calm & Conceptual',
    description: 'Patient, thorough explanations. Builds deep understanding at your own pace with analogies and reflective questions.',
    traits: ['Calm tone', 'Thorough', 'Conceptual teaching', 'Gentle reminders'],
    color: 'from-emerald-500/20 to-teal-500/20',
    border: 'border-emerald-500/40',
    badge: 'bg-emerald-500/20 text-emerald-300',
  },
  {
    key: 'quick_start_1',
    name: 'Dixie',
    emoji: '⚡',
    tagline: 'Energetic & Action-Oriented',
    description: 'High-energy sprint coach. Breaks work into focused sessions, keeps you on track, and celebrates your wins.',
    traits: ['Energetic tone', 'Concise', 'Active recall', 'Push reminders'],
    color: 'from-orange-500/20 to-amber-500/20',
    border: 'border-orange-500/40',
    badge: 'bg-orange-500/20 text-orange-300',
  },
];

const TEST_TIERS = [
  { key: 'tier_1', label: 'Tier 1', credits: 1000, detail: '1000 starting credits' },
  { key: 'tier_2', label: 'Tier 2', credits: 2000, detail: '2000 starting credits' },
  { key: 'tier_3', label: 'Tier 3', credits: 3000, detail: '3000 starting credits' },
] as const;

const DEFAULT_MODELS = [
  {
    key: 'openrouter/auto',
    name: 'OpenRouter Auto',
    provider: 'openrouter',
    oauthAvailable: false,
    isFree: true,
  },
  {
    key: 'openrouter/free',
    name: 'OpenRouter Free',
    provider: 'openrouter',
    oauthAvailable: false,
    isFree: true,
  },
  {
    key: 'ollama/lfm2.5-thinking:latest',
    name: 'LFM 2.5 Thinking',
    provider: 'ollama',
    oauthAvailable: false,
    isFree: true,
  },
  {
    key: 'minimax/MiniMax-M2.7',
    name: 'MiniMax M2.7 (configured)',
    provider: 'minimax',
    oauthAvailable: false,
    isFree: false,
  },
  {
    key: 'minimax/MiniMax-M2.5',
    name: 'MiniMax M2.5 (configured)',
    provider: 'minimax',
    oauthAvailable: false,
    isFree: false,
  },
  {
    key: 'openai-codex/gpt-5.3-codex',
    name: 'GPT-5.3 Codex',
    provider: 'openai-codex',
    oauthAvailable: false,
    isFree: false,
  },
] as const;

type OnboardingModelOption = {
  key: string;
  name: string;
  provider: string;
  oauthAvailable?: boolean;
  isFree?: boolean;
};

function mergeModelOptions(models: OnboardingModelOption[]) {
  const priority = new Map<string, number>([
    ['minimax/MiniMax-M2.7', 0],
    ['minimax/MiniMax-M2.5', 1],
    ['openrouter/auto', 2],
    ['openrouter/free', 3],
    ['ollama/lfm2.5-thinking:latest', 4],
  ]);

  return Array.from(
    models.reduce((acc, model) => {
      if (!model?.key) {
        return acc;
      }

      const current = acc.get(model.key);
      acc.set(model.key, current ? { ...current, ...model } : model);
      return acc;
    }, new Map<string, OnboardingModelOption>())
  )
    .map(([, model]) => model)
    .sort((left, right) => {
      const leftPriority = priority.get(left.key) ?? 100;
      const rightPriority = priority.get(right.key) ?? 100;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      if (!!left.isFree !== !!right.isFree) {
        return left.isFree ? -1 : 1;
      }

      if (left.provider !== right.provider) {
        return left.provider.localeCompare(right.provider);
      }

      return left.name.localeCompare(right.name);
    });
}

function isValidPreset(value: string): value is 'quick_start_1' | 'quick_start_2' {
  return value === 'quick_start_1' || value === 'quick_start_2';
}

function readOnboardingDraft() {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(ONBOARDING_DRAFT_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as {
      selectedAgent?: 'quick_start_1' | 'quick_start_2';
      selectedTier?: 'tier_1' | 'tier_2' | 'tier_3';
    };
  } catch {
    window.localStorage.removeItem(ONBOARDING_DRAFT_KEY);
    return null;
  }
}

function writeOnboardingDraft(draft: { selectedAgent?: string; selectedTier?: string }) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(draft));
}

function clearOnboardingDraft() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(ONBOARDING_DRAFT_KEY);
}

function OnboardingPageContent() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [models, setModels] = useState<OnboardingModelOption[]>(() => mergeModelOptions([...DEFAULT_MODELS]));
  const [modelKey, setModelKey] = useState('openrouter/auto');
  const [apiKey, setApiKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [existingCredential, setExistingCredential] = useState<{ providerId?: string; hasApiKey?: boolean } | null>(null);
  const [miniMaxAccessMode, setMiniMaxAccessMode] = useState<'managed' | 'byok'>('managed');
  const [selectedTier, setSelectedTier] = useState<'tier_1' | 'tier_2' | 'tier_3' | null>(null);
  const [tierStatus, setTierStatus] = useState('');
  const searchParams = useSearchParams();

  useEffect(() => {
    consumePayloadFromUrl(searchParams);
    
    const parsed = readStoredSession();
    if (!parsed?.user) { router.push('/auth?mode=login'); return; }
    if (isOnboardingComplete(parsed)) { router.push('/dashboard'); return; }

    void Promise.allSettled([
      apiFetch('/api/onboarding/options'),
      apiFetch('/api/onboarding/status'),
    ])
      .then(async ([optionsResult, statusResult]) => {
        const optionsData =
          optionsResult.status === 'fulfilled' && optionsResult.value.ok
            ? await optionsResult.value.json().catch(() => null)
            : null;
        const statusData =
          statusResult.status === 'fulfilled' && statusResult.value.ok
            ? await statusResult.value.json().catch(() => null)
            : null;
        const nextModels = mergeModelOptions([...(optionsData?.models ?? []), ...DEFAULT_MODELS]);
        const savedPreset = statusData?.agent?.preset_key ?? statusData?.agent?.agent_type ?? '';
        const draft = readOnboardingDraft();

        setModels(nextModels);
        setExistingCredential(statusData?.credentials ?? null);
        setSelectedAgent(
          draft?.selectedAgent && isValidPreset(draft.selectedAgent)
            ? draft.selectedAgent
            : isValidPreset(savedPreset)
              ? savedPreset
              : ''
        );
        setMiniMaxAccessMode(statusData?.usageProfile?.billingMode === 'byok' ? 'byok' : 'managed');
        setSelectedTier(
          draft?.selectedTier === 'tier_1' ||
          draft?.selectedTier === 'tier_2' ||
          draft?.selectedTier === 'tier_3'
            ? draft.selectedTier
            : statusData?.usageProfile?.tier === 'tier_1' ||
              statusData?.usageProfile?.tier === 'tier_2' ||
              statusData?.usageProfile?.tier === 'tier_3'
            ? statusData.usageProfile.tier
            : null
        );

        const preferredModel =
          nextModels.find((model: { key: string }) => model.key === statusData?.agent?.model_key) ??
          nextModels.find((model: { key: string }) => model.key === 'openrouter/auto') ??
          nextModels.find((model: { key: string }) => model.key === 'openrouter/free') ??
          nextModels.find((model: { key: string }) => model.key === 'ollama/lfm2.5-thinking:latest') ??
          nextModels.find((model: { provider: string }) => model.provider === 'openrouter') ??
          nextModels[0];
        if (preferredModel) {
          setModelKey(preferredModel.key);
        }
      })
      .catch(() => {
        setModels(mergeModelOptions([...DEFAULT_MODELS]));
        setModelKey((current) => current || 'openrouter/auto');
      });
  }, [router, searchParams]);

  const handleAgentSelect = (key: string) => {
    setSelectedAgent(key);
    setError('');
    writeOnboardingDraft({
      selectedAgent: key,
      selectedTier: selectedTier ?? undefined,
    });
  };

  const handleTierSelect = async (tier: 'tier_1' | 'tier_2' | 'tier_3') => {
    setSelectedTier(tier);
    setTierStatus('Saving tier...');
    setError('');
    try {
      const response = await apiFetch('/api/onboarding/testing-tier', {
        method: 'POST',
        body: JSON.stringify({ tier }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setTierStatus(data?.message ?? 'Failed to save tier');
        return;
      }

      const stored = readStoredSession();
      if (stored) {
        writeStoredSession({
          ...stored,
          usageProfile: data?.usageProfile ?? stored.usageProfile ?? null,
        });
      }
      writeOnboardingDraft({
        selectedAgent: selectedAgent || undefined,
        selectedTier: tier,
      });
      setTierStatus(`${TEST_TIERS.find((item) => item.key === tier)?.label} saved for onboarding testing.`);
    } catch {
      setTierStatus('Failed to save tier');
    }
  };

  const handleNext = () => {
    if (!selectedTier) { setError('Choose a temporary testing tier before continuing.'); return; }
    if (!selectedAgent) { setError('Please choose your study companion to continue.'); return; }
    setStep(2);
  };

  const handleSubmit = async () => {
    if (!modelKey) { setError('Please select a model provider.'); return; }
    if (requiresApiKey && !apiKey.trim()) { setError('API key is required to activate your agent.'); return; }
    const effectiveAgentPreset = isValidPreset(selectedAgent) ? selectedAgent : 'quick_start_2';
    setIsSubmitting(true);
    setError('');
    try {
      const res = await apiFetch('/api/onboarding/model-config', {
        method: 'POST',
        body: JSON.stringify({
          modelKey,
          apiKey: apiKey.trim(),
          agentPreset: effectiveAgentPreset,
          usageMode: isManagedConfiguredMiniMax ? miniMaxAccessMode : undefined,
        }),
      });
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) { setError(data?.message ?? 'Setup failed. Please try again.'); return; }

      const session = readStoredSession();
      if (session) {
        writeStoredSession({
          ...session,
          user: {
            ...session.user,
            agent_type: effectiveAgentPreset,
          },
          onboardingComplete: true,
          usageProfile: data?.usageProfile ?? session.usageProfile ?? null,
        });
      }
      clearOnboardingDraft();

      router.push('/dashboard');
    } catch (e) {
      setError('Connection error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedModel = models.find(m => m.key === modelKey);
  const isManagedConfiguredMiniMax =
    selectedModel?.provider === 'minimax' &&
    (selectedModel.key === 'minimax/MiniMax-M2.7' || selectedModel.key === 'minimax/MiniMax-M2.5');
  const hasSavedCredential =
    !!existingCredential?.hasApiKey &&
    existingCredential?.providerId === selectedModel?.provider &&
    !(isManagedConfiguredMiniMax && miniMaxAccessMode === 'managed');
  const requiresApiKey =
    selectedModel?.provider !== 'ollama' &&
    !(isManagedConfiguredMiniMax && miniMaxAccessMode === 'managed') &&
    !hasSavedCredential;

  const handleOpenRouterConnect = () => {
    const openRouterModel =
      models.find((model) => model.key === 'openrouter/auto') ??
      models.find((model) => model.provider === 'openrouter') ??
      null;
    if (openRouterModel) {
      setModelKey(openRouterModel.key);
    }
    setError('');
    window.open('https://openrouter.ai/keys', '_blank', 'noopener,noreferrer');
  };

  const handleMiniMaxConnect = () => {
    const miniMaxModel = models.find((model) => model.provider === 'minimax') ?? null;
    if (miniMaxModel) {
      setModelKey(miniMaxModel.key);
    }
    setError('');
    window.open('https://platform.minimaxi.com/user-center/basic-information/interface-key', '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="onboarding-shell">
      <header className="onboarding-header">
        <div>
          <p className="onboarding-header__eyebrow">StudyClaw onboarding</p>
          <h1 className="onboarding-header__title">
            {step === 1 ? 'Choose your study companion and testing tier.' : 'Connect the model setup that will power your agent.'}
          </h1>
          <p className="onboarding-header__description">
            This setup flow creates your StudyClaw workspace, ties in your model access, and gets your account ready for real study sessions.
          </p>
        </div>
        <div className="onboarding-header__brand">
          <strong>🦀 StudyClaw</strong>
          <span>Focused study help, configured once.</span>
        </div>
      </header>

      <section className="onboarding-layout">
        <aside className="onboarding-sidebar">
          <div className="onboarding-progress-card">
            <p className="eyebrow">Progress</p>
            <div className="onboarding-progress-steps">
              <div className={`onboarding-progress-step ${step >= 1 ? 'is-active' : ''}`}>
                <span>1</span>
                <div>
                  <strong>Tier + companion</strong>
                  <p>Pick a testing tier and the study style you want.</p>
                </div>
              </div>
              <div className={`onboarding-progress-step ${step >= 2 ? 'is-active' : ''}`}>
                <span>2</span>
                <div>
                  <strong>Model connection</strong>
                  <p>Choose how StudyClaw should power your agent.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="onboarding-summary-card">
            <p className="eyebrow">Current setup</p>
            <div className="onboarding-summary-row">
              <span>Tier</span>
              <strong>{selectedTier ? TEST_TIERS.find((tier) => tier.key === selectedTier)?.label : 'Not selected'}</strong>
            </div>
            <div className="onboarding-summary-row">
              <span>Companion</span>
              <strong>{selectedAgent ? AGENTS.find((agent) => agent.key === selectedAgent)?.name : 'Not selected'}</strong>
            </div>
            <div className="onboarding-summary-row">
              <span>Model</span>
              <strong>{selectedModel?.name ?? 'Choose at step 2'}</strong>
            </div>
          </div>

          <div className="onboarding-helper-card">
            <p className="eyebrow">What this affects</p>
            <p className="muted-copy">
              Your companion shapes tone and teaching style. Your model setup controls how StudyClaw actually runs chat, coaching, reminders, and study tools.
            </p>
          </div>
        </aside>

        <main className="onboarding-main">
          {step === 1 ? (
            <div className="onboarding-panel">
              <div className="onboarding-panel__head">
                <div>
                  <p className="eyebrow">Step 1</p>
                  <h2 className="section-title">Choose your testing tier and companion</h2>
                </div>
              </div>

              <section className="onboarding-tier-section">
                <div className="onboarding-section-copy">
                  <strong>Temporary testing tier</strong>
                  <p>This writes a real tier to the backend immediately and seeds the account with a live test credit balance.</p>
                </div>
                <div className="onboarding-tier-grid">
                  {TEST_TIERS.map((tier) => (
                    <button
                      key={tier.key}
                      type="button"
                      onClick={() => void handleTierSelect(tier.key)}
                      className={`onboarding-tier-card${selectedTier === tier.key ? ' is-active' : ''}`}
                    >
                      <strong>{tier.label}</strong>
                      <span>{tier.detail}</span>
                    </button>
                  ))}
                </div>
                <p className="onboarding-status-copy">
                  {tierStatus || 'Select one tier to persist it in the database before continuing.'}
                </p>
              </section>

              <section className="onboarding-agent-section">
                <div className="onboarding-section-copy">
                  <strong>Pick your study companion</strong>
                  <p>This becomes the default teaching personality tied to your account.</p>
                </div>
                <div className="onboarding-agent-grid">
                  {AGENTS.map((agent) => (
                    <button
                      key={agent.key}
                      onClick={() => handleAgentSelect(agent.key)}
                      className={`onboarding-agent-card${selectedAgent === agent.key ? ' is-active' : ''}`}
                    >
                      <div className="onboarding-agent-card__badge-row">
                        <span className="onboarding-agent-card__emoji">{agent.emoji}</span>
                        <span className="onboarding-agent-card__tag">{agent.tagline}</span>
                      </div>
                      <strong>{agent.name}</strong>
                      <p>{agent.description}</p>
                      <ul>
                        {agent.traits.map((trait) => (
                          <li key={trait}>{trait}</li>
                        ))}
                      </ul>
                    </button>
                  ))}
                </div>
              </section>

              {error ? <p className="onboarding-error">{error}</p> : null}

              <div className="onboarding-actions">
                <button
                  onClick={handleNext}
                  disabled={!selectedAgent || !selectedTier}
                >
                  {selectedAgent ? `Continue with ${AGENTS.find((agent) => agent.key === selectedAgent)?.name}` : 'Continue to provider setup'}
                </button>
              </div>
            </div>
          ) : (
            <div className="onboarding-panel">
              <div className="onboarding-panel__head">
                <div>
                  <p className="eyebrow">Step 2</p>
                  <h2 className="section-title">Connect your model setup</h2>
                </div>
                <button type="button" className="ghost-button" onClick={() => setStep(1)}>
                  Change companion
                </button>
              </div>

              <section className="onboarding-selection-card">
                <p className="eyebrow">Chosen companion</p>
                <div className="onboarding-selection-card__row">
                  <span className="onboarding-selection-card__emoji">{AGENTS.find((agent) => agent.key === selectedAgent)?.emoji}</span>
                  <div>
                    <strong>{AGENTS.find((agent) => agent.key === selectedAgent)?.name}</strong>
                    <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                      {AGENTS.find((agent) => agent.key === selectedAgent)?.tagline}
                    </p>
                  </div>
                </div>
              </section>

              <section className="onboarding-provider-card">
                <p className="eyebrow">Recommended setup</p>
                <strong>Connect OpenRouter for the fastest start</strong>
                <p className="muted-copy" style={{ marginTop: 10 }}>
                  StudyClaw needs a provider connection so your agent can chat, coach, generate study tools, and save your chosen model.
                  Google sign-in only unlocks your account. Calendar and Drive can be connected later in settings.
                </p>
                <button type="button" className="ghost-button" onClick={handleOpenRouterConnect}>
                  Connect OpenRouter
                </button>
              </section>

              <div className="onboarding-divider">
                <div />
                <p>Or bring your own model setup</p>
                <div />
              </div>

              <div className="form-field">
                <label htmlFor="onboarding-model-key">AI Provider &amp; Model</label>
                <select
                  id="onboarding-model-key"
                  value={modelKey}
                  onChange={(event) => {
                    const nextModelKey = event.target.value;
                    setModelKey(nextModelKey);
                    if (nextModelKey.startsWith('minimax/')) {
                      setMiniMaxAccessMode('managed');
                    }
                  }}
                >
                  {models.map((model) => (
                    <option key={model.key} value={model.key}>
                      {model.name} ({model.provider})
                    </option>
                  ))}
                </select>
              </div>

              {isManagedConfiguredMiniMax ? (
                <section className="onboarding-access-mode-card">
                  <p className="eyebrow">MiniMax access mode</p>
                  <p className="muted-copy" style={{ marginTop: 8 }}>
                    The configured MiniMax profiles can run on StudyClaw-managed credits, or you can switch to BYOK and use your own MiniMax key directly.
                  </p>
                  <div className="onboarding-access-mode-grid">
                    <button
                      type="button"
                      onClick={() => setMiniMaxAccessMode('managed')}
                      className={`onboarding-access-mode-option${miniMaxAccessMode === 'managed' ? ' is-active' : ''}`}
                    >
                      <strong>Use StudyClaw-managed credits</strong>
                      <span>No MiniMax key needed here. StudyClaw enforces your rolling quota server-side.</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMiniMaxAccessMode('byok')}
                      className={`onboarding-access-mode-option${miniMaxAccessMode === 'byok' ? ' is-active' : ''}`}
                    >
                      <strong>Bring your own MiniMax key</strong>
                      <span>Bypass StudyClaw credits and use MiniMax on your own provider account.</span>
                    </button>
                  </div>
                </section>
              ) : null}

              <div className="form-field">
                <label htmlFor="onboarding-api-key">
                  API Key {requiresApiKey ? <span className="onboarding-required">*</span> : <span className="muted-copy">(already saved or not needed)</span>}
                </label>
                {selectedModel?.provider === 'minimax' && miniMaxAccessMode === 'byok' ? (
                  <button
                    type="button"
                    onClick={handleMiniMaxConnect}
                    className="ghost-button onboarding-inline-action"
                  >
                    Get MiniMax API Key
                  </button>
                ) : null}
                <input
                  id="onboarding-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    setError('');
                  }}
                  placeholder={
                    selectedModel?.provider === 'ollama'
                      ? 'No API key needed for local Ollama'
                      : isManagedConfiguredMiniMax && miniMaxAccessMode === 'managed'
                        ? 'StudyClaw-managed MiniMax does not require a MiniMax key here'
                      : selectedModel?.provider === 'openrouter'
                        ? 'sk-or-v1-...'
                        : selectedModel?.provider === 'minimax'
                          ? 'Enter your MiniMax API key'
                        : 'Enter your API key'
                  }
                  disabled={!requiresApiKey}
                />
                <p className="onboarding-status-copy">
                  {isManagedConfiguredMiniMax && miniMaxAccessMode === 'managed'
                    ? 'StudyClaw will attach this account to a private internal usage identity and keep the real MiniMax API key on the server.'
                    : hasSavedCredential
                      ? 'You already have a saved key for this provider, so you do not need to enter it again.'
                      : requiresApiKey
                        ? 'Your key is encrypted and used only to power your own agent.'
                        : 'This model runs through your local Ollama setup, so no API key is required.'}
                </p>
              </div>

              {error ? <p className="onboarding-error">{error}</p> : null}

              <div className="onboarding-actions">
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || (requiresApiKey && !apiKey.trim()) || !modelKey}
                >
                  {isSubmitting ? 'Activating your agent...' : 'Launch StudyClaw'}
                </button>
              </div>
            </div>
          )}
        </main>
      </section>
    </section>
  );
}


export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <OnboardingPageContent />
    </Suspense>
  );
}
