'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { writeStoredSession } from '../../../lib/session';

type CallbackPayload = {
  user: {
    id: string;
    email: string;
    full_name?: string;
    role?: string;
  };
  accessToken: string;
  onboardingComplete?: boolean;
};

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return window.atob(`${normalized}${padding}`);
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const payload = searchParams.get('payload');
    if (!payload) {
      router.replace('/login');
      return;
    }

    try {
      const parsed = JSON.parse(decodeBase64Url(payload)) as CallbackPayload;
      writeStoredSession({
        user: {
          id: parsed.user.id,
          email: parsed.user.email,
          full_name: parsed.user.full_name,
        },
        accessToken: parsed.accessToken,
      });
      router.replace(parsed.onboardingComplete ? '/dashboard' : '/onboarding');
    } catch {
      router.replace('/login');
    }
  }, [router, searchParams]);

  return (
    <section className="hero-card">
      <p className="insight-chip">Authentication</p>
      <h1 className="hero-title">Finishing sign-in…</h1>
      <p className="hero-description">StudyClaw is moving your Google session into the app.</p>
    </section>
  );
}
