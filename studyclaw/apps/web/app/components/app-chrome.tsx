'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import ThemeToggle from './theme-toggle';
import { Button } from './ui/button';
import { ACCOUNT_REFRESH_EVENT, apiFetch } from '../../lib/api';
import { readStoredSession, writeStoredSession, clearStoredSession, isOnboardingComplete, type StoredSession } from '../../lib/session';
import { cn } from '../../lib/utils';
import { LayoutDashboard, Brain, MessageSquare, Calendar, Settings, LogOut, GraduationCap, Clock3, Globe } from 'lucide-react';

const navLinks = [
  { href: '/dashboard', label: 'Dashboard', shortLabel: 'Board', icon: LayoutDashboard },
  { href: '/coach', label: 'Backpack', shortLabel: 'Pack', icon: Brain },
  { href: '/chat', label: 'Chat', shortLabel: 'Chat', icon: MessageSquare },
  { href: '/browser', label: 'Browser', shortLabel: 'Browser', icon: Globe },
  { href: '/grades', label: 'Grades', shortLabel: 'Grades', icon: GraduationCap },
  { href: '/schedule', label: 'Schedule', shortLabel: 'Schedule', icon: Clock3 },
  { href: '/calendar', label: 'Calendar', shortLabel: 'Calendar', icon: Calendar },
  { href: '/settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
];

function isActivePath(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
}

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<StoredSession | null>(null);
  const [mounted, setMounted] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const sessionResolved = mounted;
  const onboardingComplete = isOnboardingComplete(session);
  const isPublicRoute =
    pathname === '/'
    || pathname === '/auth'
    || pathname === '/auth/callback'
    || pathname === '/login'
    || pathname === '/signup';
  const isAuthRoute =
    pathname === '/auth' || pathname === '/auth/callback' || pathname === '/login' || pathname === '/signup';
  const isOnboardingRoute = pathname === '/onboarding';
  const isAdminRoute = pathname.startsWith('/admin');
  const shouldLockToOnboarding = sessionResolved && !!session && !onboardingComplete;
  const shouldBlockPrivateRoute = sessionResolved && !session && !isPublicRoute && !isOnboardingRoute;
  const shouldHoldRender =
    !sessionResolved ||
    shouldBlockPrivateRoute ||
    (shouldLockToOnboarding && !isOnboardingRoute);
  const primaryLinks = mounted
    ? session
      ? onboardingComplete
        ? navLinks
        : []
      : [{ href: '/', label: 'Home', shortLabel: 'Home', icon: LayoutDashboard }, ...navLinks]
    : isPublicRoute
      ? [{ href: '/', label: 'Home', shortLabel: 'Home', icon: LayoutDashboard }, ...navLinks]
      : [];
  const brandHref = mounted ? (session ? (onboardingComplete ? '/dashboard' : '/onboarding') : '/') : isPublicRoute ? '/' : '/onboarding';

  useEffect(() => {
    setMounted(true);
    setSession(readStoredSession());
  }, [pathname]);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const refreshAccountState = async () => {
      const stored = readStoredSession();
      if (!stored?.accessToken) {
        setSession(stored);
        return;
      }

      setAccountLoading(true);
      try {
        const response = await apiFetch('/api/auth/me');
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.user) {
          setSession(readStoredSession());
          return;
        }

        const nextSession: StoredSession = {
          ...stored,
          user: {
            ...stored.user,
            ...data.user,
          },
          onboardingComplete: data.onboardingComplete,
          usageProfile: data.usageProfile ?? stored.usageProfile ?? null,
        };
        writeStoredSession(nextSession);
        setSession(nextSession);
      } finally {
        setAccountLoading(false);
      }
    };

    void refreshAccountState();
    const intervalId = window.setInterval(() => {
      void refreshAccountState();
    }, 30000);
    const handleRefresh = () => {
      void refreshAccountState();
    };
    window.addEventListener(ACCOUNT_REFRESH_EVENT, handleRefresh);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(ACCOUNT_REFRESH_EVENT, handleRefresh);
    };
  }, [mounted, pathname]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);

  const handleLogout = () => {
    clearStoredSession();
    setSession(null);
    router.push('/auth?mode=login');
  };

  const creditTracker =
    session?.user?.role !== 'admin' && session?.usageProfile
      ? {
          tier: session.usageProfile.tier ?? 'unassigned',
          remaining: session.usageProfile.creditsRemaining,
          windowLimit: session.usageProfile.windowLimit ?? null,
          windowRemaining: session.usageProfile.remainingInWindow ?? null,
        }
      : null;

  useEffect(() => {
    if (!sessionResolved) {
      return;
    }

    if (session?.user?.role === 'admin') {
      if (pathname === '/dashboard' || pathname === '/onboarding') {
        router.replace('/admin');
      }
      return;
    }

    if (!session) {
      if (!isPublicRoute && !isOnboardingRoute) {
        router.replace('/auth?mode=login');
      }
      return;
    }

    if (!onboardingComplete && !isOnboardingRoute) {
      router.replace('/onboarding');
      return;
    }

    if (onboardingComplete && isOnboardingRoute) {
      router.replace('/dashboard');
    }
  }, [isOnboardingRoute, isPublicRoute, onboardingComplete, pathname, router, session, sessionResolved]);

  if (isAdminRoute) {
    return <>{children}</>;
  }

  if (shouldHoldRender) {
    return (
      <div className="min-h-screen transition-colors duration-500 bg-background">
        <header className="sticky top-4 z-50 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 rounded-3xl border border-border/50 bg-background/70 backdrop-blur-2xl px-4 shadow-xl shadow-foreground/5">
            <Link href={brandHref} className="flex items-center gap-3 group transition-transform hover:scale-[1.02]">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-primary-strong flex items-center justify-center text-[var(--icon-contrast)] font-bold text-lg shadow-lg shadow-primary/30">
                SC
              </div>
              <div className="hidden sm:block">
                <div className="font-display font-bold text-lg leading-none tracking-tight">StudyClaw</div>
              </div>
            </Link>
            <ThemeToggle />
          </div>
        </header>

        <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-32 pt-12">
          <section className="hero-card">
            <p className="insight-chip">Onboarding Gate</p>
            <h1 className="hero-title">
              {session ? 'Finishing your agent setup.' : 'Checking your session.'}
            </h1>
            <p className="hero-description">
              {session
                ? 'StudyClaw locks the rest of the workspace until your agent is fully launched and onboarding is completed.'
                : 'Redirecting you to sign in so onboarding can continue.'}
            </p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen transition-colors duration-500 bg-background">
      {/* Decorative Orbs */}
      <div className="fixed -top-[70px] -right-[130px] w-80 h-80 rounded-full blur-[28px] opacity-30 z-0 pointer-events-none bg-gradient-radial from-primary/30 to-transparent animate-pulse" />
      <div className="fixed bottom-[10%] -left-[120px] w-80 h-80 rounded-full blur-[28px] opacity-20 z-0 pointer-events-none bg-gradient-radial from-accent-strong/20 to-transparent animate-pulse" style={{ animationDelay: '2s' }} />

      <header className="sticky top-4 z-50 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 rounded-3xl border border-border/50 bg-background/70 backdrop-blur-2xl px-4 shadow-xl shadow-foreground/5">
          <div className="flex items-center gap-8">
            <Link href={brandHref} className="flex items-center gap-3 group transition-transform hover:scale-[1.02]">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-primary-strong flex items-center justify-center text-[var(--icon-contrast)] font-bold text-lg shadow-lg shadow-primary/30">
                SC
              </div>
              <div className="hidden sm:block">
                <div className="font-display font-bold text-lg leading-none tracking-tight">StudyClaw</div>
              </div>
            </Link>

            {!isPublicRoute && primaryLinks.length ? (
              <nav className="hidden md:flex items-center gap-1">
                {primaryLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "px-4 py-2 text-sm font-semibold rounded-2xl transition-all duration-200",
                      isActivePath(pathname, link.href) 
                        ? "bg-primary/10 text-primary" 
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            {!isPublicRoute ? (
              <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-secondary/50 border border-border/30 text-[11px] font-bold text-muted-foreground">
                <div
                  className="w-1.5 h-1.5 rounded-full bg-success animate-pulse"
                  style={{ boxShadow: '0 0 8px var(--success-soft)' }}
                />
                {mounted ? (session ? session.user.full_name || session.user.email : 'Guest Mode') : 'Loading'}
              </div>
            ) : null}

            {creditTracker ? (
              <div className="hidden md:flex min-w-[180px] items-center gap-3 rounded-2xl border border-primary/20 bg-primary/10 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                      {creditTracker.tier.replace('_', ' ')}
                    </div>
                    <div className="text-[11px] font-semibold text-foreground">
                      {accountLoading ? 'Updating...' : `${creditTracker.remaining ?? 0} cr`}
                    </div>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full border border-primary/15 bg-background/50">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] via-[var(--primary)] to-[var(--primary-strong)] transition-[width] duration-500"
                      style={{
                        width:
                          creditTracker.windowLimit && creditTracker.windowRemaining !== null
                            ? `${Math.min(Math.max((creditTracker.windowRemaining / creditTracker.windowLimit) * 100, 0), 100)}%`
                            : '100%',
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : null}
            
            {mounted && !session && (
              !isAuthRoute ? (
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="rounded-2xl font-bold" asChild>
                    <Link href="/auth?mode=login">Log in</Link>
                  </Button>
                  <Button size="sm" className="rounded-2xl font-bold px-4" asChild>
                    <Link href="/auth?mode=signup">Sign up</Link>
                  </Button>
                </div>
              ) : null
            )}
            
            {session && (
              <Button variant="ghost" size="icon" className="rounded-2xl text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={handleLogout} title="Log out">
                <LogOut className="w-5 h-5" />
              </Button>
            )}
            
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-32 pt-12">
        {children}
      </main>

      {/* Mobile Dock */}
      <nav className={cn("fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-md md:hidden", (isPublicRoute || !primaryLinks.length) && "hidden")}>
        <div className="flex items-center justify-around p-2 rounded-3xl border border-border/50 bg-background/80 backdrop-blur-2xl shadow-2xl shadow-foreground/10">
          {primaryLinks.map((link) => {
            const Icon = link.icon;
            const active = isActivePath(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex flex-col items-center gap-1 p-2 rounded-2xl transition-all duration-200",
                  active ? "text-primary bg-primary/10" : "text-muted-foreground"
                )}
              >
                <Icon className={cn("w-5 h-5", active && "animate-in zoom-in duration-300")} />
                <span className="text-[10px] font-bold uppercase tracking-tighter">{link.shortLabel}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
