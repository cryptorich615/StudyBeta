'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import ThemeToggle from './theme-toggle';
import { Button } from './ui/button';
import { readStoredSession, clearStoredSession, type StoredSession } from '../../lib/session';
import { cn } from '../../lib/utils';
import { LayoutDashboard, Brain, MessageSquare, Settings, LogOut } from 'lucide-react';

const navLinks = [
  { href: '/dashboard', label: 'Dashboard', shortLabel: 'Board', icon: LayoutDashboard },
  { href: '/coach', label: 'Backpack', shortLabel: 'Pack', icon: Brain },
  { href: '/chat', label: 'Chat', shortLabel: 'Chat', icon: MessageSquare },
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
  const isPublicRoute =
    pathname === '/' || pathname === '/auth' || pathname === '/login' || pathname === '/signup';
  const isAuthRoute = pathname === '/auth' || pathname === '/login' || pathname === '/signup';
  const primaryLinks = session ? navLinks : [{ href: '/', label: 'Home', shortLabel: 'Home', icon: LayoutDashboard }, ...navLinks];
  const brandHref = session ? '/dashboard' : '/';

  useEffect(() => {
    setSession(readStoredSession());
  }, [pathname]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);

  const handleLogout = () => {
    clearStoredSession();
    setSession(null);
    router.push('/login');
  };

  // Mandatory onboarding gate: redirect if logged in but no agent set up
  useEffect(() => {
    if (!session) return;
    const isPublic = ['/login', '/auth', '/onboarding', '/'].some(p => pathname.startsWith(p));
    if (isPublic) return;
    // Check if onboarding is complete (agent_type is set in session user)
    const user = (session as any)?.user;
    if (user && !user.agent_type) {
      router.push('/onboarding');
    }
  }, [session, pathname]);

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

            {!isPublicRoute ? (
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
                {session ? session.user.full_name || session.user.email : 'Guest Mode'}
              </div>
            ) : null}
            
            {!session && (
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
      <nav className={cn("fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-md md:hidden", isPublicRoute && "hidden")}>
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
