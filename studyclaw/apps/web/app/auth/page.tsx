'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import AuthForm from '../components/auth-form';
import { isOnboardingComplete, readStoredSession } from '../../lib/session';

export default function AuthPage() {
  const router = useRouter();
  const [requestedMode, setRequestedMode] = useState<'login' | 'signup'>('signup');

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setRequestedMode(new URLSearchParams(window.location.search).get('mode') === 'login' ? 'login' : 'signup');
  }, []);

  useEffect(() => {
    const session = readStoredSession();
    if (session?.user?.id) {
      router.replace(isOnboardingComplete(session) ? '/dashboard' : '/onboarding');
    }
  }, [router]);

  return (
    <div className="auth-workspace">
      <div className="auth-workspace__backdrop" />

      <div className="auth-workspace__grid">
        <motion.section
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="auth-workspace__aside"
        >
          <p className="auth-workspace__eyebrow">StudyClaw access</p>
          <h2 className="auth-workspace__title">
            Step into the same study workspace where your notes, calendar, chat, and practice sets live.
          </h2>
          <p className="auth-workspace__description">
            Sign in fast, finish onboarding once, and keep every study session connected to the same account context.
          </p>

          <div className="auth-workspace__feature-grid">
            {[
              'Google sign-in stays available for fast access and calendar workflows',
              'Email auth still works for direct account creation and login',
              'New accounts continue straight into onboarding',
              'Returning users jump back into their active study workspace',
            ].map((item) => (
              <div key={item} className="auth-workspace__feature-card">{item}</div>
            ))}
          </div>

          <div className="auth-workspace__status-strip">
            <div className="auth-workspace__status-card">
              <span>Flow</span>
              <strong>{requestedMode === 'login' ? 'Sign in' : 'Create account'}</strong>
            </div>
            <div className="auth-workspace__status-card">
              <span>After auth</span>
              <strong>Onboarding or dashboard</strong>
            </div>
          </div>
        </motion.section>

        <AuthForm initialMode={requestedMode} />
      </div>
    </div>
  );
}
