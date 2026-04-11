'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api';
import { readStoredSession, writeStoredSession } from '../../lib/session';

const TIERS = [
  {
    key: 1,
    name: 'Tier 1',
    credits: 1000,
    emoji: '🌱',
    color: 'from-green-500/20 to-emerald-500/20',
    border: 'border-green-500/40',
    badge: 'bg-green-500/20 text-green-300',
    tagline: 'Starter',
  },
  {
    key: 2,
    name: 'Tier 2',
    credits: 3000,
    emoji: '⚡',
    color: 'from-amber-500/20 to-orange-500/20',
    border: 'border-amber-500/40',
    badge: 'bg-amber-500/20 text-amber-300',
    tagline: 'Most Popular',
  },
  {
    key: 3,
    name: 'Tier 3',
    credits: 5000,
    emoji: '🚀',
    color: 'from-purple-500/20 to-pink-500/20',
    border: 'border-purple-500/40',
    badge: 'bg-purple-500/20 text-purple-300',
    tagline: 'Power User',
  },
];

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
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedTier, setSelectedTier] = useState<number | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const parsed = readStoredSession();
    if (!parsed?.user) { router.push('/auth?mode=login'); return; }
    if (parsed.user.agent_type) { router.push('/dashboard'); return; }
  }, []);

  const handleTierSelect = (tier: number) => {
    setSelectedTier(tier);
    setError('');
  };

  const handleNextFromTier = async () => {
    if (!selectedTier) { setError('Please select a tier to continue.'); return; }
    setIsSubmitting(true);
    setError('');
    try {
      const res = await apiFetch('/api/onboarding/testing-tier', {
        method: 'POST',
        body: JSON.stringify({ tier: selectedTier }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? 'Failed to save tier.'); return; }
      setStep(2);
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAgentSelect = (key: string) => {
    setSelectedAgent(key);
    setError('');
  };

  const handleNextFromAgent = () => {
    if (!selectedAgent) { setError('Please choose your study companion to continue.'); return; }
    setStep(3);
  };

  const handleSubmit = async () => {
    if (!selectedAgent) { setError('Please choose your study companion.'); return; }
    setIsSubmitting(true);
    setError('');
    try {
      const res = await apiFetch('/api/onboarding/model-config', {
        method: 'POST',
        body: JSON.stringify({
          modelKey: 'minimax/MiniMax-M2.7',
          apiKey: '',
          agentPreset: selectedAgent,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? 'Setup failed. Please try again.'); return; }
      // Refresh session
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
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedTierData = TIERS.find(t => t.key === selectedTier);
  const selectedAgentData = AGENTS.find(a => a.key === selectedAgent);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      {/* Header */}
      <div className="text-center mb-10">
        <p className="text-4xl font-bold mb-2">🦀 StudyClaw</p>
        <p className="text-muted-foreground text-lg">
          {step === 1 ? 'Choose your testing tier' : step === 2 ? 'Choose your study companion' : 'Confirm your setup'}
        </p>
        {/* Steps */}
        <div className="flex items-center justify-center gap-3 mt-5">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                step >= s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}>{s}</div>
              {s < 3 && <div className={`h-1 w-10 rounded ${step >= s + 1 ? 'bg-primary' : 'bg-muted'}`} />}
            </div>
          ))}
        </div>
      </div>

      {/* Step 1 — Tier Selection */}
      {step === 1 && (
        <div className="w-full max-w-2xl">
          <h2 className="text-xl font-semibold mb-6 text-center">Select your testing tier — credits reset every 5 hours</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
            {TIERS.map((tier) => (
              <button
                key={tier.key}
                onClick={() => handleTierSelect(tier.key)}
                className={`relative p-6 rounded-2xl border-2 text-left transition-all duration-200 bg-gradient-to-br ${
                  tier.color
                } ${
                  selectedTier === tier.key
                    ? tier.border + ' ring-2 ring-offset-2 ring-offset-background ring-primary scale-[1.02]'
                    : 'border-border hover:border-primary/40 hover:scale-[1.01]'
                }`}
              >
                {selectedTier === tier.key && (
                  <span className="absolute top-3 right-3 text-primary text-xl">✓</span>
                )}
                <div className="text-4xl mb-3">{tier.emoji}</div>
                <h3 className="text-xl font-bold mb-1">{tier.name}</h3>
                <p className={`text-xs font-semibold uppercase tracking-wider mb-3 px-2 py-1 rounded-full inline-block ${tier.badge}`}>
                  {tier.tagline}
                </p>
                <p className="text-2xl font-bold text-primary">{tier.credits.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">starting credits</p>
              </button>
            ))}
          </div>
          {error && <p className="text-destructive text-sm text-center mb-4">{error}</p>}
          <button
            onClick={handleNextFromTier}
            disabled={!selectedTier || isSubmitting}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-lg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {isSubmitting ? 'Saving...' : selectedTier ? `Continue with ${TIERS.find(t => t.key === selectedTier)?.name} →` : 'Select a tier to continue'}
          </button>
        </div>
      )}

      {/* Step 2 — Companion Selection */}
      {step === 2 && (
        <div className="w-full max-w-2xl">
          <div className="bg-card border border-border rounded-2xl p-4 mb-6 flex items-center gap-3">
            <span className="text-2xl">{selectedTierData?.emoji}</span>
            <div>
              <p className="text-sm text-muted-foreground">Selected tier</p>
              <p className="font-bold">{selectedTierData?.name} · {selectedTierData?.credits.toLocaleString()} credits</p>
            </div>
            <button onClick={() => setStep(1)} className="ml-auto text-xs text-muted-foreground underline">Change</button>
          </div>

          <h2 className="text-xl font-semibold mb-6 text-center">Pick your companion — permanent for your account</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
            {AGENTS.map((agent) => (
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
                <p className={`text-xs font-semibold uppercase tracking-wider mb-3 px-2 py-1 rounded-full inline-block ${agent.badge}`}>
                  {agent.tagline}
                </p>
                <p className="text-sm text-muted-foreground mb-4">{agent.description}</p>
                <ul className="space-y-1">
                  {agent.traits.map((t) => (
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
            onClick={handleNextFromAgent}
            disabled={!selectedAgent}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-lg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {selectedAgent ? `Continue with ${AGENTS.find(a => a.key === selectedAgent)?.name} →` : 'Choose your companion'}
          </button>
        </div>
      )}

      {/* Step 3 — Model Confirmation */}
      {step === 3 && (
        <div className="w-full max-w-md">
          <div className="bg-card border border-border rounded-2xl p-6 mb-6 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{selectedTierData?.emoji}</span>
                <div>
                  <p className="text-sm text-muted-foreground">Tier</p>
                  <p className="font-bold">{selectedTierData?.name}</p>
                </div>
              </div>
              <button onClick={() => setStep(1)} className="text-xs text-muted-foreground underline">Change</button>
            </div>
            <div className="border-t border-border pt-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{selectedAgentData?.emoji}</span>
                <div>
                  <p className="text-sm text-muted-foreground">Companion</p>
                  <p className="font-bold">{selectedAgentData?.name}</p>
                </div>
              </div>
              <button onClick={() => setStep(2)} className="text-xs text-muted-foreground underline">Change</button>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-6 mb-6">
            <p className="text-sm text-muted-foreground mb-2">AI Model</p>
            <div className="flex items-center gap-3">
              <span className="text-2xl">🤖</span>
              <div>
                <p className="font-bold text-lg">MiniMax M2.7</p>
                <p className="text-sm text-muted-foreground">Powered by your account — no API key needed</p>
              </div>
            </div>
            <div className="mt-4 bg-muted/30 rounded-xl p-3 text-xs text-muted-foreground">
              Credits: {selectedTierData?.credits.toLocaleString()} messages per 5-hour window · resets automatically
            </div>
          </div>

          {error && <p className="text-destructive text-sm mb-4">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-lg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {isSubmitting ? 'Launching...' : '🚀 Launch StudyClaw'}
          </button>
        </div>
      )}
    </div>
  );
}
