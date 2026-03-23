'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import FeatureCard from './feature-card';
import { readStoredSession } from '../../lib/session';
import {
  AudioLines,
  BrainCircuit,
  CalendarClock,
  Sparkles,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';

const features = [
  {
    eyebrow: 'Study Tools',
    title: 'AI flashcards + quizzes',
    description:
      'Turn lecture notes, textbook snippets, and study guides into editable flashcards and quizzes in seconds.',
    icon: Sparkles,
    imageSrc: '/feature-flashcards.svg',
    imageAlt: 'StudyClaw flashcard and quiz generator preview',
  },
  {
    eyebrow: 'Calendar Sync',
    title: 'Google Calendar integration',
    description:
      'Pull in due dates, deadlines, and exam blocks so your weekly plan stays connected to the real calendar you already use.',
    icon: CalendarClock,
    imageSrc: '/feature-calendar.svg',
    imageAlt: 'StudyClaw Google Calendar integration preview',
  },
  {
    eyebrow: 'Capture Anything',
    title: 'Photo + audio transcription',
    description:
      'Drop in whiteboard photos, lecture recordings, or notebook scans and let StudyClaw turn them into usable notes.',
    icon: AudioLines,
    imageSrc: '/feature-transcription.svg',
    imageAlt: 'StudyClaw transcription workflow preview',
  },
  {
    eyebrow: 'Personal Agent',
    title: 'Dixie, Willow, or custom',
    description:
      'Choose a personalized study agent that matches your pace, memory style, and the way you actually get work done.',
    icon: BrainCircuit,
    imageSrc: '/feature-agent.svg',
    imageAlt: 'StudyClaw personalized study agent preview',
  },
];

const highlights = [
  'AI study plans that keep working after midnight',
  'Calendar-aware reminders and exam prep',
  'Upload-first note capture from photos and audio',
];

export default function LandingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const session = readStoredSession();
    if (session?.user?.id) {
      router.replace('/dashboard');
      return;
    }

    setReady(true);
  }, [router]);

  if (!ready) {
    return null;
  }

  return (
    <div className="relative mx-auto max-w-7xl">
      {/* Responsive screenshot note: mobile = full-height hero with stacked CTAs + single-column feature cards; desktop = split hero with glass preview panel and 2x2 feature grid. */}
      <div className="absolute inset-x-0 top-[-8rem] -z-10 h-[28rem] bg-[radial-gradient(circle_at_top,rgba(244,162,97,0.22),transparent_52%)]" />

      <section className="relative flex min-h-[calc(100vh-8rem)] items-center py-10 sm:py-12">
        <div className="grid w-full gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            className="space-y-8"
          >
            <Badge className="rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-[0.68rem] font-bold uppercase tracking-[0.28em] text-primary">
              Your AI Study Coach that never sleeps
            </Badge>

            <div className="space-y-5">
              <h1 className="max-w-4xl font-display text-5xl font-bold leading-[0.92] tracking-[-0.05em] text-[var(--marketing-heading)] sm:text-6xl lg:text-7xl">
                Built for students who need structure, not another blank chat box.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-[var(--marketing-copy)] sm:text-xl">
                StudyClaw combines an always-on study coach, calendar-aware planning, transcription workflows, and AI-generated study materials in one focused workspace.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              {highlights.map((item) => (
                <div
                  key={item}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--marketing-card-border)] bg-[var(--marketing-card-bg)] px-4 py-2 text-sm text-[var(--marketing-copy)] shadow-[var(--marketing-card-shadow)] backdrop-blur-md"
                >
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                className="h-12 rounded-full bg-[var(--auth-button-bg)] px-8 text-[var(--auth-button-fg)] shadow-[0_18px_44px_rgba(244,162,97,0.24)] hover:translate-y-[-1px] hover:opacity-95"
              >
                <Link href="/auth?mode=signup">
                  Sign Up
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-12 rounded-full border-[var(--marketing-card-border)] bg-[var(--marketing-card-bg)] px-8 text-[var(--marketing-heading)] shadow-[var(--marketing-card-shadow)] backdrop-blur-md hover:bg-primary/10 hover:text-[var(--marketing-heading)]"
              >
                <Link href="/auth?mode=login">Login</Link>
              </Button>
            </div>

          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.08 }}
            className="relative"
          >
            <div className="absolute -left-8 top-6 h-24 w-24 rounded-full bg-primary/25 blur-3xl" />
            <div className="absolute -bottom-10 right-0 h-28 w-28 rounded-full bg-[rgba(231,111,81,0.28)] blur-3xl" />

            <div className="relative overflow-hidden rounded-[34px] border border-[var(--marketing-card-border)] bg-[var(--marketing-card-bg)] p-5 shadow-[var(--marketing-card-shadow)] backdrop-blur-md sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--marketing-muted)]">
                    Focus Board
                  </p>
                  <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-[var(--marketing-heading)]">
                    One page for what matters next.
                  </h2>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-[24px] bg-primary text-[#1e293b] shadow-[0_14px_36px_rgba(244,162,97,0.3)]">
                  <Sparkles className="h-6 w-6" />
                </div>
              </div>

              <div className="grid gap-4">
                <div className="rounded-[26px] border border-[rgba(231,111,81,0.3)] bg-[rgba(231,111,81,0.12)] p-5">
                  <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[var(--marketing-muted)]">
                    Priority message
                  </p>
                  <p className="mt-2 text-base font-semibold text-[var(--marketing-heading)]">
                    Dixie noticed your chemistry exam is closer than your current revision pace.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-[26px] border border-[var(--marketing-card-border)] bg-[var(--marketing-panel-bg)] p-5">
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[var(--marketing-muted)]">
                      Next exam
                    </p>
                    <p className="mt-3 font-display text-2xl font-bold text-[var(--marketing-heading)]">Biology 204</p>
                    <p className="mt-1 text-sm text-[var(--marketing-copy)]">Monday, 9:00 AM</p>
                  </div>
                  <div className="rounded-[26px] border border-[var(--marketing-card-border)] bg-[var(--marketing-panel-bg)] p-5">
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[var(--marketing-muted)]">
                      Calendar sync
                    </p>
                    <p className="mt-3 font-display text-2xl font-bold text-[var(--marketing-heading)]">4 tasks due</p>
                    <p className="mt-1 text-sm text-[var(--marketing-copy)]">Google Calendar, auto-sorted by urgency</p>
                  </div>
                </div>

                <div className="rounded-[28px] border border-[var(--marketing-card-border)] bg-[var(--marketing-card-solid)] p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="font-semibold text-[var(--marketing-heading)]">Tonight’s study run</p>
                    <Badge className="rounded-full bg-primary/15 px-3 py-1 text-[0.68rem] uppercase tracking-[0.22em] text-primary">
                      Willow
                    </Badge>
                  </div>
                  <div className="space-y-3">
                    {[
                      'Transcribe econ lecture audio',
                      'Generate 15 flashcards from calc notes',
                      'Push rewritten tasks to calendar',
                    ].map((item) => (
                      <div
                        key={item}
                        className="flex items-center justify-between rounded-2xl border border-[var(--marketing-card-border)] bg-[var(--marketing-panel-bg)] px-4 py-3 text-sm text-[var(--marketing-copy)]"
                      >
                        <span>{item}</span>
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="pb-14 sm:pb-20">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.28em] text-primary">Core features</p>
            <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-[var(--marketing-heading)] sm:text-5xl">
              Everything your study routine keeps dropping.
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-7 text-[var(--marketing-copy)]">
            Modern glassmorphism, strong contrast in both themes, and feature previews that explain the product before the first auth step.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {features.map((feature, index) => (
            <FeatureCard key={feature.title} {...feature} delay={index * 0.06} />
          ))}
        </div>
      </section>
    </div>
  );
}
