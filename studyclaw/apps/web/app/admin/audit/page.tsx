'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { AdminEmptyState, AdminPageHeader, AdminStatCard, StatusPill, formatDateTime } from '../admin-shared';

type AuditPayload = {
  events: Array<{
    id: string;
    eventType: string;
    entityType: string;
    entityId: string | null;
    summary: string;
    actorEmail: string | null;
    targetEmail: string | null;
    createdAt: string;
  }>;
};

export default function AdminAuditPage() {
  const [data, setData] = useState<AuditPayload | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [eventType, setEventType] = useState('');
  const [entityType, setEntityType] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      const response = await apiFetch('/api/admin/audit?limit=100');
      const payload = await response.json().catch(() => null);
      if (!active) return;

      if (!response.ok || !payload) {
        setError(payload?.message || 'Failed to load audit events.');
        return;
      }

      setData(payload as AuditPayload);
      setError('');
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  const events = data?.events ?? [];
  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return events.filter((event) => {
      if (eventType && event.eventType !== eventType) return false;
      if (entityType && event.entityType !== entityType) return false;
      if (!normalizedQuery) return true;

      const haystack = [
        event.summary,
        event.eventType,
        event.entityType,
        event.actorEmail,
        event.targetEmail,
        event.entityId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [entityType, eventType, events, query]);

  const eventTypeOptions = useMemo(
    () => Array.from(new Set(events.map((event) => event.eventType))).sort(),
    [events]
  );
  const entityTypeOptions = useMemo(
    () => Array.from(new Set(events.map((event) => event.entityType))).sort(),
    [events]
  );

  return (
    <div className="admin-page-stack">
      <AdminPageHeader
        eyebrow="Audit"
        title="Administrative event history"
        description="Structured admin-visible history for account changes, tier edits, resets, and privileged actions."
      />

      {!error ? (
        <section className="admin-stats-grid">
          <AdminStatCard label="Loaded events" value={events.length} detail="Current audit dataset" />
          <AdminStatCard label="Visible events" value={filteredEvents.length} detail="Matches current audit filters" tone="accent" />
          <AdminStatCard label="Actors" value={new Set(events.map((event) => event.actorEmail || 'system')).size} detail="Unique operator identities" />
          <AdminStatCard label="Entity types" value={entityTypeOptions.length} detail="Distinct audited resource groups" />
          <AdminStatCard label="Event types" value={eventTypeOptions.length} detail="Distinct privileged actions" />
          <AdminStatCard label="Targeted accounts" value={new Set(events.map((event) => event.targetEmail || event.entityType)).size} detail="Unique affected targets" />
        </section>
      ) : null}

      {error ? (
        <Card className="admin-alert-card is-danger">
          <CardContent className="admin-alert-card__content">{error}</CardContent>
        </Card>
      ) : null}

      <Card className="admin-panel">
        <CardContent className="admin-filter-bar">
          <label className="admin-filter admin-filter--search">
            <Search className="h-4 w-4 text-[var(--admin-text-muted)]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search summaries, actors, targets, IDs" />
          </label>

          <label className="admin-filter">
            <span>Event type</span>
            <select value={eventType} onChange={(event) => setEventType(event.target.value)}>
              <option value="">All</option>
              {eventTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-filter">
            <span>Entity type</span>
            <select value={entityType} onChange={(event) => setEntityType(event.target.value)}>
              <option value="">All</option>
              {entityTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      <Card className="admin-panel">
        <CardHeader className="admin-panel__header">
          <CardTitle>Audit events</CardTitle>
          <div className="admin-panel__summary">
            <span>{filteredEvents.length} in view</span>
            <span>{eventType || 'All event types'} · {entityType || 'All entities'}</span>
          </div>
        </CardHeader>
        <CardContent className="admin-panel__content admin-feed-list">
          {filteredEvents.length ? (
            filteredEvents.map((event) => (
              <div key={event.id} className="admin-feed-row admin-feed-row--stack">
                <div className="admin-feed-row__topline">
                  <p className="admin-feed-row__title">{event.summary}</p>
                  <StatusPill label={event.eventType.replace(/_/g, ' ')} tone="info" />
                </div>
                <p className="admin-feed-row__meta">
                  {event.actorEmail || 'System'} → {event.targetEmail || event.entityType} · {formatDateTime(event.createdAt)}
                  {event.entityId ? ` · ${event.entityId}` : ''}
                </p>
                <div className="admin-selection-strip">
                  <span className="admin-selection-pill">{event.entityType.replace(/_/g, ' ')}</span>
                  {event.actorEmail ? <span className="admin-selection-pill">{event.actorEmail}</span> : null}
                  {event.targetEmail ? <span className="admin-selection-pill">{event.targetEmail}</span> : null}
                </div>
              </div>
            ))
          ) : (
            <AdminEmptyState title="No matching admin events" description="Try broadening the search or clearing the current audit filters." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
