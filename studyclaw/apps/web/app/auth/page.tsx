'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import AuthForm from '../components/auth-form';
import { readStoredSession } from '../../lib/session';

export default function AuthPage() {
  const router = useRouter();
  const requestedMode =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'login'
      ? 'login'
      : 'signup';

  useEffect(() => {
    const session = readStoredSession();
    if (session?.user?.id) {
      router.replace('/dashboard');
    }
  }, [router]);

  return (
    <div className="relative flex min-h-[calc(100vh-8rem)] items-center justify-center py-8">
      {/* Responsive screenshot note: mobile = centered single auth card with full-width controls; desktop = auth card paired with a left-side value panel. */}
      <div className="absolute inset-0 -z-10 bg-[var(--marketing-page-bg)]" />
      <div className="absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,rgba(244,162,97,0.18),transparent_55%)]" />

      <div className="grid w-full max-w-6xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <motion.section
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="hidden lg:block"
        >
          <p className="text-sm font-bold uppercase tracking-[0.28em] text-primary">StudyClaw Access</p>
          <h2 className="mt-5 max-w-xl font-display text-5xl font-bold leading-[0.95] tracking-tight text-[var(--marketing-heading)]">
            Your AI study coach, calendar copilot, and note pipeline in one place.
          </h2>
          <p className="mt-6 max-w-xl text-lg leading-8 text-[var(--marketing-copy)]">
            Sign up once, connect Google when you want, and keep every flashcard set, quiz, transcript, and personalized agent run inside the same workspace.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {[
              'Google OAuth stays intact for fast sign-in',
              'JWT session flow is unchanged',
              'Signup pushes to onboarding immediately',
              'Login returns straight to your dashboard',
            ].map((item) => (
              <div
                key={item}
                className="rounded-[24px] border border-[var(--marketing-card-border)] bg-[var(--marketing-card-bg)] px-5 py-4 text-sm leading-6 text-[var(--marketing-copy)] shadow-[var(--marketing-card-shadow)] backdrop-blur-md"
              >
                {item}
              </div>
            ))}
          </div>
        </motion.section>

        <AuthForm initialMode={requestedMode} />
      </div>
    </div>
  );
}
