'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type DashboardLayoutMode = 'default' | 'alternate';

type DashboardLayoutContextValue = {
  dashboardLayout: DashboardLayoutMode;
  setDashboardLayout: (layout: DashboardLayoutMode) => void;
  toggleDashboardLayout: () => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  closeMobileSidebar: () => void;
};

const DASHBOARD_LAYOUT_KEY = 'studyclaw:dashboard-layout';
const DASHBOARD_SIDEBAR_KEY = 'studyclaw:dashboard-sidebar-collapsed';

const DashboardLayoutContext = createContext<DashboardLayoutContextValue | null>(null);

export function DashboardLayoutProvider({ children }: { children: React.ReactNode }) {
  const [dashboardLayout, setDashboardLayoutState] = useState<DashboardLayoutMode>('default');
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const storedLayout = window.sessionStorage.getItem(DASHBOARD_LAYOUT_KEY);
    if (storedLayout === 'alternate' || storedLayout === 'default') {
      setDashboardLayoutState(storedLayout);
    }

    const storedSidebar = window.sessionStorage.getItem(DASHBOARD_SIDEBAR_KEY);
    if (storedSidebar === '1') {
      setSidebarCollapsedState(true);
    }
  }, []);

  const value = useMemo<DashboardLayoutContextValue>(() => ({
    dashboardLayout,
    setDashboardLayout: (layout) => {
      setDashboardLayoutState(layout);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(DASHBOARD_LAYOUT_KEY, layout);
      }
      if (layout === 'default') {
        setMobileSidebarOpen(false);
      }
    },
    toggleDashboardLayout: () => {
      const nextLayout = dashboardLayout === 'default' ? 'alternate' : 'default';
      setDashboardLayoutState(nextLayout);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(DASHBOARD_LAYOUT_KEY, nextLayout);
      }
      if (nextLayout === 'default') {
        setMobileSidebarOpen(false);
      }
    },
    sidebarCollapsed,
    setSidebarCollapsed: (collapsed) => {
      setSidebarCollapsedState(collapsed);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(DASHBOARD_SIDEBAR_KEY, collapsed ? '1' : '0');
      }
    },
    toggleSidebarCollapsed: () => {
      setSidebarCollapsedState((current) => {
        const next = !current;
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(DASHBOARD_SIDEBAR_KEY, next ? '1' : '0');
        }
        return next;
      });
    },
    mobileSidebarOpen,
    setMobileSidebarOpen,
    closeMobileSidebar: () => setMobileSidebarOpen(false),
  }), [dashboardLayout, mobileSidebarOpen, sidebarCollapsed]);

  return (
    <DashboardLayoutContext.Provider value={value}>
      {children}
    </DashboardLayoutContext.Provider>
  );
}

export function useDashboardLayout() {
  const context = useContext(DashboardLayoutContext);
  if (!context) {
    throw new Error('useDashboardLayout must be used within DashboardLayoutProvider');
  }
  return context;
}
