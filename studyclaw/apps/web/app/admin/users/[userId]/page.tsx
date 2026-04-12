'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '../../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { AdminEmptyState, AdminPageHeader, AdminStatCard, AdminUsageMeter, StatusPill, formatDateTime, formatTierLabel } from '../../admin-shared';

type UserDetailPayload = {
  user: {
    id: string;
    email: string;
    fullName: string | null;
    role: string;
    createdAt: string;
    updatedAt: string;
    onboardingComplete: boolean;
    schoolName: string | null;
    schoolLevel: string | null;
    gradeYear: string | null;
    major: string | null;
  };
  usage: {
    tier: string | null;
    billingMode: string;
    creditsTotal: number;
    creditsRemaining: number;
    usedInWindow: number;
    windowLimit: number | null;
    providerSelection: string | null;
    modelSelection: string | null;
    internalUsageIdentity: string | null;
  } | null;
  counts: {
    studyAssets: number;
    flashcardSets: number;
    quizzes: number;
    conversations: number;
    reminders: number;
  };
  usageEvents: Array<{
    id: string;
    feature: string;
    modelKey: string;
    status: string;
    requestUnits: number;
    reservedAt: string;
  }>;
  auditEvents: Array<{
    id: string;
    eventType: string;
    summary: string;
    createdAt: string;
  }>;
};

type PendingAction =
  | {
      kind: 'tier';
      title: string;
      detail: string;
      confirmLabel: string;
      run: () => Promise<void>;
    }
  | {
      kind: 'credits';
      title: string;
      detail: string;
      confirmLabel: string;
      run: () => Promise<void>;
    };

export default function AdminUserDetailPage() {
  const params = useParams<{ userId: string }>();
  const userId = Array.isArray(params.userId) ? params.userId[0] : params.userId;
  const [data, setData] = useState<UserDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'neutral' | 'success' | 'danger'>('neutral');
  const [creditDelta, setCreditDelta] = useState('100');
  const [tier, setTier] = useState('tier_1');
  const [submitting, setSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  async function loadDetail() {
    const response = await apiFetch(`/api/admin/users/${userId}`);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      setStatus(payload?.message || 'Failed to load user detail.');
      setStatusTone('danger');
      setLoading(false);
      return;
    }

    setData(payload as UserDetailPayload);
    setTier(payload?.usage?.tier ?? 'tier_1');
    setStatus('');
    setStatusTone('neutral');
    setLoading(false);
  }

  useEffect(() => {
    async function run() {
      setLoading(true);
      await loadDetail();
    }

    void run();
  }, [userId]);

  async function runCreditAdjust() {
    setSubmitting(true);
    const response = await apiFetch(`/api/admin/users/${userId}/credits`, {
      method: 'PATCH',
      body: JSON.stringify({
        delta: Number(creditDelta),
        reason: 'Admin console adjustment',
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.message || 'Failed to adjust credits.');
      setStatusTone('danger');
      setSubmitting(false);
      return;
    }

    setStatus('Credits updated.');
    setStatusTone('success');
    setPendingAction(null);
    await loadDetail();
    setSubmitting(false);
  }

  async function runTierUpdate(resetCredits: boolean) {
    setSubmitting(true);
    const response = await apiFetch(`/api/admin/users/${userId}/tier`, {
      method: 'PATCH',
      body: JSON.stringify({
        tier,
        resetCredits,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.message || 'Failed to update tier.');
      setStatusTone('danger');
      setSubmitting(false);
      return;
    }

    setStatus(resetCredits ? 'Tier and credits reset.' : 'Tier updated.');
    setStatusTone('success');
    setPendingAction(null);
    await loadDetail();
    setSubmitting(false);
  }

  const creditDeltaNumber = Number(creditDelta);
  const projectedCredits = useMemo(() => {
    const current = data?.usage?.creditsRemaining ?? 0;
    if (Number.isNaN(creditDeltaNumber)) {
      return current;
    }

    return current + creditDeltaNumber;
  }, [creditDeltaNumber, data?.usage?.creditsRemaining]);

  function queueTierUpdate(resetCredits: boolean) {
    setPendingAction({
      kind: 'tier',
      title: resetCredits ? 'Reset tier credits and save plan' : 'Save tier change',
      detail: resetCredits
        ? `Apply ${formatTierLabel(tier)} and reseed the account credit pool to the tier default.`
        : `Apply ${formatTierLabel(tier)} without resetting the current remaining credits.`,
      confirmLabel: resetCredits ? 'Confirm tier reset' : 'Confirm tier change',
      run: () => runTierUpdate(resetCredits),
    });
  }

  function queueCreditAdjust() {
    if (Number.isNaN(creditDeltaNumber)) {
      setStatus('Credit delta must be a valid number.');
      setStatusTone('danger');
      return;
    }

    setPendingAction({
      kind: 'credits',
      title: creditDeltaNumber >= 0 ? 'Grant credits' : 'Remove credits',
      detail: `${creditDeltaNumber >= 0 ? 'Apply' : 'Deduct'} ${Math.abs(creditDeltaNumber)} credits. Projected balance: ${projectedCredits}.`,
      confirmLabel: creditDeltaNumber >= 0 ? 'Confirm credit grant' : 'Confirm credit removal',
      run: () => runCreditAdjust(),
    });
  }

  if (loading) {
    return (
      <div className="admin-page-stack">
        <AdminPageHeader eyebrow="User detail" title="Loading account…" description="Fetching account state, usage, and recent events." />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="admin-page-stack">
        <AdminEmptyState title="User not found" description="The requested account could not be loaded." />
      </div>
    );
  }

  return (
    <div className="admin-page-stack">
      <AdminPageHeader
        eyebrow="User detail"
        title={data.user.fullName || data.user.email}
        description={`${data.user.email} · ${data.user.role} · created ${formatDateTime(data.user.createdAt)}`}
      />

      {status ? (
        <Card className={`admin-alert-card${statusTone === 'danger' ? ' is-danger' : statusTone === 'success' ? ' is-success' : ''}`}>
          <CardContent className="admin-alert-card__content">{status}</CardContent>
        </Card>
      ) : null}

      <section className="admin-stats-grid">
        <AdminStatCard label="Tier" value={formatTierLabel(data.usage?.tier)} detail={data.usage?.billingMode || 'No billing mode'} />
        <AdminStatCard label="Credits left" value={data.usage?.creditsRemaining ?? 0} detail={`of ${data.usage?.creditsTotal ?? 0}`} />
        <AdminStatCard label="Window usage" value={`${data.usage?.usedInWindow ?? 0}/${data.usage?.windowLimit ?? '∞'}`} detail={data.usage?.modelSelection || 'No active model'} />
        <AdminStatCard label="Onboarding" value={data.user.onboardingComplete ? 'Complete' : 'Pending'} detail={data.user.schoolLevel || 'No school profile'} />
      </section>

      <section className="admin-two-column-grid">
        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Account controls</CardTitle>
            <div className="admin-panel__summary">
              <span>Privileged changes write to audit history</span>
              <span>Review before confirming</span>
            </div>
          </CardHeader>
          <CardContent className="admin-panel__content admin-control-stack">
            <div className="admin-form-row">
              <label className="admin-form-field">
                <span>Tier</span>
                <select value={tier} onChange={(event) => setTier(event.target.value)}>
                  <option value="tier_1">Tier 1</option>
                  <option value="tier_2">Tier 2</option>
                  <option value="tier_3">Tier 3</option>
                </select>
              </label>
              <div className="admin-inline-actions">
                <Button className="admin-primary-button" disabled={submitting} onClick={() => queueTierUpdate(false)}>
                  Save tier
                </Button>
                <Button variant="outline" className="admin-secondary-button" disabled={submitting} onClick={() => queueTierUpdate(true)}>
                  Reset credits
                </Button>
              </div>
            </div>

            <div className="admin-form-row">
              <label className="admin-form-field">
                <span>Credit delta</span>
                <input value={creditDelta} onChange={(event) => setCreditDelta(event.target.value)} placeholder="100 or -50" />
              </label>
              <Button className="admin-primary-button" disabled={submitting} onClick={() => queueCreditAdjust()}>
                Adjust credits
              </Button>
            </div>

            {pendingAction ? (
              <div className="admin-confirmation-card">
                <div className="admin-confirmation-card__head">
                  <div>
                    <p className="admin-detail-grid__label">Ready to apply</p>
                    <p className="admin-confirmation-card__title">{pendingAction.title}</p>
                  </div>
                  <StatusPill label={pendingAction.kind === 'tier' ? 'Tier change' : 'Credit adjustment'} tone={pendingAction.kind === 'tier' ? 'info' : 'warning'} />
                </div>
                <p className="admin-confirmation-card__detail">{pendingAction.detail}</p>
                <div className="admin-confirmation-card__meta">
                  <span>Target: {data.user.fullName || data.user.email}</span>
                  <span>{data.user.email}</span>
                </div>
                <div className="admin-inline-actions">
                  <Button className="admin-primary-button" disabled={submitting} onClick={() => void pendingAction.run()}>
                    {pendingAction.confirmLabel}
                  </Button>
                  <Button variant="outline" className="admin-secondary-button" disabled={submitting} onClick={() => setPendingAction(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="admin-notice-row is-info">
                <span>Choose a tier or credit change to prepare a confirmation step before anything is written.</span>
              </div>
            )}

            <div className="admin-detail-grid">
              <div>
                <p className="admin-detail-grid__label">Usage identity</p>
                <p className="admin-detail-grid__value">{data.usage?.internalUsageIdentity || 'Not assigned'}</p>
              </div>
              <div>
                <p className="admin-detail-grid__label">Provider</p>
                <p className="admin-detail-grid__value">{data.usage?.providerSelection || 'None'}</p>
              </div>
              <div>
                <p className="admin-detail-grid__label">Model</p>
                <p className="admin-detail-grid__value">{data.usage?.modelSelection || 'None'}</p>
              </div>
              <div>
                <p className="admin-detail-grid__label">School profile</p>
                <p className="admin-detail-grid__value">
                  {[data.user.schoolName, data.user.gradeYear, data.user.major].filter(Boolean).join(' · ') || 'No profile data'}
                </p>
              </div>
              <div className="admin-detail-grid__span">
                <AdminUsageMeter
                  value={Math.max(0, (data.usage?.creditsTotal ?? 0) - (data.usage?.creditsRemaining ?? 0))}
                  total={data.usage?.creditsTotal ?? 0}
                  label="Credits consumed"
                  tone={(data.usage?.creditsRemaining ?? 0) === 0 ? 'danger' : (data.usage?.creditsRemaining ?? 0) < Math.max(200, (data.usage?.creditsTotal ?? 0) * 0.2) ? 'warning' : 'success'}
                />
              </div>
              <div className="admin-detail-grid__span">
                <AdminUsageMeter
                  value={data.usage?.usedInWindow ?? 0}
                  total={data.usage?.windowLimit ?? null}
                  label="Current 5h window"
                  tone={data.usage?.windowLimit && (data.usage.usedInWindow / data.usage.windowLimit) >= 0.95 ? 'danger' : data.usage?.windowLimit && (data.usage.usedInWindow / data.usage.windowLimit) >= 0.8 ? 'warning' : 'default'}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Study activity</CardTitle>
          </CardHeader>
          <CardContent className="admin-panel__content admin-detail-grid">
            <div>
              <p className="admin-detail-grid__label">Study assets</p>
              <p className="admin-detail-grid__value">{data.counts.studyAssets}</p>
            </div>
            <div>
              <p className="admin-detail-grid__label">Flashcard sets</p>
              <p className="admin-detail-grid__value">{data.counts.flashcardSets}</p>
            </div>
            <div>
              <p className="admin-detail-grid__label">Quizzes</p>
              <p className="admin-detail-grid__value">{data.counts.quizzes}</p>
            </div>
            <div>
              <p className="admin-detail-grid__label">Conversations</p>
              <p className="admin-detail-grid__value">{data.counts.conversations}</p>
            </div>
            <div>
              <p className="admin-detail-grid__label">Reminders</p>
              <p className="admin-detail-grid__value">{data.counts.reminders}</p>
            </div>
            <div>
              <p className="admin-detail-grid__label">Status</p>
              <StatusPill label={data.user.onboardingComplete ? 'Onboarded' : 'Needs onboarding'} tone={data.user.onboardingComplete ? 'success' : 'warning'} />
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="admin-two-column-grid">
        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Recent usage events</CardTitle>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {data.usageEvents.length ? (
              data.usageEvents.map((event) => (
                <div key={event.id} className="admin-feed-row">
                  <div>
                    <p className="admin-feed-row__title">{event.feature}</p>
                    <p className="admin-feed-row__meta">
                      {event.modelKey} · {event.requestUnits} units · {formatDateTime(event.reservedAt)}
                    </p>
                  </div>
                  <StatusPill
                    label={event.status}
                    tone={event.status === 'failed' ? 'danger' : event.status === 'consumed' ? 'success' : 'warning'}
                  />
                </div>
              ))
            ) : (
              <AdminEmptyState title="No usage events" description="Managed usage events will appear here after this user hits a tracked provider flow." />
            )}
          </CardContent>
        </Card>

        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Audit events</CardTitle>
            <div className="admin-panel__summary">
              <Link href="/admin/audit" className="admin-table__link">
                Open full audit log
              </Link>
            </div>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {data.auditEvents.length ? (
              data.auditEvents.map((event) => (
                <div key={event.id} className="admin-feed-row">
                  <div>
                    <p className="admin-feed-row__title">{event.summary}</p>
                    <p className="admin-feed-row__meta">
                      {event.eventType.replace(/_/g, ' ')} · {formatDateTime(event.createdAt)}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <AdminEmptyState title="No admin audit events" description="Tier and credit changes, resets, and admin actions will appear here." />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
