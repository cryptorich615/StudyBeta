export const GOOGLE_AI_STUDIO_URL = 'https://aistudio.google.com/app/apikey';
export const GOOGLE_GEMINI_MODEL_KEY = 'google/gemini-3.1-pro-preview';
export const GOOGLE_GEMINI_MODEL_NAME = 'gemini-3.1-pro-preview';
export const GOOGLE_GEMINI_PROVIDER_NAME = 'Google';
export const GOOGLE_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

export type ProviderPreset = {
  key: string;
  label: string;
  helper: string;
  providerName: string;
  serviceBaseUrl: string;
  modelName: string;
  onboardingModelKey?: string;
};

export type OnboardingProviderCard = {
  key: string;
  label: string;
  description: string;
  providerName: string;
  onboardingModelKey: string;
  accent: 'google' | 'openrouter' | 'minimax' | 'ollama';
  requiresApiKey: boolean;
  primaryActionLabel?: string;
  primaryActionUrl?: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'google-gemini',
    label: 'Google Gemini (AI Studio)',
    helper: 'Use a Google AI Studio key from your Google account.',
    providerName: GOOGLE_GEMINI_PROVIDER_NAME,
    serviceBaseUrl: GOOGLE_GEMINI_BASE_URL,
    modelName: GOOGLE_GEMINI_MODEL_NAME,
    onboardingModelKey: GOOGLE_GEMINI_MODEL_KEY,
  },
  {
    key: 'openrouter-auto',
    label: 'OpenRouter Auto',
    helper: 'Flexible routing if you already use OpenRouter.',
    providerName: 'OpenRouter',
    serviceBaseUrl: 'https://openrouter.ai/api/v1',
    modelName: 'auto',
    onboardingModelKey: 'openrouter/auto',
  },
  {
    key: 'openrouter-free',
    label: 'OpenRouter Free',
    helper: 'Free OpenRouter routing for lightweight use.',
    providerName: 'OpenRouter',
    serviceBaseUrl: 'https://openrouter.ai/api/v1',
    modelName: 'free',
    onboardingModelKey: 'openrouter/free',
  },
  {
    key: 'minimax',
    label: 'MiniMax M2.7',
    helper: 'Use your own MiniMax key instead of StudyClaw managed credits.',
    providerName: 'MiniMax',
    serviceBaseUrl: 'https://api.minimax.io/anthropic',
    modelName: 'MiniMax-M2.7',
    onboardingModelKey: 'minimax/MiniMax-M2.7',
  },
  {
    key: 'ollama',
    label: 'Local Ollama',
    helper: 'No API key needed when you run Ollama locally.',
    providerName: 'Ollama',
    serviceBaseUrl: 'http://127.0.0.1:11434',
    modelName: 'lfm2.5-thinking:latest',
    onboardingModelKey: 'ollama/lfm2.5-thinking:latest',
  },
];

export const ONBOARDING_PROVIDER_CARDS: OnboardingProviderCard[] = [
  {
    key: 'google-gemini',
    label: 'Google Gemini',
    description: 'Fastest setup for most students. Open AI Studio, paste your key, and StudyClaw selects Gemini automatically.',
    providerName: GOOGLE_GEMINI_PROVIDER_NAME,
    onboardingModelKey: GOOGLE_GEMINI_MODEL_KEY,
    accent: 'google',
    requiresApiKey: true,
    primaryActionLabel: 'Open Google AI Studio',
    primaryActionUrl: GOOGLE_AI_STUDIO_URL,
  },
  {
    key: 'openrouter-auto',
    label: 'OpenRouter',
    description: 'A flexible provider option that works well if you already keep one API key for multiple models.',
    providerName: 'OpenRouter',
    onboardingModelKey: 'openrouter/auto',
    accent: 'openrouter',
    requiresApiKey: true,
    primaryActionLabel: 'Open OpenRouter',
    primaryActionUrl: 'https://openrouter.ai/keys',
  },
  {
    key: 'minimax',
    label: 'MiniMax M2.7',
    description: 'Use your own MiniMax key or switch to StudyClaw-managed credits after selecting the MiniMax model below.',
    providerName: 'MiniMax',
    onboardingModelKey: 'minimax/MiniMax-M2.7',
    accent: 'minimax',
    requiresApiKey: true,
    primaryActionLabel: 'Get MiniMax API Key',
    primaryActionUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  },
  {
    key: 'ollama',
    label: 'Local Ollama',
    description: 'Choose this if you run Ollama locally and want StudyClaw to use your local model without an API key.',
    providerName: 'Ollama',
    onboardingModelKey: 'ollama/lfm2.5-thinking:latest',
    accent: 'ollama',
    requiresApiKey: false,
  },
];

export function isGoogleAiStudioApiKey(value: string) {
  return /^AIza[0-9A-Za-z_-]{20,}$/.test(value.trim());
}

export function findGoogleGeminiModelKey(
  models: Array<{ key: string; provider?: string }>
) {
  return (
    models.find((model) => model.key === GOOGLE_GEMINI_MODEL_KEY)?.key ??
    models.find((model) => model.provider === 'google')?.key ??
    models.find((model) => model.key.toLowerCase().includes('gemini'))?.key ??
    GOOGLE_GEMINI_MODEL_KEY
  );
}

export function findPreset(key: string) {
  return PROVIDER_PRESETS.find((preset) => preset.key === key) ?? null;
}
