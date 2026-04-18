'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CheckSquare,
  Columns3,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Heading1,
  List,
  NotebookPen,
  PanelTop,
  Plus,
  Quote,
  RefreshCw,
  Rows3,
  Save,
  Trash2,
} from 'lucide-react';
import { apiFetch, beginGoogleConnect, readApiPayload } from '../../lib/api';

type FileType = 'doc' | 'spreadsheet' | 'note';
type EditorMode = 'write' | 'preview' | 'split';
type SheetCellGrid = string[][];
type DraftMetadata = {
  editorMode?: EditorMode;
  rowCount?: number;
  colCount?: number;
} & Record<string, unknown>;
type FileDraft = {
  name: string;
  fileType: FileType;
  content: string;
  metadata: DraftMetadata;
};

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

const FILE_TYPE_META: Record<FileType, { label: string; icon: typeof FileText; emptyName: string }> = {
  doc: { label: 'Doc', icon: FileText, emptyName: 'Untitled study doc' },
  spreadsheet: { label: 'Spreadsheet', icon: FileSpreadsheet, emptyName: 'Untitled study sheet' },
  note: { label: 'Note', icon: NotebookPen, emptyName: 'Untitled note' },
};

function createEmptySheet(rows = 8, cols = 5): SheetCellGrid {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function getSheetShape(metadata?: Record<string, unknown>) {
  const rowCount = typeof metadata?.rowCount === 'number' && metadata.rowCount > 0 ? metadata.rowCount : 8;
  const colCount = typeof metadata?.colCount === 'number' && metadata.colCount > 0 ? metadata.colCount : 5;
  return {
    rowCount: Math.min(rowCount, 30),
    colCount: Math.min(colCount, 12),
  };
}

function parseSheetContent(content: string, metadata?: Record<string, unknown>) {
  const { rowCount, colCount } = getSheetShape(metadata);
  if (!content.trim()) {
    return createEmptySheet(rowCount, colCount);
  }

  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.every((row) => Array.isArray(row))) {
      return parsed.map((row) => row.map((cell) => String(cell ?? '')));
    }
  } catch {
    // Fall back to tabular text parsing.
  }

  const rows = content.split('\n').map((row) => row.split('\t').map((cell) => cell.trim()));
  return rows.length ? rows : createEmptySheet(rowCount, colCount);
}

function stringifySheetContent(grid: SheetCellGrid) {
  return JSON.stringify(grid);
}

function normalizeGrid(grid: SheetCellGrid, rowCount: number, colCount: number) {
  const rows = Array.from({ length: rowCount }, (_, rowIndex) =>
    Array.from({ length: colCount }, (_, colIndex) => grid[rowIndex]?.[colIndex] ?? '')
  );
  return rows;
}

function emptyDraft(fileType: FileType = 'note'): FileDraft {
  const metadata: DraftMetadata =
    fileType === 'spreadsheet'
      ? { rowCount: 8, colCount: 5, editorMode: 'write' }
      : { editorMode: 'write' };
  return {
    name: FILE_TYPE_META[fileType].emptyName,
    fileType,
    content: fileType === 'spreadsheet' ? stringifySheetContent(createEmptySheet()) : '',
    metadata,
  };
}

function draftFromFile(file: NativeFile): FileDraft {
  const metadata: DraftMetadata = { ...(file.metadata ?? {}) };
  if (!metadata.editorMode) {
    metadata.editorMode = 'write';
  }

  return {
    name: file.name,
    fileType: file.fileType,
    content: file.content,
    metadata,
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderRichPreview(content: string) {
  const html = content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return '<div class="h-3"></div>';
      }
      if (trimmed.startsWith('# ')) {
        return `<h2 class="text-2xl font-semibold mt-4">${escapeHtml(trimmed.slice(2))}</h2>`;
      }
      if (trimmed.startsWith('## ')) {
        return `<h3 class="text-xl font-semibold mt-4">${escapeHtml(trimmed.slice(3))}</h3>`;
      }
      if (trimmed.startsWith('- [ ] ')) {
        return `<p class="flex items-start gap-2"><span>☐</span><span>${escapeHtml(trimmed.slice(6))}</span></p>`;
      }
      if (trimmed.startsWith('- ')) {
        return `<p class="flex items-start gap-2"><span>•</span><span>${escapeHtml(trimmed.slice(2))}</span></p>`;
      }
      if (trimmed.startsWith('> ')) {
        return `<blockquote class="border-l-4 border-[color:var(--line)] pl-4 italic text-[color:var(--muted)]">${escapeHtml(trimmed.slice(2))}</blockquote>`;
      }
      return `<p>${escapeHtml(trimmed)}</p>`;
    })
    .join('');

  return { __html: html };
}

export default function DrivePage() {
  const [files, setFiles] = useState<NativeFile[]>([]);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [googleFiles, setGoogleFiles] = useState<GoogleDriveFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FileDraft>(emptyDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [editorMode, setEditorMode] = useState<EditorMode>('write');

  const selectedFile = files.find((file) => file.id === selectedFileId) ?? null;
  const sheetShape = getSheetShape(draft.metadata);
  const sheetGrid = useMemo(() => (
    draft.fileType === 'spreadsheet'
      ? normalizeGrid(parseSheetContent(draft.content, draft.metadata), sheetShape.rowCount, sheetShape.colCount)
      : []
  ), [draft.content, draft.fileType, draft.metadata, sheetShape.colCount, sheetShape.rowCount]);

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

      const nextSelected = selectedFileId ? nextFiles.find((file) => file.id === selectedFileId) : nextFiles[0];
      if (nextSelected) {
        setSelectedFileId(nextSelected.id);
        const nextDraft = draftFromFile(nextSelected);
        setDraft(nextDraft);
        setEditorMode((nextDraft.metadata?.editorMode as EditorMode) || 'write');
      } else {
        setSelectedFileId(null);
        setDraft(emptyDraft());
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
    const nextDraft = draftFromFile(file);
    setDraft(nextDraft);
    setEditorMode((nextDraft.metadata?.editorMode as EditorMode) || 'write');
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
      const nextDraft = draftFromFile(created);
      setDraft(nextDraft);
      setEditorMode((nextDraft.metadata?.editorMode as EditorMode) || 'write');
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
          content: draft.fileType === 'spreadsheet' ? stringifySheetContent(sheetGrid) : draft.content,
          metadata: {
            ...(draft.metadata ?? {}),
            editorMode,
            rowCount: draft.fileType === 'spreadsheet' ? sheetGrid.length : undefined,
            colCount: draft.fileType === 'spreadsheet' ? Math.max(...sheetGrid.map((row) => row.length), 0) : undefined,
          },
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
      setEditorMode('write');
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

  function updateSheetCell(rowIndex: number, colIndex: number, value: string) {
    const nextGrid = sheetGrid.map((row, currentRow) =>
      currentRow === rowIndex
        ? row.map((cell, currentCol) => (currentCol === colIndex ? value : cell))
        : row
    );
    setDraft((current) => ({
      ...current,
      content: stringifySheetContent(nextGrid),
      metadata: {
        ...(current.metadata ?? {}),
        rowCount: nextGrid.length,
        colCount: nextGrid[0]?.length ?? 0,
      },
    }));
  }

  function addSheetRow() {
    const nextGrid = [...sheetGrid, Array.from({ length: sheetShape.colCount }, () => '')];
    setDraft((current) => ({
      ...current,
      content: stringifySheetContent(nextGrid),
      metadata: {
        ...(current.metadata ?? {}),
        rowCount: nextGrid.length,
        colCount: nextGrid[0]?.length ?? sheetShape.colCount,
      },
    }));
  }

  function addSheetColumn() {
    const nextGrid = sheetGrid.map((row) => [...row, '']);
    setDraft((current) => ({
      ...current,
      content: stringifySheetContent(nextGrid),
      metadata: {
        ...(current.metadata ?? {}),
        rowCount: nextGrid.length,
        colCount: nextGrid[0]?.length ?? sheetShape.colCount + 1,
      },
    }));
  }

  function insertTemplate(prefix: string) {
    setDraft((current) => ({
      ...current,
      content: current.content ? `${current.content}\n${prefix}` : prefix,
    }));
  }

  const nativePreview = draft.fileType === 'spreadsheet'
    ? null
    : renderRichPreview(draft.content);

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
            <h1 className="hero-title">StudyClaw files for every account, with a richer native editor and sheets workspace.</h1>
            <p className="hero-description">
              Native notes, docs, and spreadsheets are first-class now. Google users still see their recent Drive files as an optional external layer.
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
              <div className="mt-2 text-2xl font-semibold">
                {selectedFile ? `${FILE_TYPE_META[selectedFile.fileType].label} · ${editorMode}` : 'Ready'}
              </div>
              <p className="mt-2 text-sm text-[color:var(--muted)]">Write, preview, split, and grid-edit in app.</p>
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Editor</p>
              <h2 className="section-title">{selectedFile ? selectedFile.name : 'Select or create a file'}</h2>
            </div>
            {selectedFile ? (
              <div className="flex flex-wrap gap-2">
                <span className="settings-badge is-live">{FILE_TYPE_META[selectedFile.fileType].label}</span>
                {selectedFile.fileType !== 'spreadsheet' ? (
                  <div className="rounded-full border border-[color:var(--line)] bg-[color:var(--panel-2)] p-1">
                    {(['write', 'preview', 'split'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setEditorMode(mode)}
                        className={`rounded-full px-3 py-1.5 text-sm ${editorMode === mode ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)]'}`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
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

              {draft.fileType === 'spreadsheet' ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="ghost-button" onClick={addSheetRow}>
                      <Rows3 className="mr-2 inline h-4 w-4" />
                      Add row
                    </button>
                    <button type="button" className="ghost-button" onClick={addSheetColumn}>
                      <Columns3 className="mr-2 inline h-4 w-4" />
                      Add column
                    </button>
                  </div>
                  <div className="overflow-auto rounded-2xl border border-[color:var(--line)]">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-[color:var(--panel-2)]">
                          <th className="border-b border-r border-[color:var(--line)] px-3 py-2 text-left text-xs uppercase tracking-[0.14em] text-[color:var(--muted)]">#</th>
                          {sheetGrid[0]?.map((_, colIndex) => (
                            <th key={colIndex} className="border-b border-r border-[color:var(--line)] px-3 py-2 text-left text-xs uppercase tracking-[0.14em] text-[color:var(--muted)]">
                              {String.fromCharCode(65 + colIndex)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sheetGrid.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            <td className="border-b border-r border-[color:var(--line)] bg-[color:var(--panel-2)] px-3 py-2 text-xs text-[color:var(--muted)]">{rowIndex + 1}</td>
                            {row.map((cell, colIndex) => (
                              <td key={`${rowIndex}-${colIndex}`} className="border-b border-r border-[color:var(--line)] p-0">
                                <input
                                  value={cell}
                                  onChange={(event) => updateSheetCell(rowIndex, colIndex, event.target.value)}
                                  className="w-full border-0 bg-transparent px-3 py-2 outline-none"
                                  placeholder="—"
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="ghost-button" onClick={() => insertTemplate('# Heading')}>
                      <Heading1 className="mr-2 inline h-4 w-4" />
                      Heading
                    </button>
                    <button type="button" className="ghost-button" onClick={() => insertTemplate('- Bullet')}>
                      <List className="mr-2 inline h-4 w-4" />
                      Bullet list
                    </button>
                    <button type="button" className="ghost-button" onClick={() => insertTemplate('- [ ] Checklist item')}>
                      <CheckSquare className="mr-2 inline h-4 w-4" />
                      Checklist
                    </button>
                    <button type="button" className="ghost-button" onClick={() => insertTemplate('> Key quote or takeaway')}>
                      <Quote className="mr-2 inline h-4 w-4" />
                      Quote block
                    </button>
                  </div>

                  {editorMode === 'write' ? (
                    <label className="form-field">
                      <span>Content</span>
                      <textarea
                        rows={22}
                        value={draft.content}
                        onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
                        placeholder="Write study notes, reading summaries, formulas, prompt scaffolds, or planning notes here."
                      />
                    </label>
                  ) : editorMode === 'preview' ? (
                    <section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-2)] px-5 py-4">
                      <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                        <PanelTop className="h-4 w-4" />
                        Preview
                      </div>
                      <div className="prose max-w-none space-y-3" dangerouslySetInnerHTML={nativePreview} />
                    </section>
                  ) : (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <label className="form-field">
                        <span>Content</span>
                        <textarea
                          rows={22}
                          value={draft.content}
                          onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
                          placeholder="Write study notes, reading summaries, formulas, prompt scaffolds, or planning notes here."
                        />
                      </label>
                      <section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-2)] px-5 py-4">
                        <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                          <PanelTop className="h-4 w-4" />
                          Preview
                        </div>
                        <div className="prose max-w-none space-y-3" dangerouslySetInnerHTML={nativePreview} />
                      </section>
                    </div>
                  )}
                </>
              )}

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
                    <Save className="mr-2 inline h-4 w-4" />
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
                <p className="eyebrow">Document sources</p>
                <h2 className="section-title">Native and Google layers</h2>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <article className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-2)] p-4">
                <strong>StudyClaw Drive</strong>
                <p className="mt-2 text-sm text-[color:var(--muted)]">{files.length} native files available now.</p>
              </article>
              <article className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-2)] p-4">
                <strong>Google Drive</strong>
                <p className="mt-2 text-sm text-[color:var(--muted)]">
                  {googleStatus?.connected
                    ? `${googleFiles.length} recent Google files visible for ${googleStatus.googleEmail || googleStatus.account || 'this account'}.`
                    : 'Optional external workspace layer. Native Drive already works without it.'}
                </p>
              </article>
            </div>
          </section>

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
              <p>StudyClaw-native files are always available for notes, docs, and spreadsheets.</p>
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
