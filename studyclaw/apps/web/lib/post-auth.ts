import { apiFetch } from './api';

export async function getPostAuthDestination(defaultPath = '/dashboard') {
  try {
    const response = await apiFetch('/api/onboarding/status');
    const data = await response.json();

    if (!response.ok) {
      return defaultPath;
    }

    if (data?.studentAgent?.role === 'admin' || data?.profile?.role === 'admin' || data?.agent?.role === 'admin') {
      return '/dashboard';
    }

    if (data?.user?.role === 'admin') {
      return '/dashboard';
    }

    return data.onboardingComplete ? '/dashboard' : '/onboarding';
  } catch {
    return defaultPath;
  }
}
