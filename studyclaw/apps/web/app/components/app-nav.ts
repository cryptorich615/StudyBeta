'use client';

import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard, Brain, MessageSquare, Calendar, Settings, GraduationCap, Clock3, Globe } from 'lucide-react';

export type AppNavLink = {
  href: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
};

export const appNavLinks: AppNavLink[] = [
  { href: '/dashboard', label: 'Dashboard', shortLabel: 'Board', icon: LayoutDashboard },
  { href: '/coach', label: 'Backpack', shortLabel: 'Pack', icon: Brain },
  { href: '/chat', label: 'Chat', shortLabel: 'Chat', icon: MessageSquare },
  { href: '/browser', label: 'Browser', shortLabel: 'Browser', icon: Globe },
  { href: '/grades', label: 'Grades', shortLabel: 'Grades', icon: GraduationCap },
  { href: '/schedule', label: 'Schedule', shortLabel: 'Schedule', icon: Clock3 },
  { href: '/calendar', label: 'Calendar', shortLabel: 'Calendar', icon: Calendar },
  { href: '/settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
];

export function isActivePath(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname.startsWith(href);
}
