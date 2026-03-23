import type { Metadata } from 'next';
import LandingPage from './components/landing-page';

export const metadata: Metadata = {
  title: 'StudyClaw | Your AI Study Coach that never sleeps',
  description:
    'StudyClaw helps students turn notes, calendar deadlines, audio, and exam prep into a focused AI-powered study workflow.',
  openGraph: {
    title: 'StudyClaw',
    description: 'Your AI Study Coach that never sleeps.',
    type: 'website',
  },
};

export default function HomePage() {
  return <LandingPage />;
}
