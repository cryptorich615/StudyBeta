'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '../../lib/api';
import { isOnboardingComplete, readStoredSession, writeStoredSession } from '../../lib/session';
import { consumePayloadFromUrl } from '../../lib/consumePayload';
import {
  findGoogleGeminiModelKey,
  GOOGLE_AI_STUDIO_URL,
  GOOGLE_GEMINI_MODEL_KEY,
  ONBOARDING_PROVIDER_CARDS,
  PROVIDER_PRESETS,
  isGoogleAiStudioApiKey,
} from '../../lib/model-setup';

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
  { key: 'tier_2', label: 'Tier 2', credits: 3000, detail: '3000 starting credits' },
  { key: 'tier_3', label: 'Tier 3', credits: 5000, detail: '5000 starting credits' },
] as const;

const DEFAULT_MODELS = [
  {
    key: GOOGLE_GEMINI_MODEL_KEY,
    name: 'Gemini 3.1 Pro Preview',
    provider: 'google',
    oauthAvailable: false,
    isFree: true,
  },
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

const ONBOARDING_STEPS = [
  { step: 1, label: 'Tier' },
  { step: 2, label: 'Companion' },
  { step: 3, label: 'Model' },
] as const;

const CUSTOM_PROVIDER_BASE_URLS: Record<string, string> = {
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  openrouter: 'https://openrouter.ai/api/v1',
  minimax: 'https://api.minimax.io/anthropic',
  ollama: 'http://127.0.0.1:11434',
  openai: 'https://api.openai.com/v1',
  'openai-codex': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  xai: 'https://api.x.ai/v1',
};

type OnboardingModelOption = {
  key: string;
  name: string;
  provider: string;
  oauthAvailable?: boolean;
  isFree?: boolean;
};

function mergeModelOptions(models: OnboardingModelOption[]) {
  const priority = new Map<string, number>([
    [GOOGLE_GEMINI_MODEL_KEY, 0],
    ['openrouter/auto', 1],
    ['minimax/MiniMax-M2.7', 2],
    ['openrouter/free', 3],
    ['minimax/MiniMax-M2.5', 4],
    ['ollama/lfm2.5-thinking:latest', 5],
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

function normalizeProviderId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function resolveCustomServiceBaseUrl(providerName: string) {
  return CUSTOM_PROVIDER_BASE_URLS[normalizeProviderId(providerName)] ?? '';
}

function buildCustomModelKey(providerName: string, modelName: string) {
  const providerId = normalizeProviderId(providerName);
  const trimmedModel = modelName.trim();
  if (!providerId || !trimmedModel) {
    return '';
  }

  return `${providerId}/${trimmedModel}`;
}

function OnboardingProgressDots({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="onboarding-progress" aria-label="Onboarding progress">
      {ONBOARDING_STEPS.map((item) => (
        <span
          key={item.step}
          className={`onboarding-progress__dot${item.step === step ? ' is-active' : item.step < step ? ' is-complete' : ''}`}
          aria-current={item.step === step ? 'step' : undefined}
          title={item.label}
        />
      ))}
    </div>
  );
}

function providerLabel(providerId: string) {
  const normalized = providerId.trim().toLowerCase();
  return ONBOARDING_PROVIDER_CARDS.find((card) => card.providerName.toLowerCase() === normalized)?.label ?? providerId;
}

function OnboardingPageContent() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
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
  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; googleEmail?: string | null } | null>(null);
  const [pasteStatus, setPasteStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [pasteMessage, setPasteMessage] = useState('');
  const [isPasteLoading, setIsPasteLoading] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [customProviderName, setCustomProviderName] = useState('');
  const [customModelName, setCustomModelName] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
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
        setGoogleStatus(statusData?.google ?? null);
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
        setGoogleStatus(null);
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

  const handlePresetPrefill = (presetKey: string) => {
    const preset = PROVIDER_PRESETS.find((item) => item.key === presetKey);
    if (!preset) {
      return;
    }

    setIsAdvancedOpen(true);
    setCustomProviderName(preset.providerName);
    setCustomModelName(preset.modelName);
    if (preset.onboardingModelKey) {
      setModelKey(preset.onboardingModelKey);
    }
    setError('');
  };

  const handleProviderSelect = (providerKey: string) => {
    const providerCard = ONBOARDING_PROVIDER_CARDS.find((card) => card.key === providerKey);
    if (!providerCard) {
      return;
    }

    setModelKey(providerCard.onboardingModelKey);
    if (providerCard.key === 'minimax') {
      setMiniMaxAccessMode('managed');
    }
    setError('');
    setPasteStatus('idle');
    setPasteMessage('');
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    setError('');
    setPasteStatus('idle');
    setPasteMessage('');

    if (isGoogleAiStudioApiKey(value)) {
      setModelKey(findGoogleGeminiModelKey(models));
      setPasteStatus('success');
      setPasteMessage('Key detected automatically. StudyClaw switched your selection to Gemini.');
    }
  };

  const handleContinueFromTier = () => {
    if (!selectedTier) {
      setError('Choose a temporary testing tier before continuing.');
      return;
    }
    setError('');
    setStep(2);
  };

  const handleContinueFromCompanion = () => {
    if (!selectedAgent) {
      setError('Please choose your study companion to continue.');
      return;
    }
    setError('');
    setStep(3);
  };

  const handleSubmit = async () => {
    const usingAdvancedSetup = !!customProviderName.trim() || !!customModelName.trim() || !!customApiKey.trim();
    const customServiceBaseUrl = resolveCustomServiceBaseUrl(customProviderName);
    const customModelKey = buildCustomModelKey(customProviderName, customModelName);

    if (usingAdvancedSetup && (!customProviderName.trim() || !customModelName.trim() || !customApiKey.trim())) {
      setError('Complete all advanced provider fields or leave them blank to use the standard setup.');
      return;
    }
    if (usingAdvancedSetup && !customServiceBaseUrl) {
      setError('This provider is not supported in onboarding yet. Finish onboarding with a standard model, then add a fully custom endpoint in Model Settings.');
      return;
    }
    if (!usingAdvancedSetup && !modelKey) { setError('Please select a model provider.'); return; }
    if (!usingAdvancedSetup && requiresApiKey && !apiKey.trim()) { setError('API key is required to activate your agent.'); return; }
    const effectiveAgentPreset = isValidPreset(selectedAgent) ? selectedAgent : 'quick_start_2';
    setIsSubmitting(true);
    setError('');
    try {
      if (usingAdvancedSetup) {
        const configResponse = await apiFetch('/api/openclaw/model-settings', {
          method: 'POST',
          body: JSON.stringify({
            providerName: customProviderName.trim(),
            serviceBaseUrl: customServiceBaseUrl,
            modelName: customModelName.trim(),
            apiKey: customApiKey.trim(),
            activate: true,
          }),
        });
        const configData = await configResponse.json().catch(() => null);
        if (!configResponse.ok) {
          setError(configData?.message ?? 'Failed to save your advanced model setup.');
          return;
        }
      }

      const res = await apiFetch('/api/onboarding/model-config', {
        method: 'POST',
        body: JSON.stringify({
          modelKey: usingAdvancedSetup ? customModelKey : modelKey,
          apiKey: usingAdvancedSetup ? customApiKey.trim() : apiKey.trim(),
          agentPreset: effectiveAgentPreset,
          usageMode: isManagedConfiguredMiniMax ? miniMaxAccessMode : undefined,
          customProviderName: usingAdvancedSetup ? customProviderName.trim() : undefined,
          customModelName: usingAdvancedSetup ? customModelName.trim() : undefined,
          customServiceBaseUrl: usingAdvancedSetup ? customServiceBaseUrl : undefined,
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
  const usingAdvancedSetup = !!customProviderName.trim() || !!customModelName.trim() || !!customApiKey.trim();
  const selectedProviderId = selectedModel?.provider ?? '';
  const selectedProviderCard =
    ONBOARDING_PROVIDER_CARDS.find((card) => card.onboardingModelKey === modelKey) ??
    ONBOARDING_PROVIDER_CARDS.find((card) => card.providerName.toLowerCase() === selectedProviderId.toLowerCase()) ??
    null;
  const guidedProviderCards = ONBOARDING_PROVIDER_CARDS.filter((card) =>
    models.some((model) => model.key === card.onboardingModelKey || model.provider === card.providerName.toLowerCase())
  );
  const modelFallbackCopy =
    'If your first choice is unavailable, StudyClaw keeps OpenRouter available and uses MiniMax M2.7 as the next backup path.';

  const headerTitle =
    step === 1
      ? 'Pick the testing tier for this StudyClaw workspace.'
      : step === 2
        ? 'Choose the companion who will teach and coach you.'
        : 'Connect the model setup that will power your agent.';
  const headerDescription =
    step === 1
      ? 'Start by saving the testing tier that seeds live credits and governs the managed experience during setup.'
      : step === 2
        ? 'Your companion controls StudyClaw’s tone, pacing, and teaching style everywhere else in the app.'
        : 'Pick a provider, paste a key if you need one, and StudyClaw will handle the rest.';

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

  const handleOpenGoogleAiStudio = () => {
    setModelKey(findGoogleGeminiModelKey(models));
    setError('');
    setPasteStatus('idle');
    setPasteMessage('');
    window.open(GOOGLE_AI_STUDIO_URL, '_blank', 'noopener,noreferrer');
  };

  const handlePasteApiKey = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      setPasteStatus('error');
      setPasteMessage('Clipboard paste is not available in this browser.');
      return;
    }

    setIsPasteLoading(true);
    setPasteStatus('idle');
    setPasteMessage('');
    setError('');

    try {
      const clipboardText = (await navigator.clipboard.readText()).trim();
      if (!clipboardText) {
        setPasteStatus('error');
        setPasteMessage('Clipboard is empty.');
        return;
      }

      setApiKey(clipboardText);

      if (isGoogleAiStudioApiKey(clipboardText)) {
        setModelKey(findGoogleGeminiModelKey(models));
        setPasteMessage('Pasted! StudyClaw selected Gemini automatically.');
      } else {
        setPasteMessage('Pasted! Keep the current provider or change it below if needed.');
      }

      setPasteStatus('success');
    } catch {
      setPasteStatus('error');
      setPasteMessage('Clipboard read failed. Paste the key manually if needed.');
    } finally {
      setIsPasteLoading(false);
    }
  };

  return (
    <section className="onboarding-shell">
      <header className="onboarding-header">
        <div>
          <p className="onboarding-header__eyebrow">StudyClaw onboarding</p>
          <h1 className="onboarding-header__title">{headerTitle}</h1>
          <p className="onboarding-header__description">{headerDescription}</p>
        </div>
        <div className="onboarding-header__brand">
          <strong>🦀 StudyClaw</strong>
          <span>Focused study help, configured once.</span>
        </div>
      </header>

      <section className="onboarding-layout">
        <aside className="onboarding-sidebar">
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
              <strong>{usingAdvancedSetup ? customModelName || 'Custom setup' : selectedModel?.name ?? 'Choose at step 3'}</strong>
            </div>
          </div>

          <div className="onboarding-helper-card">
            <p className="eyebrow">What this affects</p>
            <p className="muted-copy">
              Tier affects live managed credits, your companion shapes tone and teaching style, and your model setup controls how StudyClaw actually runs chat, coaching, reminders, and study tools.
            </p>
          </div>
        </aside>

        <main className="onboarding-main">
          {step === 1 ? (
            <div className="onboarding-panel">
              <div className="onboarding-panel__head">
                <div>
                  <p className="eyebrow">Step 1</p>
                  <h2 className="section-title">Choose your testing tier</h2>
                  <p className="onboarding-step-copy">This still saves a real tier to the backend immediately, just like the current onboarding flow.</p>
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

              {error ? <p className="onboarding-error">{error}</p> : null}

              <div className="onboarding-footer">
                <OnboardingProgressDots step={step} />
                <div className="onboarding-actions">
                  <button
                    onClick={handleContinueFromTier}
                    disabled={!selectedTier}
                    className="onboarding-primary-action"
                  >
                    Continue to companion
                  </button>
                </div>
              </div>
            </div>
          ) : step === 2 ? (
            <div className="onboarding-panel">
              <div className="onboarding-panel__head">
                <div>
                  <p className="eyebrow">Step 2</p>
                  <h2 className="section-title">Choose your companion</h2>
                  <p className="onboarding-step-copy">Choose the default StudyClaw companion tied to your account. You can change this later from settings.</p>
                </div>
              </div>

              <section className="onboarding-agent-section">
                <div className="onboarding-agent-grid">
                  {AGENTS.map((agent) => (
                    <button
                      key={agent.key}
                      type="button"
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

              <div className="onboarding-footer">
                <OnboardingProgressDots step={step} />
                <div className="onboarding-actions onboarding-actions--split">
                  <button type="button" className="onboarding-secondary-action" onClick={() => setStep(1)}>
                    Back
                  </button>
                  <button
                    onClick={handleContinueFromCompanion}
                    disabled={!selectedAgent}
                    className="onboarding-primary-action"
                  >
                    {selectedAgent ? `Continue with ${AGENTS.find((agent) => agent.key === selectedAgent)?.name}` : 'Continue to model setup'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="onboarding-panel">
              <div className="onboarding-panel__head">
                <div>
                  <p className="eyebrow">Step 3</p>
                  <h2 className="section-title">Connect your model setup</h2>
                  <p className="onboarding-step-copy">Keep the fast Google and OpenRouter setup paths, or expand the advanced block if you want to bring a supported provider manually.</p>
                </div>
                <button type="button" className="ghost-button" onClick={() => setStep(2)}>
                  Change companion
                </button>
              </div>

              <section className="onboarding-selection-card">
                <p className="eyebrow">Chosen setup</p>
                <div className="onboarding-selection-grid">
                  <div className="onboarding-selection-card__row">
                    <span className="onboarding-selection-card__emoji">{AGENTS.find((agent) => agent.key === selectedAgent)?.emoji}</span>
                    <div>
                      <strong>{AGENTS.find((agent) => agent.key === selectedAgent)?.name}</strong>
                      <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                        {AGENTS.find((agent) => agent.key === selectedAgent)?.tagline}
                      </p>
                    </div>
                  </div>
                  <div className="onboarding-selection-chip">
                    <span>Tier</span>
                    <strong>{selectedTier ? TEST_TIERS.find((tier) => tier.key === selectedTier)?.label : 'Not selected'}</strong>
                  </div>
                </div>
              </section>

              <section className="onboarding-provider-card">
                <p className="eyebrow">Choose your provider</p>
                <div className="onboarding-provider-grid">
                  {guidedProviderCards.map((card) => {
                    const isSelected = selectedProviderCard?.key === card.key;
                    const accentClass = `is-${card.accent}`;
                    const actionHandler =
                      card.key === 'google-gemini'
                        ? handleOpenGoogleAiStudio
                        : card.key === 'openrouter-auto'
                          ? handleOpenRouterConnect
                          : card.key === 'minimax'
                            ? handleMiniMaxConnect
                            : () => handleProviderSelect(card.key);

                    return (
                      <div
                        key={card.key}
                        className={`onboarding-provider-option ${accentClass}${isSelected ? ' is-active' : ''}`}
                      >
                        <div className="onboarding-provider-option__header">
                          <div>
                            <strong>{card.label}</strong>
                            <span>{card.description}</span>
                          </div>
                          <span className="onboarding-provider-option__check" aria-hidden="true">
                            {isSelected ? '✓' : ''}
                          </span>
                        </div>

                        <div className="onboarding-provider-option__actions">
                          <button
                            type="button"
                            className="onboarding-provider-option__choose"
                            onClick={() => handleProviderSelect(card.key)}
                          >
                            {isSelected ? 'Selected' : 'Choose'}
                          </button>
                          {card.primaryActionLabel ? (
                            <button
                              type="button"
                              className="onboarding-provider-option__link"
                              onClick={actionHandler}
                            >
                              {card.primaryActionLabel}
                            </button>
                          ) : null}
                          <span className="onboarding-provider-option__pill">
                            {card.requiresApiKey ? 'API key' : 'No API key'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="provider-setup-card">
                  <div className="provider-setup-card__header">
                    <div className="provider-setup-card__icon" aria-hidden="true">
                      {selectedProviderCard?.key === 'google-gemini' ? '🔑' : selectedProviderCard?.key === 'openrouter-auto' ? '🧭' : selectedProviderCard?.key === 'minimax' ? '⚙️' : '🖥️'}
                    </div>
                    <div>
                      <strong>{selectedProviderCard?.label ?? providerLabel(selectedProviderId || 'provider')}</strong>
                      <p className="muted-copy" style={{ marginTop: 8 }}>
                        {selectedProviderCard?.key === 'google-gemini'
                          ? 'Open AI Studio, paste your key below, and StudyClaw will wire Gemini in automatically.'
                          : selectedProviderCard?.key === 'openrouter-auto'
                            ? 'Use your OpenRouter key if you want one provider entry point that can route between multiple models.'
                            : selectedProviderCard?.key === 'minimax'
                              ? 'Choose MiniMax if you want your own MiniMax key or want to switch into StudyClaw-managed MiniMax credits.'
                              : 'Pick your preferred model below. StudyClaw will tell you if this setup needs an API key.'}
                      </p>
                      {selectedProviderCard?.key === 'google-gemini' && googleStatus?.connected ? (
                        <p className="provider-setup-card__account">
                          Google is already connected{googleStatus.googleEmail ? ` as ${googleStatus.googleEmail}` : ''}.
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="provider-setup-card__actions">
                    {selectedProviderCard?.primaryActionLabel ? (
                      <button
                        type="button"
                        className="provider-setup-card__primary"
                        onClick={
                          selectedProviderCard.key === 'google-gemini'
                            ? handleOpenGoogleAiStudio
                            : selectedProviderCard.key === 'openrouter-auto'
                              ? handleOpenRouterConnect
                              : selectedProviderCard.key === 'minimax'
                                ? handleMiniMaxConnect
                                : () => handleProviderSelect(selectedProviderCard.key)
                        }
                      >
                        {selectedProviderCard.primaryActionLabel}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="provider-setup-card__secondary"
                      onClick={() => void handlePasteApiKey()}
                      disabled={isPasteLoading}
                    >
                      {isPasteLoading ? 'Reading clipboard...' : pasteStatus === 'success' ? '✓ Pasted!' : 'Paste from clipboard'}
                    </button>
                  </div>

                  <div className="provider-setup-card__input">
                    <label htmlFor="onboarding-api-key-guided">
                      {selectedProviderCard?.key === 'google-gemini'
                        ? 'Paste your Google API key'
                        : selectedProviderCard?.key === 'openrouter-auto'
                          ? 'Paste your OpenRouter API key'
                          : selectedProviderCard?.key === 'minimax'
                            ? 'Paste your MiniMax API key'
                            : 'Paste your provider API key'}
                    </label>
                    <div className="api-key-input-wrap">
                      <input
                        id="onboarding-api-key-guided"
                        type="password"
                        value={apiKey}
                        onChange={(event) => handleApiKeyChange(event.target.value)}
                        placeholder={
                          selectedProviderCard?.key === 'google-gemini'
                            ? 'Paste the Google AI Studio key here'
                            : selectedProviderCard?.key === 'openrouter-auto'
                              ? 'Paste your OpenRouter key here'
                              : selectedProviderCard?.key === 'minimax'
                                ? 'Paste your MiniMax key here'
                                : 'Paste your API key here'
                        }
                        disabled={!requiresApiKey}
                      />
                      {requiresApiKey ? (
                        <button
                          type="button"
                          className="api-key-clipboard-button"
                          onClick={() => void handlePasteApiKey()}
                          disabled={isPasteLoading}
                        >
                          {isPasteLoading ? '...' : pasteStatus === 'success' ? '✓ Pasted!' : '📋 Paste'}
                        </button>
                      ) : null}
                    </div>
                    {pasteMessage ? <p className={`form-status${pasteStatus === 'error' ? ' is-error' : ''}`}>{pasteMessage}</p> : null}
                    <p className="onboarding-status-copy">
                      {selectedProviderCard?.key === 'google-gemini'
                        ? 'Keys are detected automatically and switch the model dropdown to Gemini. Prefer another provider? Use the choices below or start with OpenRouter instead.'
                        : isManagedConfiguredMiniMax && miniMaxAccessMode === 'managed'
                          ? 'StudyClaw-managed MiniMax does not require a MiniMax key here.'
                          : hasSavedCredential
                            ? 'You already have a saved key for this provider, so you do not need to enter it again.'
                            : requiresApiKey
                              ? 'Your key is encrypted and only used to power your own StudyClaw agent.'
                              : 'This option is ready to use without an API key.'}
                    </p>
                  </div>
                </div>
              </section>

              <section className="onboarding-model-panel">
                <div className="onboarding-model-panel__head">
                  <div>
                    <p className="eyebrow">Review model choice</p>
                    <strong>Confirm the exact model StudyClaw will use</strong>
                    <p className="muted-copy" style={{ marginTop: 8 }}>
                      You can keep the suggested option or switch to another available model without changing the rest of your onboarding setup.
                    </p>
                  </div>
                  <div className="onboarding-model-panel__fallback">
                    <span>Routing backup</span>
                    <strong>OpenRouter → MiniMax M2.7</strong>
                  </div>
                </div>

                <div className="form-field">
                  <label htmlFor="onboarding-model-key">Provider &amp; model</label>
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

                <p className="onboarding-status-copy">{modelFallbackCopy}</p>
              </section>

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

              <section className="onboarding-advanced-card">
                <button
                  type="button"
                  className={`onboarding-advanced-card__toggle${isAdvancedOpen ? ' is-open' : ''}`}
                  onClick={() => setIsAdvancedOpen((current) => !current)}
                  aria-expanded={isAdvancedOpen}
                >
                  <span>
                    <strong>Optional advanced provider setup</strong>
                    <span>Use this only if you want to define the provider and model manually.</span>
                  </span>
                  <span className="onboarding-advanced-card__chevron" aria-hidden="true">
                    {isAdvancedOpen ? '−' : '+'}
                  </span>
                </button>

                {isAdvancedOpen ? (
                  <div className="onboarding-advanced-card__body">
                    <div className="onboarding-advanced-pills">
                      {PROVIDER_PRESETS.filter((preset) => preset.key !== 'ollama').map((preset) => (
                        <button
                          key={preset.key}
                          type="button"
                          className="onboarding-advanced-pill"
                          onClick={() => handlePresetPrefill(preset.key)}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    <div className="onboarding-advanced-grid">
                      <div className="form-field">
                        <label htmlFor="custom-provider-name">Provider name</label>
                        <input
                          id="custom-provider-name"
                          value={customProviderName}
                          onChange={(event) => {
                            setCustomProviderName(event.target.value);
                            setError('');
                          }}
                          placeholder="Google, OpenRouter, OpenAI, Anthropic..."
                        />
                      </div>

                      <div className="form-field">
                        <label htmlFor="custom-model-name">Model name</label>
                        <input
                          id="custom-model-name"
                          value={customModelName}
                          onChange={(event) => {
                            setCustomModelName(event.target.value);
                            setError('');
                          }}
                          placeholder="gemini-3.1-pro-preview, auto, gpt-4.1..."
                        />
                      </div>
                    </div>

                    <div className="form-field">
                      <label htmlFor="custom-api-key">API key</label>
                      <input
                        id="custom-api-key"
                        type="password"
                        value={customApiKey}
                        onChange={(event) => {
                          setCustomApiKey(event.target.value);
                          setError('');
                        }}
                        placeholder="Paste the API key for this provider"
                      />
                    </div>

                    <p className="onboarding-status-copy">
                      {customProviderName.trim()
                        ? resolveCustomServiceBaseUrl(customProviderName)
                          ? `StudyClaw will map ${customProviderName.trim()} to its standard endpoint during onboarding.`
                          : 'Unsupported onboarding provider. Finish with a built-in option, then add a fully custom endpoint later in Model Settings.'
                        : 'Leave this collapsed if you want the standard Google, OpenRouter, MiniMax, or Ollama flow.'}
                    </p>
                  </div>
                ) : null}
              </section>

              {error ? <p className="onboarding-error">{error}</p> : null}

              <div className="onboarding-footer">
                <OnboardingProgressDots step={step} />
                <div className="onboarding-actions onboarding-actions--split">
                  <button type="button" className="onboarding-secondary-action" onClick={() => setStep(2)}>
                    Back
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting || (!usingAdvancedSetup && requiresApiKey && !apiKey.trim()) || (!usingAdvancedSetup && !modelKey)}
                    className="onboarding-primary-action"
                  >
                    {isSubmitting ? 'Activating your agent...' : 'Launch StudyClaw'}
                  </button>
                </div>
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
