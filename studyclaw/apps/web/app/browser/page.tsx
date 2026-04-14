'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { apiFetch, readApiPayload, getApiErrorMessage } from '../../lib/api';

type BrowserSessionPayload = {
  sessionId: string;
  remoteUrl: string;
  launchUrl: string;
  embedUrl?: string;
  status: string;
  embedAllowed: boolean;
  provider: string;
  timeoutMinutes: number;
  restrictionsEnabled: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Ready',
  ended: 'Ended',
};

export default function BrowserPage() {
  const [session, setSession] = useState<BrowserSessionPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [iframeBlocked, setIframeBlocked] = useState(false);

  const statusText = useMemo(() => {
    if (session) {
      return STATUS_LABELS[session.status] ?? session.status;
    }
    if (loading) {
      return 'Checking browser status...';
    }
    return 'Browser not launched yet';
  }, [loading, session]);

  async function loadSession() {
    setLoading(true);
    setError('');
    setStatusMessage('');

    try {
      const response = await apiFetch('/api/browser/session');
      const payload = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(getApiErrorMessage(response, 'Unable to reach the remote browser'));
      }
      setSession(payload as BrowserSessionPayload);
      setStatusMessage('Browser ready for you.');
      setIframeBlocked(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch the browser');
      setSession(null);
      setStatusMessage('Browser is unavailable right now.');
    } finally {
      setLoading(false);
    }
  }

  function openInNewTab() {
    if (!session?.launchUrl) {
      return;
    }
    window.open(session.launchUrl, '_blank', 'noopener,noreferrer');
  }

  useEffect(() => {
    void loadSession();
  }, []);

  return (
    <div className="browser-page">
      <header className="browser-page__hero">
        <div>
          <p className="eyebrow">StudyClaw Browser</p>
          <h1 className="section-title">Use a school-focused remote browser inside StudyClaw.</h1>
          <p className="muted-copy">
            Launch the managed StudyClaw browser hosted on AWS so you can research, check textbooks, or visit resources without leaving the app.
          </p>
        </div>
        <div className="browser-page__hero-actions">
          <div>
            <span className="status-label">Status</span>
            <p className="status-value">{statusText}</p>
            <p className="status-detail">{session?.status === 'active' ? 'Remote browser session is live.' : statusMessage}</p>
          </div>
          <div className="browser-page__hero-buttons">
            <Button onClick={() => void loadSession()} disabled={loading} variant="secondary">
              {loading ? 'Checking...' : 'Launch Browser'}
            </Button>
            <Button onClick={openInNewTab} disabled={!session?.launchUrl}>
              Open browser in a new tab
            </Button>
          </div>
        </div>
      </header>

      <section className="browser-page__note">
        <p>
          StudyClaw routes you to a secure remote session hosted on the AWS study server. All interaction happens on the server side, so nothing runs on your local device.
        </p>
      </section>

      <section className="browser-page__library-card">
        <div>
          <p className="eyebrow">Library</p>
          <h2 className="section-title">StudyClaw eReader</h2>
          <p className="muted-copy">
            Open the combined Library + eReader workspace to browse uploaded documents, resume saved books, and read inside StudyClaw without dropping back to raw file links.
          </p>
        </div>
        <div className="browser-page__hero-buttons">
          <Button asChild>
            <Link href="/study">Open Library workspace</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/reader" target="_blank" rel="noreferrer">
              Open full reader in a new tab
            </Link>
          </Button>
        </div>
      </section>

      {error && (
        <section className="browser-page__message browser-page__message--error">
          {error}
        </section>
      )}

      <section className="browser-page__status">
        <div className="browser-page__status-card">
          <p className="browser-page__status-title">Provider</p>
          <p className="browser-page__status-value">{session?.provider ?? 'Loading...'}</p>
        </div>
        <div className="browser-page__status-card">
          <p className="browser-page__status-title">Embed allowed</p>
          <p className="browser-page__status-value">{session?.embedAllowed ? 'Yes' : 'No'}</p>
        </div>
        <div className="browser-page__status-card">
          <p className="browser-page__status-title">Timeout</p>
          <p className="browser-page__status-value">{session ? `${session.timeoutMinutes} minutes` : '—'}</p>
        </div>
        <div className="browser-page__status-card">
          <p className="browser-page__status-title">Restrictions</p>
          <p className="browser-page__status-value">{session?.restrictionsEnabled ? 'Enabled' : 'Disabled'}</p>
        </div>
      </section>

      <section className="browser-page__panel">
        {session?.embedAllowed && session.embedUrl && !iframeBlocked ? (
          <iframe
            title="StudyClaw Browser"
            src={session.embedUrl}
            className="browser-page__iframe"
            onError={() => setIframeBlocked(true)}
          />
        ) : (
          <div className="browser-page__panel-empty">
            <p>
              Embedded browser is not available. {session ? 'Use the button above to open it in a new tab.' : 'Wait until the session is ready.'}
            </p>
            {session?.launchUrl && (
              <Button variant="outline" onClick={openInNewTab}>
                Open browser in a new tab
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
