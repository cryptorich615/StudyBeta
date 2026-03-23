'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api';
import { readStoredSession, writeStoredSession } from '../../lib/session';

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

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [models, setModels] = useState<{ key: string; name: string; provider: string }[]>([]);
  const [modelKey, setModelKey] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState('');

  useEffect(() => {
    const parsed = readStoredSession();
    if (!parsed?.user) { router.push('/auth?mode=login'); return; }
    setUserId(parsed.user.id);
    // If already onboarded, go to dashboard
    if (parsed.user.agent_type) { router.push('/dashboard'); return; }
    // Load models
    apiFetch('/api/onboarding/options').then(res => res.json()).then(data => {
      setModels(data.models ?? []);
      if (data.models?.[0]) setModelKey(data.models[0].key);
    }).catch(() => {});
  }, []);

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
    setIsSubmitting(true);
    setError('');
    try {
      const res = await apiFetch('/api/onboarding/model-config', {
        method: 'POST',
        body: JSON.stringify({ modelKey, apiKey: apiKey.trim(), agentPreset: selectedAgent }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? 'Setup failed. Please try again.'); return; }
      // Refresh session to mark onboarding complete
      const statusRes = await apiFetch('/api/onboarding/status');
      if (statusRes.ok) {
        const status = await statusRes.json();
        const session = readStoredSession();
        if (session) {
          writeStoredSession({
            ...session,
            user: {
              ...session.user,
              agent_type: status.agent?.agent_type ?? selectedAgent,
              onboarding_complete: true,
            },
          });
        }
      }
      router.push('/dashboard');
    } catch (e) {
      setError('Connection error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedModel = models.find(m => m.key === modelKey);
  const requiresApiKey = selectedModel?.provider !== 'ollama';
  const filteredModels = models.filter((m: any) => 
    modelSearch === '' || 
    m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
    m.provider.toLowerCase().includes(modelSearch.toLowerCase()) ||
    m.key.toLowerCase().includes(modelSearch.toLowerCase())
  );

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
                API Key {requiresApiKey ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">(not needed for Ollama)</span>}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setError(''); }}
                placeholder={
                  selectedModel?.provider === 'ollama'
                    ? 'No API key needed for local Ollama'
                    : selectedModel?.provider === 'openrouter'
                      ? 'sk-or-v1-...'
                      : 'Enter your API key'
                }
                className="w-full bg-input border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={!requiresApiKey}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {requiresApiKey
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
