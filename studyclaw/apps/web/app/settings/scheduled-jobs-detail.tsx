'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { SettingsDetailShell, SettingsStatus, useSettingsSnapshot } from './settings-core';

export function ScheduledJobsDetail() {
  const { snapshot, status, setSnapshot, setStatus } = useSettingsSnapshot();
  const [cronName, setCronName] = useState('');
  const [cronMessage, setCronMessage] = useState('');
  const [cronScheduleKind, setCronScheduleKind] = useState<'at' | 'cron' | 'every'>('at');
  const [cronScheduleValue, setCronScheduleValue] = useState('');
  const [cronTimezone, setCronTimezone] = useState('America/New_York');
  const [updatingCron, setUpdatingCron] = useState('');

  async function createCronJob() {
    if (!cronName.trim() || !cronMessage.trim() || !cronScheduleValue.trim()) {
      setStatus('Cron name, prompt, and schedule are required.');
      return;
    }

    setUpdatingCron('create');
    const response = await apiFetch('/api/openclaw/cron', {
      method: 'POST',
      body: JSON.stringify({
        name: cronName.trim(),
        message: cronMessage.trim(),
        scheduleKind: cronScheduleKind,
        scheduleValue: cronScheduleValue.trim(),
        timezone: cronScheduleKind === 'cron' ? cronTimezone.trim() : undefined,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus(data.message || 'Failed to create cron job');
      setUpdatingCron('');
      return;
    }

    setSnapshot(data);
    setStatus('');
    setCronName('');
    setCronMessage('');
    setCronScheduleValue('');
    setUpdatingCron('');
  }

  async function deleteCronJob(jobId: string) {
    setUpdatingCron(jobId);
    const response = await apiFetch(`/api/openclaw/cron/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus(data.message || 'Failed to delete cron job');
      setUpdatingCron('');
      return;
    }

    setSnapshot(data);
    setStatus('');
    setUpdatingCron('');
  }

  return (
    <SettingsDetailShell
      badge="Scheduled Jobs"
      title="Set up repeatable agent work."
      description="The cron editor and job list now live on their own detail page instead of competing with every other settings area."
    >
      <SettingsStatus status={status} probe={snapshot?.diagnostics.channelsProbe} />

      <div className="card-grid">
        <section className="secondary-card">
          <p className="eyebrow">Create job</p>
          <div className="form-field">
            <label htmlFor="cron-name">Job name</label>
            <input id="cron-name" value={cronName} onChange={(event) => setCronName(event.target.value)} placeholder="Daily study check-in" />
          </div>
          <div className="form-field">
            <label htmlFor="cron-message">Job prompt</label>
            <textarea
              id="cron-message"
              rows={4}
              value={cronMessage}
              onChange={(event) => setCronMessage(event.target.value)}
              placeholder="Tell your agent what to do when this cron job runs."
            />
          </div>
          <div className="form-field">
            <label htmlFor="cron-kind">Schedule type</label>
            <select id="cron-kind" value={cronScheduleKind} onChange={(event) => setCronScheduleKind(event.target.value as 'at' | 'cron' | 'every')}>
              <option value="at">Run once</option>
              <option value="cron">Cron expression</option>
              <option value="every">Repeat every</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="cron-value">{cronScheduleKind === 'at' ? 'When (ISO or +duration)' : cronScheduleKind === 'cron' ? 'Cron expression' : 'Repeat every duration'}</label>
            <input
              id="cron-value"
              value={cronScheduleValue}
              onChange={(event) => setCronScheduleValue(event.target.value)}
              placeholder={cronScheduleKind === 'at' ? '2026-03-25T13:03:00-04:00 or +20m' : cronScheduleKind === 'cron' ? '0 13 * * *' : '1h'}
            />
          </div>
          {cronScheduleKind === 'cron' ? (
            <div className="form-field">
              <label htmlFor="cron-timezone">Timezone</label>
              <input id="cron-timezone" value={cronTimezone} onChange={(event) => setCronTimezone(event.target.value)} placeholder="America/New_York" />
            </div>
          ) : null}
          <div className="actions">
            <button type="button" onClick={() => void createCronJob()} disabled={updatingCron === 'create'}>
              {updatingCron === 'create' ? 'Creating...' : 'Create cron job'}
            </button>
          </div>
        </section>

        <section className="secondary-card">
          <p className="eyebrow">System status</p>
          <div className="settings-stack" style={{ marginTop: 14 }}>
            <div className="settings-row">
              <div>
                <strong>Cron service</strong>
                <p className="muted-copy" style={{ margin: '4px 0 0' }}>{snapshot?.cron.status ?? 'Loading...'}</p>
              </div>
              <span className="settings-badge">{snapshot?.cron.jobs?.length ?? 0} jobs</span>
            </div>
          </div>
        </section>
      </div>

      <section className="secondary-card">
        <p className="eyebrow">Your jobs</p>
        <div className="settings-stack" style={{ marginTop: 14 }}>
          {(snapshot?.cron.jobs ?? []).length ? (
            snapshot?.cron.jobs.map((job) => {
              const jobId = String(job.jobId ?? job.id ?? '');
              const scheduleLabel =
                job.schedule?.kind === 'at'
                  ? job.schedule?.at
                  : job.schedule?.kind === 'every'
                    ? `${job.schedule?.everyMs ?? 'unknown'} ms`
                    : job.schedule?.expr ?? 'Unknown schedule';

              return (
                <div className="settings-row" key={jobId}>
                  <div>
                    <strong>{String(job.name ?? jobId)}</strong>
                    <p className="muted-copy" style={{ margin: '4px 0 0' }}>{String(scheduleLabel)}</p>
                  </div>
                  <button
                    type="button"
                    className="chat-mini-button"
                    onClick={() => void deleteCronJob(jobId)}
                    disabled={updatingCron === jobId}
                  >
                    {updatingCron === jobId ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              );
            })
          ) : (
            <p className="muted-copy">No cron jobs created for this StudyClaw user yet.</p>
          )}
        </div>
      </section>
    </SettingsDetailShell>
  );
}
