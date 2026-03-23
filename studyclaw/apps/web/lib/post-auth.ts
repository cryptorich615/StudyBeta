import { apiFetch } from './api';

export async function getPostAuthDestination(defaultPath = '/dashboard') {
  try {
    const response = await apiFetch('/api/onboarding/status');
    const data = await response.json();

    if (!response.ok) {
      return defaultPath;
    }

    return data.onboardingComplete ? '/dashboard' : '/onboarding';
  } catch {
    return defaultPath;
  }
}
