'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '../../lib/api';
import { isOnboardingComplete, readStoredSession, writeStoredSession } from '../../lib/session';
import { consumePayloadFromUrl } from '../../lib/consumePayload';

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
    name: 'MiniMax M2.7',
    provider: 'minimax',
    oauthAvailable: false,
    isFree: false,
  },
  {
    key: 'minimax/MiniMax-M2.5',
    name: 'MiniMax M2.5',
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
      const leftDefault = DEFAULT_MODELS.some((model) => model.key === left.key);
      const rightDefault = DEFAULT_MODELS.some((model) => model.key === right.key);

      if (leftDefault !== rightDefault) {
        return leftDefault ? -1 : 1;
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

        setModels(nextModels);
        setExistingCredential(statusData?.credentials ?? null);
        setSelectedAgent(isValidPreset(savedPreset) ? savedPreset : '');

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
  };

  const handleNext = () => {
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
        body: JSON.stringify({ modelKey, apiKey: apiKey.trim(), agentPreset: effectiveAgentPreset }),
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
        });
      }

      router.push('/dashboard');
    } catch (e) {
      setError('Connection error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedModel = models.find(m => m.key === modelKey);
  const hasSavedCredential = !!existingCredential?.hasApiKey && existingCredential?.providerId === selectedModel?.provider;
  const requiresApiKey = selectedModel?.provider !== 'ollama' && !hasSavedCredential;

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
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      {/* Header */}
      <div className="text-center mb-10">
        <p className="text-4xl font-bold mb-2">🦀 StudyClaw</p>
        <p className="text-muted-foreground text-lg">
          {step === 1 ? 'Choose your study companion' : 'Connect your AI provider'}
        </p>
        {/* Steps */}
        <div className="flex items-center justify-center gap-3 mt-5">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
            step >= 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}>1</div>
          <div className={`h-1 w-16 rounded ${ step >= 2 ? 'bg-primary' : 'bg-muted' }`} />
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
            step >= 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}>2</div>
        </div>
      </div>

      {step === 1 && (
        <div className="w-full max-w-2xl">
          <h2 className="text-xl font-semibold mb-6 text-center">Pick your agent — this is permanent for your account</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
            {AGENTS.map(agent => (
              <button
                key={agent.key}
                onClick={() => handleAgentSelect(agent.key)}
                className={`relative p-6 rounded-2xl border-2 text-left transition-all duration-200 bg-gradient-to-br ${
                  agent.color
                } ${
                  selectedAgent === agent.key
                    ? agent.border + ' ring-2 ring-offset-2 ring-offset-background ring-primary scale-[1.02]'
                    : 'border-border hover:border-primary/40 hover:scale-[1.01]'
                }`}
              >
                {selectedAgent === agent.key && (
                  <span className="absolute top-3 right-3 text-primary text-xl">✓</span>
                )}
                <div className="text-4xl mb-3">{agent.emoji}</div>
                <h3 className="text-xl font-bold mb-1">{agent.name}</h3>
                <p className={`text-xs font-semibold uppercase tracking-wider mb-3 px-2 py-1 rounded-full inline-block ${ agent.badge }`}>
                  {agent.tagline}
                </p>
                <p className="text-sm text-muted-foreground mb-4">{agent.description}</p>
                <ul className="space-y-1">
                  {agent.traits.map(t => (
                    <li key={t} className="text-xs text-muted-foreground flex items-center gap-2">
                      <span className="text-primary">•</span> {t}
                    </li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
          {error && <p className="text-destructive text-sm text-center mb-4">{error}</p>}
          <button
            onClick={handleNext}
            disabled={!selectedAgent}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-lg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {selectedAgent ? `Continue with ${AGENTS.find(a => a.key === selectedAgent)?.name}` : 'Continue to provider setup'} →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="w-full max-w-md">
          <div className="bg-card border border-border rounded-2xl p-6 mb-5">
            <p className="text-sm text-muted-foreground mb-1">Your companion</p>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{AGENTS.find(a => a.key === selectedAgent)?.emoji}</span>
              <span className="font-bold text-lg">{AGENTS.find(a => a.key === selectedAgent)?.name}</span>
              <button onClick={() => setStep(1)} className="ml-auto text-xs text-muted-foreground underline">Change</button>
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-sm font-semibold text-foreground">Connect OpenRouter for the fastest setup</p>
              <p className="mt-2 text-sm text-muted-foreground">
                StudyClaw needs a provider connection so your agent can actually generate responses, save your model choice,
                and run chats, coaching, and study tools on your own account. Google sign-in only unlocks your account.
                Calendar and Drive can be connected later in settings without blocking this setup.
              </p>
              <button
                type="button"
                onClick={handleOpenRouterConnect}
                className="mt-4 inline-flex items-center rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/15"
              >
                Connect OpenRouter
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">OR BYOK (Bring Your Own Key)</p>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Model selector */}
            <div>
              <label className="block text-sm font-medium mb-2">AI Provider &amp; Model</label>
              <select
                value={modelKey}
                onChange={e => setModelKey(e.target.value)}
                className="w-full bg-input border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {models.map(m => (
                  <option key={m.key} value={m.key}>{m.name} ({m.provider})</option>
                ))}
              </select>
            </div>

            {/* API Key */}
            <div>
              <label className="block text-sm font-medium mb-2">
                API Key {requiresApiKey ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">(already saved or not needed)</span>}
              </label>
              {selectedModel?.provider === 'minimax' ? (
                <button
                  type="button"
                  onClick={handleMiniMaxConnect}
                  className="mb-3 inline-flex items-center rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/15"
                >
                  Get MiniMax API Key
                </button>
              ) : null}
              <input
                type="password"
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setError(''); }}
                placeholder={
                  selectedModel?.provider === 'ollama'
                    ? 'No API key needed for local Ollama'
                    : selectedModel?.provider === 'openrouter'
                      ? 'sk-or-v1-...'
                      : selectedModel?.provider === 'minimax'
                        ? 'Enter your MiniMax API key'
                      : 'Enter your API key'
                }
                className="w-full bg-input border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={!requiresApiKey}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {hasSavedCredential
                  ? 'You already have a saved key for this provider, so you do not need to enter it again.'
                  : requiresApiKey
                  ? 'Your key is encrypted and never shared. Used only to power your agent.'
                  : 'This model runs through your local Ollama setup, so no API key is required.'}
              </p>
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={isSubmitting || (requiresApiKey && !apiKey.trim()) || !modelKey}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-lg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              {isSubmitting ? 'Activating your agent...' : 'Launch StudyClaw 🚀'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <OnboardingPageContent />
    </Suspense>
  );
}
