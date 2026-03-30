'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { AdminEmptyState, AdminPageHeader, AdminStatCard, formatDateTime } from '../admin-shared';

type ContentPayload = {
  totals: {
    studyAssets: number;
    flashcardSets: number;
    quizzes: number;
    conversations: number;
    reminders: number;
  };
  recentAssets: Array<{
    id: string;
    title: string;
    assetType: string;
    createdAt: string;
    email: string;
  }>;
  recentStudyArtifacts: Array<{
    id: string;
    title: string;
    itemType: string;
    createdAt: string;
    email: string;
  }>;
};

export default function AdminContentPage() {
  const [data, setData] = useState<ContentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const response = await apiFetch('/api/admin/content');
      const payload = await response.json().catch(() => null);
      if (!active) return;

      if (!response.ok || !payload) {
        setError(payload?.message || 'Failed to load study operations.');
        setLoading(false);
        return;
      }

      setData(payload as ContentPayload);
      setError('');
      setLoading(false);
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="admin-page-stack">
      <AdminPageHeader
        eyebrow="Study ops"
        title="Content and activity visibility"
        description="Aggregate visibility into notes, uploads, flashcards, quizzes, reminders, and recent study artifacts."
      />

      {error ? (
        <Card className="admin-alert-card is-danger">
          <CardContent className="admin-alert-card__content">{error}</CardContent>
        </Card>
      ) : null}

      <section className="admin-stats-grid">
        <AdminStatCard label="Study assets" value={loading ? '...' : data?.totals.studyAssets ?? 0} />
        <AdminStatCard label="Flashcard sets" value={loading ? '...' : data?.totals.flashcardSets ?? 0} />
        <AdminStatCard label="Quizzes" value={loading ? '...' : data?.totals.quizzes ?? 0} />
        <AdminStatCard label="Conversations" value={loading ? '...' : data?.totals.conversations ?? 0} />
        <AdminStatCard label="Reminders" value={loading ? '...' : data?.totals.reminders ?? 0} />
      </section>

      <section className="admin-two-column-grid">
        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Recent study assets</CardTitle>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {data?.recentAssets.length ? (
              data.recentAssets.map((item) => (
                <div key={item.id} className="admin-feed-row">
                  <div>
                    <p className="admin-feed-row__title">{item.title}</p>
                    <p className="admin-feed-row__meta">
                      {item.assetType} · {item.email} · {formatDateTime(item.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <AdminEmptyState title="No study assets yet" description="Uploaded notes and processed assets will appear here." />
            )}
          </CardContent>
        </Card>

        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Recent flashcards and quizzes</CardTitle>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {data?.recentStudyArtifacts.length ? (
              data.recentStudyArtifacts.map((item) => (
                <div key={`${item.itemType}-${item.id}`} className="admin-feed-row">
                  <div>
                    <p className="admin-feed-row__title">{item.title}</p>
                    <p className="admin-feed-row__meta">
                      {item.itemType} · {item.email} · {formatDateTime(item.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <AdminEmptyState title="No study artifacts yet" description="Generated flashcard sets and quizzes will show up here once users create them." />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
