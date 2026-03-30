'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  BookOpenCheck,
  ChevronsRight,
  Command,
  CreditCard,
  Database,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  Search,
  ServerCog,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './ui/button';
import ThemeToggle from './theme-toggle';
import { clearStoredSession } from '../../lib/session';

type AdminShellProps = {
  adminUser: {
    id: string;
    email: string;
    full_name?: string;
  };
  children: React.ReactNode;
};

const adminNav = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/usage', label: 'Plans & Credits', icon: CreditCard },
  { href: '/admin/providers', label: 'Tutors & Models', icon: Activity },
  { href: '/admin/content', label: 'Study Ops', icon: BookOpenCheck },
  { href: '/admin/audit', label: 'Audit', icon: ShieldCheck },
  { href: '/admin/system', label: 'System', icon: ServerCog },
];

function isActive(pathname: string, href: string) {
  return href === '/admin' ? pathname === href : pathname.startsWith(href);
}

function buildBreadcrumbs(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  const crumbs = [{ href: '/admin', label: 'Admin' }];

  if (parts.length <= 1) {
    return crumbs;
  }

  let current = '';
  for (const part of parts.slice(1)) {
    current += `/${part}`;
    crumbs.push({
      href: `/admin${current}`,
      label:
        part.length === 36
          ? 'User Detail'
          : part
              .replace(/-/g, ' ')
              .replace(/\b\w/g, (char) => char.toUpperCase()),
    });
  }

  return crumbs;
}

export default function AdminShell({ adminUser, children }: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [navCollapsed, setNavCollapsed] = useState(false);
  const breadcrumbs = useMemo(() => buildBreadcrumbs(pathname), [pathname]);

  function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = search.trim();
    router.push(query ? `/admin/users?q=${encodeURIComponent(query)}` : '/admin/users');
  }

  function handleLogout() {
    clearStoredSession();
    router.push('/auth?mode=login');
  }

  return (
    <div className={cn('admin-shell', navCollapsed && 'is-collapsed')}>
      <aside className="admin-shell__sidebar">
        <div className="admin-shell__brand">
          <div className="admin-shell__logo">SB</div>
          <div>
            <p className="admin-shell__eyebrow">Internal Console</p>
            <h1 className="admin-shell__title">StudyBeta Ops</h1>
          </div>
        </div>

        <nav className="admin-shell__nav" aria-label="Admin navigation">
          {adminNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn('admin-shell__nav-link', active && 'is-active')}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="admin-shell__sidebar-card">
          <div className="admin-shell__sidebar-card-label">Operator</div>
          <div className="admin-shell__sidebar-card-value">{adminUser.full_name || adminUser.email}</div>
          <div className="admin-shell__sidebar-card-meta">{adminUser.email}</div>
        </div>
      </aside>

      <div className="admin-shell__main">
        <header className="admin-shell__topbar">
          <div className="admin-shell__topbar-group">
            <Button
              variant="ghost"
              size="icon"
              className="admin-shell__quick-button admin-shell__collapse-button"
              onClick={() => setNavCollapsed((value) => !value)}
              title={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
            <div className="admin-shell__breadcrumbs" aria-label="Breadcrumb">
              {breadcrumbs.map((crumb, index) => (
                <span key={crumb.href} className="admin-shell__breadcrumb-item">
                  {index > 0 ? <ChevronsRight className="h-3.5 w-3.5 text-[var(--admin-text-muted)]" /> : null}
                  <Link href={crumb.href}>{crumb.label}</Link>
                </span>
              ))}
            </div>
          </div>

          <div className="admin-shell__topbar-actions">
            <form className="admin-shell__search" onSubmit={handleSearchSubmit}>
              <Search className="h-4 w-4 text-[var(--admin-text-muted)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search users, emails, IDs"
                aria-label="Search users"
              />
            </form>

            <Button variant="outline" size="sm" className="admin-shell__quick-button" asChild>
              <Link href="/admin/usage">
                <Database className="h-4 w-4" />
                Credits
              </Link>
            </Button>
            <Button variant="outline" size="sm" className="admin-shell__quick-button" asChild>
              <Link href="/admin/system">
                <Command className="h-4 w-4" />
                System
              </Link>
            </Button>
            <Button variant="ghost" size="icon" className="admin-shell__quick-button" onClick={handleLogout} title="Log out">
              <LogOut className="h-4 w-4" />
            </Button>
            <ThemeToggle />
            <div className="admin-shell__identity">
              <p className="admin-shell__identity-label">Signed in as</p>
              <p className="admin-shell__identity-value">{adminUser.full_name || 'Admin'}</p>
            </div>
          </div>
        </header>

        <main className="admin-shell__content">{children}</main>
      </div>
    </div>
  );
}
