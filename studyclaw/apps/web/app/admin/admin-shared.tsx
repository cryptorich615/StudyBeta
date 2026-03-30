'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { cn } from '../../lib/utils';

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Never';
  }

  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatRelativePercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'N/A';
  }

  return `${value.toFixed(1)}%`;
}

export function formatTierLabel(value: string | null | undefined) {
  if (!value) {
    return 'Unassigned';
  }

  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function AdminPageHeader(props: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <section className="admin-page-header">
      <div>
        <p className="admin-page-header__eyebrow">{props.eyebrow}</p>
        <h1 className="admin-page-header__title">{props.title}</h1>
        <p className="admin-page-header__description">{props.description}</p>
      </div>
      {props.actions ? <div className="admin-page-header__actions">{props.actions}</div> : null}
    </section>
  );
}

export function AdminStatCard(props: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: 'default' | 'accent' | 'warning' | 'danger';
}) {
  return (
    <Card className={cn('admin-stat-card', props.tone && `is-${props.tone}`)}>
      <CardHeader className="admin-stat-card__header">
        <p className="admin-stat-card__label">{props.label}</p>
        <CardTitle className="admin-stat-card__value">{props.value}</CardTitle>
      </CardHeader>
      {props.detail ? <CardContent className="admin-stat-card__detail">{props.detail}</CardContent> : null}
    </Card>
  );
}

export function StatusPill(props: {
  label: string;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}) {
  return <span className={cn('admin-status-pill', props.tone && `is-${props.tone}`)}>{props.label}</span>;
}

export function AdminEmptyState(props: { title: string; description: string }) {
  return (
    <Card className="admin-empty-state">
      <CardContent className="admin-empty-state__content">
        <h2>{props.title}</h2>
        <p>{props.description}</p>
      </CardContent>
    </Card>
  );
}

export function AdminUsageMeter(props: {
  value: number;
  total: number | null | undefined;
  label: string;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}) {
  const safeTotal = props.total && props.total > 0 ? props.total : null;
  const ratio = safeTotal ? Math.max(0, Math.min(1, props.value / safeTotal)) : 0;

  return (
    <div className={cn('admin-usage-meter', props.tone && `is-${props.tone}`)}>
      <div className="admin-usage-meter__labels">
        <span>{props.label}</span>
        <strong>{safeTotal ? `${props.value}/${safeTotal}` : `${props.value}`}</strong>
      </div>
      <div className="admin-usage-meter__track" aria-hidden="true">
        <div className="admin-usage-meter__fill" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

export type AdminSavedView<T> = {
  id: string;
  label: string;
  description?: string;
  state: T;
  readonly?: boolean;
};

export function useAdminSavedViews<T>(storageKey: string, defaults: AdminSavedView<T>[]) {
  const [customViews, setCustomViews] = useState<AdminSavedView<T>[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setCustomViews([]);
        return;
      }

      const parsed = JSON.parse(raw);
      setCustomViews(Array.isArray(parsed) ? parsed : []);
    } catch {
      setCustomViews([]);
    }
  }, [storageKey]);

  function persist(next: AdminSavedView<T>[]) {
    setCustomViews(next);
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  }

  function saveView(input: { label: string; description?: string; state: T }) {
    const normalizedLabel = input.label.trim();
    if (!normalizedLabel) {
      return false;
    }

    const nextView: AdminSavedView<T> = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
      label: normalizedLabel,
      description: input.description,
      state: input.state,
    };

    const deduped = customViews.filter((view) => view.label.toLowerCase() !== normalizedLabel.toLowerCase());
    persist([nextView, ...deduped].slice(0, 8));
    return true;
  }

  function removeView(id: string) {
    persist(customViews.filter((view) => view.id !== id));
  }

  const views = useMemo(() => [...defaults, ...customViews], [customViews, defaults]);

  return { views, saveView, removeView };
}

export function AdminSavedViewsPanel<T>(props: {
  title?: string;
  description: string;
  storageKey: string;
  defaults: AdminSavedView<T>[];
  currentState: T;
  suggestedLabel: string;
  stateSummary: (state: T) => string;
  onApply: (state: T) => void;
}) {
  const [label, setLabel] = useState(props.suggestedLabel);
  const [message, setMessage] = useState('');
  const { views, saveView, removeView } = useAdminSavedViews(props.storageKey, props.defaults);

  useEffect(() => {
    setLabel(props.suggestedLabel);
  }, [props.suggestedLabel]);

  function handleSave() {
    const ok = saveView({
      label,
      state: props.currentState,
      description: props.stateSummary(props.currentState),
    });

    if (!ok) {
      setMessage('Name this view before saving it.');
      return;
    }

    setMessage('Saved view updated.');
  }

  return (
    <Card className="admin-panel">
      <CardHeader className="admin-panel__header">
        <CardTitle>{props.title ?? 'Saved views'}</CardTitle>
        <div className="admin-panel__summary">
          <span>{props.description}</span>
        </div>
      </CardHeader>
      <CardContent className="admin-panel__content admin-saved-views">
        <div className="admin-saved-views__composer">
          <label className="admin-form-field">
            <span>Preset name</span>
            <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="MiniMax incidents" />
          </label>
          <button type="button" className="admin-secondary-button" onClick={handleSave}>
            Save current view
          </button>
        </div>
        {message ? <p className="admin-saved-views__message">{message}</p> : null}
        <div className="admin-saved-views__grid">
          {views.map((view) => (
            <div key={view.id} className="admin-saved-view-card">
              <button type="button" className="admin-saved-view-card__apply" onClick={() => props.onApply(view.state)}>
                <span>{view.label}</span>
                <small>{view.description || props.stateSummary(view.state)}</small>
              </button>
              {!view.readonly ? (
                <button
                  type="button"
                  className="admin-saved-view-card__remove"
                  onClick={() => removeView(view.id)}
                  aria-label={`Remove ${view.label}`}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
