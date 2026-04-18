'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FileSpreadsheet, FileText, NotebookPen, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { apiFetch, beginGoogleConnect, readApiPayload } from '../../lib/api';

type FileType = 'doc' | 'spreadsheet' | 'note';

type NativeFile = {
  id: string;
  name: string;
  fileType: FileType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  source: 'studyclaw';
};

type GoogleStatus = {
  connected?: boolean;
  status?: 'not_connected' | 'connected' | 'reconnect_required';
  googleEmail?: string | null;
  account?: string | null;
  canReadDrive?: boolean;
  error?: string | null;
};

type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
};

const FILE_TYPE_META: Record<FileType, { label: string; icon: typeof FileText }> = {
  doc: { label: 'Doc', icon: FileText },
  spreadsheet: { label: 'Spreadsheet', icon: FileSpreadsheet },
  note: { label: 'Note', icon: NotebookPen },
};

function emptyDraft(fileType: FileType = 'note') {
  return {
    name: fileType === 'spreadsheet' ? 'Untitled study sheet' : fileType === 'doc' ? 'Untitled study doc' : 'Untitled note',
    fileType,
    content: '',
  };
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export default function DrivePage() {
  const [files, setFiles] = useState<NativeFile[]>([]);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [googleFiles, setGoogleFiles] = useState<GoogleDriveFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const selectedFile = files.find((file) => file.id === selectedFileId) ?? null;

  async function loadWorkspace() {
    setLoading(true);
    setStatus('');
    try {
      const [filesResponse, googleStatusResponse] = await Promise.all([
        apiFetch('/api/files'),
        apiFetch('/api/google'),
      ]);

      const filesPayload = await readApiPayload(filesResponse);
      const googlePayload = (await readApiPayload(googleStatusResponse)) as GoogleStatus;

      if (!filesResponse.ok) {
        throw new Error(typeof filesPayload.message === 'string' ? filesPayload.message : 'Failed to load StudyClaw Drive');
      }

      const nextFiles = Array.isArray((filesPayload as { files?: unknown[] }).files)
        ? ((filesPayload as { files: NativeFile[] }).files)
        : [];
      setFiles(nextFiles);
      setGoogleStatus(googleStatusResponse.ok ? googlePayload : null);

      if (!selectedFileId && nextFiles[0]) {
        setSelectedFileId(nextFiles[0].id);
        setDraft({
          name: nextFiles[0].name,
          fileType: nextFiles[0].fileType,
          content: nextFiles[0].content,
        });
      } else if (selectedFileId) {
        const active = nextFiles.find((file) => file.id === selectedFileId);
        if (active) {
          setDraft({
            name: active.name,
            fileType: active.fileType,
            content: active.content,
          });
        }
      }

      if (googleStatusResponse.ok && googlePayload.connected && googlePayload.canReadDrive) {
        const googleFilesResponse = await apiFetch('/api/google/drive?kind=all&max=8');
        const googleFilesPayload = await readApiPayload(googleFilesResponse);
        setGoogleFiles(Array.isArray(googleFilesPayload) ? (googleFilesPayload as GoogleDriveFile[]) : []);
      } else {
        setGoogleFiles([]);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load Drive workspace');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, []);

  function selectFile(file: NativeFile) {
    setSelectedFileId(file.id);
    setDraft({
      name: file.name,
      fileType: file.fileType,
      content: file.content,
    });
    setStatus('');
  }

  async function createFile(fileType: FileType) {
    setSaving(true);
    setStatus('');
    try {
      const response = await apiFetch('/api/files', {
        method: 'POST',
        body: JSON.stringify(emptyDraft(fileType)),
      });
      const payload = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(typeof payload.message === 'string' ? payload.message : 'Failed to create file');
      }

      await loadWorkspace();
      const created = payload as NativeFile;
      setSelectedFileId(created.id);
      setDraft({
        name: created.name,
        fileType: created.fileType,
        content: created.content,
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to create file');
    } finally {
      setSaving(false);
    }
  }

  async function saveFile() {
    if (!selectedFileId) {
      return;
    }

    if (!draft.name.trim()) {
      setStatus('File name is required.');
      return;
    }

    setSaving(true);
    setStatus('');
    try {
      const response = await apiFetch(`/api/files/${selectedFileId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: draft.name.trim(),
          fileType: draft.fileType,
          content: draft.content,
        }),
      });
      const payload = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(typeof payload.message === 'string' ? payload.message : 'Failed to save file');
      }
      await loadWorkspace();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to save file');
    } finally {
      setSaving(false);
    }
  }

  async function deleteFile() {
    if (!selectedFileId) {
      return;
    }

    setSaving(true);
    setStatus('');
    try {
      const response = await apiFetch(`/api/files/${selectedFileId}`, {
        method: 'DELETE',
      });
      const payload = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(typeof payload.message === 'string' ? payload.message : 'Failed to delete file');
      }
      setSelectedFileId(null);
      setDraft(emptyDraft());
      await loadWorkspace();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to delete file');
    } finally {
      setSaving(false);
    }
  }

  async function handleGoogleConnect() {
    try {
      await beginGoogleConnect('/drive');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to start Google connection');
    }
  }

  return (
    <section className="space-y-6">
      {status ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {status}
        </div>
      ) : null}

      <header className="hero-card">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <p className="insight-chip">Drive</p>
            <h1 className="hero-title">StudyClaw files for every account, with Google Drive layered on when connected.</h1>
            <p className="hero-description">
              Use native notes, docs, and lightweight study sheets by default. Google users keep recent Drive files visible here too.
            </p>
          </div>
          <div className="grid min-w-[280px] gap-3 sm:grid-cols-3 lg:w-[360px]">
            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
              <span className="text-xs uppercase tracking-[0.24em] text-[color:var(--muted)]">StudyClaw</span>
              <div className="mt-2 text-2xl font-semibold">{files.length}</div>
              <p className="mt-2 text-sm text-[color:var(--muted)]">Native docs, notes, and sheets.</p>
            </div>
            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
              <span className="text-xs uppercase tracking-[0.24em] text-[color:var(--muted)]">Google</span>
              <div className="mt-2 text-2xl font-semibold">{googleFiles.length}</div>
              <p className="mt-2 text-sm text-[color:var(--muted)]">
                {googleStatus?.connected ? (googleStatus.googleEmail || googleStatus.account || 'Connected') : 'Optional'}
              </p>
            </div>
            <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
              <span className="text-xs uppercase tracking-[0.24em] text-[color:var(--muted)]">Editor</span>
              <div className="mt-2 text-2xl font-semibold">{selectedFile ? FILE_TYPE_META[selectedFile.fileType].label : 'Ready'}</div>
              <p className="mt-2 text-sm text-[color:var(--muted)]">Simple editing in-app for native StudyClaw files.</p>
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-6 xl:grid-cols-[0.92fr_1.4fr_0.9fr]">
        <aside className="space-y-4 rounded-[28px] border border-[color:var(--line)] bg-[color:var(--panel)] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">StudyClaw Drive</p>
              <h2 className="section-title">Native files</h2>
            </div>
            <button type="button" className="ghost-button" onClick={() => void loadWorkspace()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {(['note', 'doc', 'spreadsheet'] as const).map((fileType) => (
              <button key={fileType} type="button" className="ghost-button" onClick={() => void createFile(fileType)} disabled={saving}>
                <Plus className="mr-2 inline h-4 w-4" />
                New {FILE_TYPE_META[fileType].label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="rounded-2xl border border-dashed border-[color:var(--line)] px-4 py-8 text-center text-sm text-[color:var(--muted)]">
              Loading files…
            </div>
          ) : files.length ? (
            <div className="space-y-2">
              {files.map((file) => {
                const Icon = FILE_TYPE_META[file.fileType].icon;
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => selectFile(file)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left ${selectedFileId === file.id ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/8' : 'border-[color:var(--line)] bg-[color:var(--panel-2)]'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="rounded-full bg-[color:var(--accent)]/10 p-2 text-[color:var(--accent)]">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate">{file.name}</strong>
                        <p className="mt-1 text-xs text-[color:var(--muted)]">
                          {FILE_TYPE_META[file.fileType].label} · Updated {formatDate(file.updatedAt)}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[color:var(--line)] px-4 py-8 text-center">
              <strong>No StudyClaw files yet</strong>
              <p className="mt-2 text-sm text-[color:var(--muted)]">Create a note, doc, or sheet to start your native workspace.</p>
            </div>
          )}
        </aside>

        <main className="rounded-[28px] border border-[color:var(--line)] bg-[color:var(--panel)] p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Editor</p>
              <h2 className="section-title">{selectedFile ? selectedFile.name : 'Select or create a file'}</h2>
            </div>
            {selectedFile ? (
              <span className="settings-badge is-live">{FILE_TYPE_META[selectedFile.fileType].label}</span>
            ) : null}
          </div>

          {selectedFile ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                <label className="form-field">
                  <span>Name</span>
                  <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Type</span>
                  <select value={draft.fileType} onChange={(event) => setDraft((current) => ({ ...current, fileType: event.target.value as FileType }))}>
                    {(['note', 'doc', 'spreadsheet'] as const).map((fileType) => (
                      <option key={fileType} value={fileType}>{FILE_TYPE_META[fileType].label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="form-field">
                <span>Content</span>
                <textarea
                  rows={22}
                  value={draft.content}
                  onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
                  placeholder="Write study notes, reading summaries, formulas, prompt scaffolds, or planning notes here."
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-[color:var(--muted)]">
                  Created {formatDate(selectedFile.createdAt)} · Updated {formatDate(selectedFile.updatedAt)}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="ghost-button" onClick={() => void deleteFile()} disabled={saving}>
                    <Trash2 className="mr-2 inline h-4 w-4" />
                    Delete
                  </button>
                  <button type="button" onClick={() => void saveFile()} disabled={saving}>
                    {saving ? 'Saving…' : 'Save file'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-[color:var(--line)] px-4 py-10 text-center">
              <strong>StudyClaw Drive is ready.</strong>
              <p className="mt-2 text-sm text-[color:var(--muted)]">
                Create a file from the left to start a native workspace that works even without Google.
              </p>
            </div>
          )}
        </main>

        <aside className="space-y-4">
          <section className="rounded-[28px] border border-[color:var(--line)] bg-[color:var(--panel)] p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Google Drive</p>
                <h2 className="section-title">Optional external layer</h2>
              </div>
            </div>

            {!googleStatus?.connected ? (
              <div className="mt-4 rounded-2xl border border-dashed border-[color:var(--line)] px-4 py-8 text-center">
                <strong>StudyClaw Drive already works without Google.</strong>
                <p className="mt-2 text-sm text-[color:var(--muted)]">Connect Google only if you also want recent Drive docs, sheets, and slides visible here.</p>
                <button type="button" className="mt-4 ghost-button" onClick={() => void handleGoogleConnect()}>
                  Connect Google Drive
                </button>
              </div>
            ) : !googleStatus.canReadDrive ? (
              <div className="mt-4 rounded-2xl border border-dashed border-[color:var(--line)] px-4 py-8 text-center">
                <strong>Reconnect Google to finish Drive access.</strong>
                <p className="mt-2 text-sm text-[color:var(--muted)]">{googleStatus.error || 'Drive scope is not available yet for this account.'}</p>
                <button type="button" className="mt-4 ghost-button" onClick={() => void handleGoogleConnect()}>
                  Reconnect Google
                </button>
              </div>
            ) : googleFiles.length ? (
              <div className="mt-4 space-y-3">
                {googleFiles.map((file) => (
                  <article key={file.id} className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-2)] p-4">
                    <strong>{file.name}</strong>
                    <p className="mt-1 text-sm text-[color:var(--muted)]">{file.mimeType || 'Google file'} · {formatDate(file.modifiedTime)}</p>
                    {file.webViewLink ? (
                      <a href={file.webViewLink} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-[color:var(--accent)]">
                        Open in Google
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-[color:var(--line)] px-4 py-8 text-center">
                <strong>No recent Google Drive files yet</strong>
                <p className="mt-2 text-sm text-[color:var(--muted)]">Recent Google documents will appear here once the connected account starts using them.</p>
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-[color:var(--line)] bg-[color:var(--panel)] p-5 shadow-sm">
            <p className="eyebrow">How this works</p>
            <h2 className="section-title">Workspace routing</h2>
            <div className="mt-4 space-y-3 text-sm text-[color:var(--muted)]">
              <p>StudyClaw-native files are always available for notes, docs, and lightweight study sheets.</p>
              <p>When Google is connected, the agent can reference Google Workspace too, but it should not pretend Google exists for email/password users.</p>
              <p>
                Use <Link href="/calendar" className="font-medium text-[color:var(--accent)]">Calendar</Link> and <Link href="/reader" className="font-medium text-[color:var(--accent)]">eReader</Link> alongside this page to keep planning and reading tied to the same workspace.
              </p>
            </div>
          </section>
        </aside>
      </section>
    </section>
  );
}
