'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, CheckCircle2, LockKeyhole, Mail } from 'lucide-react';
import { Button } from './ui/button';
import { apiFetch, resolveApiUrl } from '../../lib/api';
import { readStoredSession, writeStoredSession, type StoredSession } from '../../lib/session';

type Mode = 'login' | 'signup';

type AuthFormProps = {
  initialMode?: Mode;
};

const passwordChecks = [
  { label: 'At least 8 characters', test: (value: string) => value.length >= 8 },
  { label: 'One number recommended', test: (value: string) => /\d/.test(value) },
  { label: 'One letter required', test: (value: string) => /[A-Za-z]/.test(value) },
];

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.705c-.181-.54-.285-1.115-.285-1.705s.104-1.165.285-1.705V4.963H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.037l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.443 2.017.957 4.963L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

export default function AuthForm({ initialMode = 'signup' }: AuthFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [saved, setSaved] = useState<StoredSession | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shakeError, setShakeError] = useState(false);

  useEffect(() => {
    setSaved(readStoredSession());
  }, []);

  useEffect(() => {
    setStatus('');
    setShakeError(false);
  }, [mode]);

  const passwordState = useMemo(
    () => passwordChecks.map((rule) => ({ ...rule, passed: rule.test(password) })),
    [password]
  );

  const handleGoogleLogin = () => {
    window.location.assign(resolveApiUrl('/api/auth/google'));
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setShakeError(false);
    setStatus(mode === 'signup' ? 'Creating your account...' : 'Signing you in...');

    try {
      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const response = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      const data = (await response.json()) as StoredSession & {
        message?: string;
        existingUser?: boolean;
        onboardingComplete?: boolean;
      };

      if (!response.ok) {
        throw new Error(data?.message ?? (mode === 'signup' ? 'Unable to create account' : 'Unable to log in'));
      }

      writeStoredSession(data);
      setSaved(data);

      const nextPath = data.onboardingComplete ? '/dashboard' : '/onboarding';
      setStatus(
        mode === 'signup'
          ? data.existingUser
            ? 'Account exists. Opening your workspace...'
            : 'Account created. Taking you to onboarding...'
          : 'Signed in. Opening your workspace...'
      );

      router.push(nextPath);
    } catch (error: any) {
      setStatus(error.message ?? (mode === 'signup' ? 'Signup failed' : 'Sign in failed'));
      setShakeError(true);
      window.setTimeout(() => setShakeError(false), 500);
    } finally {
      setIsSubmitting(false);
    }
  }

  const alternateMode = mode === 'signup' ? 'login' : 'signup';

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="relative mx-auto w-full max-w-[480px]"
    >
      <div className="absolute inset-0 -z-10 rounded-[32px] bg-[radial-gradient(circle_at_top,rgba(244,162,97,0.16),transparent_60%)] blur-2xl dark:bg-[radial-gradient(circle_at_top,rgba(231,111,81,0.24),transparent_60%)]" />
      <motion.div
        animate={shakeError ? { x: [0, -10, 10, -6, 6, 0] } : { x: 0 }}
        transition={{ duration: 0.38 }}
        className="rounded-[32px] border border-[var(--auth-card-border)] bg-[var(--auth-card-bg)] p-6 shadow-[var(--auth-card-shadow)] backdrop-blur-xl sm:p-8"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-[0.72rem] font-bold uppercase tracking-[0.24em] text-[var(--marketing-muted)]">
              {mode === 'signup' ? 'Create account' : 'Welcome back'}
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-[var(--marketing-heading)]">
              {mode === 'signup' ? 'Build your always-on study system.' : 'Get back to your study flow.'}
            </h1>
            <p className="mt-3 text-sm leading-7 text-[var(--marketing-copy)]">
              {mode === 'signup'
                ? 'Email and password get you in fast. Google stays available for instant sign-in and calendar-connected workflows.'
                : 'Use your StudyClaw credentials or continue with Google to reopen your dashboard.'}
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            className="rounded-full border-[var(--marketing-card-border)] bg-transparent px-4 py-2 text-sm font-semibold text-[var(--marketing-heading)] hover:bg-primary/10"
            onClick={() => setMode(alternateMode)}
          >
            {mode === 'signup' ? 'Log in' : 'Sign up'}
          </Button>
        </div>

        <div className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full rounded-2xl border-[var(--marketing-card-border)] bg-[var(--auth-google-bg)] text-[var(--marketing-heading)] hover:bg-[var(--auth-google-hover)]"
            onClick={handleGoogleLogin}
          >
            <span className="mr-3"><GoogleIcon /></span>
            Continue with Google
          </Button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[var(--marketing-card-border)]" />
            <span className="text-[0.7rem] font-bold uppercase tracking-[0.24em] text-[var(--marketing-muted)]">or</span>
            <div className="h-px flex-1 bg-[var(--marketing-card-border)]" />
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--marketing-heading)]">
                <Mail className="h-4 w-4 text-primary" />
                Email
              </span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="student@campus.edu"
                autoComplete="email"
                required
                className="h-12 w-full rounded-2xl border border-[var(--auth-input-border)] bg-[var(--auth-input-bg)] px-4 text-[var(--marketing-heading)] outline-none transition placeholder:text-[var(--marketing-muted)] focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>

            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--marketing-heading)]">
                <LockKeyhole className="h-4 w-4 text-primary" />
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === 'signup' ? 'Create a secure password' : 'Enter your password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={mode === 'signup' ? 8 : undefined}
                required
                className="h-12 w-full rounded-2xl border border-[var(--auth-input-border)] bg-[var(--auth-input-bg)] px-4 text-[var(--marketing-heading)] outline-none transition placeholder:text-[var(--marketing-muted)] focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>

            <AnimatePresence initial={false}>
              {mode === 'signup' ? (
                <motion.div
                  key="password-rules"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden rounded-2xl border border-[var(--marketing-card-border)] bg-[var(--auth-tip-bg)] p-4"
                >
                  <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[var(--marketing-muted)]">
                    Password requirements
                  </p>
                  <ul className="space-y-2">
                    {passwordState.map((rule) => (
                      <li key={rule.label} className="flex items-center gap-2 text-sm text-[var(--marketing-copy)]">
                        <CheckCircle2 className={`h-4 w-4 ${rule.passed ? 'text-emerald-500' : 'text-[var(--marketing-muted)]'}`} />
                        <span>{rule.label}</span>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-12 w-full rounded-2xl bg-[var(--auth-button-bg)] text-[var(--auth-button-fg)] shadow-[0_18px_45px_rgba(244,162,97,0.24)] transition hover:translate-y-[-1px] hover:opacity-95"
            >
              {isSubmitting
                ? mode === 'signup'
                  ? 'Creating account...'
                  : 'Signing in...'
                : mode === 'signup'
                  ? 'Create account'
                  : 'Log in'}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </form>
        </div>

        <AnimatePresence mode="wait">
          {status ? (
            <motion.div
              key={status}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
                shakeError
                  ? 'border-red-400/40 bg-red-500/10 text-red-200 dark:text-red-200'
                  : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
              }`}
              role="status"
              aria-live="polite"
            >
              {status}
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="mt-5 flex flex-col gap-2 text-sm text-[var(--marketing-copy)] sm:flex-row sm:items-center sm:justify-between">
          <p>
            {mode === 'signup' ? 'Already have an account?' : 'Need an account?'}{' '}
            <button
              type="button"
              className="font-semibold text-primary underline-offset-4 hover:underline"
              onClick={() => setMode(alternateMode)}
            >
              {mode === 'signup' ? 'Log in instead' : 'Create one'}
            </button>
          </p>
          <p className="text-[var(--marketing-muted)]">
            {saved ? `Last session: ${saved.user.full_name ?? saved.user.email}` : 'JWT auth + Google OAuth enabled'}
          </p>
        </div>

        <div className="mt-4 text-xs text-[var(--marketing-muted)]">
          By continuing, you agree to use StudyClaw for your own coursework and study planning.
        </div>
      </motion.div>

      <div className="mt-4 text-center text-sm text-[var(--marketing-copy)]">
        <Link href="/" className="font-medium text-primary underline-offset-4 hover:underline">
          Back to StudyClaw
        </Link>
      </div>
    </motion.section>
  );
}
