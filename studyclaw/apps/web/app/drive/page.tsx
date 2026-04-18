'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  Sparkles,
  Trash2,
} from 'lucide-react';
import { apiFetch, beginGoogleConnect, readApiPayload } from '../../lib/api';

type FileType = 'doc' | 'spreadsheet' | 'note';
type EditorMode = 'write' | 'preview' | 'split';
type SheetCellGrid = string[][];
type DocumentBlockType = 'heading' | 'subheading' | 'paragraph' | 'bullet' | 'checklist' | 'quote';
type DocumentBlock = {
  type: DocumentBlockType;
  text: string;
  checked?: boolean;
};
type DraftMetadata = {
  editorMode?: EditorMode;
  rowCount?: number;
  colCount?: number;
  documentBlocks?: DocumentBlock[];
  sheetColumns?: string[];
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

const BLOCK_TEMPLATES: Array<{ type: DocumentBlockType; label: string; icon: typeof FileText; prefix: string }> = [
  { type: 'heading', label: 'Heading', icon: Heading1, prefix: '# Heading' },
  { type: 'bullet', label: 'Bullet list', icon: List, prefix: '- Bullet' },
  { type: 'checklist', label: 'Checklist', icon: CheckSquare, prefix: '- [ ] Checklist item' },
  { type: 'quote', label: 'Quote block', icon: Quote, prefix: '> Key quote or takeaway' },
];

function getColumnLabel(index: number) {
  let current = index;
  let label = '';
  while (current >= 0) {
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26) - 1;
  }
  return label;
}

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

function getSheetColumns(metadata?: Record<string, unknown>, colCount = 0) {
  const stored = Array.isArray(metadata?.sheetColumns)
    ? metadata.sheetColumns.map((value, index) => (typeof value === 'string' && value.trim() ? value.trim() : `Column ${index + 1}`))
    : [];
  return Array.from({ length: colCount }, (_, index) => stored[index] || `Column ${index + 1}`);
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
      ? { rowCount: 8, colCount: 5, editorMode: 'write', sheetColumns: Array.from({ length: 5 }, (_, index) => `Column ${index + 1}`) }
      : { editorMode: 'write', documentBlocks: [] };
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
  if (file.fileType === 'spreadsheet' && !Array.isArray(metadata.sheetColumns)) {
    metadata.sheetColumns = getSheetColumns(metadata, getSheetShape(metadata).colCount);
  }
  if (file.fileType !== 'spreadsheet' && !Array.isArray(metadata.documentBlocks)) {
    metadata.documentBlocks = buildDocumentBlocksFromText(file.content || '');
  }

  return {
    name: file.name,
    fileType: file.fileType,
    content: file.content,
    metadata,
  };
}

function buildDocumentBlocksFromText(content: string): DocumentBlock[] {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return null;
      }
      if (trimmed.startsWith('# ')) return { type: 'heading' as const, text: trimmed.slice(2).trim() };
      if (trimmed.startsWith('## ')) return { type: 'subheading' as const, text: trimmed.slice(3).trim() };
      if (trimmed.startsWith('- [ ] ')) return { type: 'checklist' as const, text: trimmed.slice(6).trim(), checked: false };
      if (trimmed.startsWith('- [x] ') || trimmed.startsWith('- [X] ')) return { type: 'checklist' as const, text: trimmed.slice(6).trim(), checked: true };
      if (trimmed.startsWith('- ')) return { type: 'bullet' as const, text: trimmed.slice(2).trim() };
      if (trimmed.startsWith('> ')) return { type: 'quote' as const, text: trimmed.slice(2).trim() };
      return { type: 'paragraph' as const, text: trimmed };
    })
    .filter((block) => Boolean(block && block.text)) as DocumentBlock[];
}

function renderDocumentBlocksAsHtml(blocks: DocumentBlock[]) {
  const html = blocks
    .map((block) => {
      const text = escapeHtml(block.text);
      if (block.type === 'heading') return `<h2 class="text-2xl font-semibold mt-4">${text}</h2>`;
      if (block.type === 'subheading') return `<h3 class="text-xl font-semibold mt-4">${text}</h3>`;
      if (block.type === 'checklist') return `<p class="flex items-start gap-2"><span>${block.checked ? '☑' : '☐'}</span><span>${text}</span></p>`;
      if (block.type === 'bullet') return `<p class="flex items-start gap-2"><span>•</span><span>${text}</span></p>`;
      if (block.type === 'quote') return `<blockquote class="border-l-4 border-[color:var(--line)] pl-4 italic text-[color:var(--muted)]">${text}</blockquote>`;
      return `<p>${text}</p>`;
    })
    .join('');

  return { __html: html || '<p>No content yet.</p>' };
}

function parseCellReference(ref: string) {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) {
    return null;
  }
  const [, letters, rowPart] = match;
  let colIndex = 0;
  for (const letter of letters) {
    colIndex = colIndex * 26 + (letter.charCodeAt(0) - 64);
  }
  return { rowIndex: Number(rowPart) - 1, colIndex: colIndex - 1 };
}

function getNumericCellValue(grid: SheetCellGrid, ref: string, seen = new Set<string>()): number {
  if (seen.has(ref)) {
    return 0;
  }
  seen.add(ref);
  const parsed = parseCellReference(ref);
  if (!parsed) {
    return 0;
  }
  const raw = String(grid[parsed.rowIndex]?.[parsed.colIndex] ?? '').trim();
  if (!raw) {
    return 0;
  }
  if (raw.startsWith('=')) {
    const evaluated = evaluateFormula(raw, grid, seen);
    return typeof evaluated === 'number' && Number.isFinite(evaluated) ? evaluated : 0;
  }
  const numeric = Number(raw.replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

function evaluateRangeFormula(fn: string, startRef: string, endRef: string, grid: SheetCellGrid, seen = new Set<string>()) {
  const start = parseCellReference(startRef);
  const end = parseCellReference(endRef);
  if (!start || !end) {
    return 0;
  }
  const values: number[] = [];
  for (let rowIndex = Math.min(start.rowIndex, end.rowIndex); rowIndex <= Math.max(start.rowIndex, end.rowIndex); rowIndex += 1) {
    for (let colIndex = Math.min(start.colIndex, end.colIndex); colIndex <= Math.max(start.colIndex, end.colIndex); colIndex += 1) {
      values.push(getNumericCellValue(grid, `${getColumnLabel(colIndex)}${rowIndex + 1}`, new Set(seen)));
    }
  }
  if (!values.length) {
    return 0;
  }
  if (fn === 'AVG') {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  if (fn === 'MIN') {
    return Math.min(...values);
  }
  if (fn === 'MAX') {
    return Math.max(...values);
  }
  return values.reduce((sum, value) => sum + value, 0);
}

function evaluateFormula(value: string, grid: SheetCellGrid, seen = new Set<string>()) {
  if (!value.startsWith('=')) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }

  try {
    let expression = value.slice(1).toUpperCase();
    expression = expression.replace(/(SUM|AVG|MIN|MAX)\(([A-Z]+\d+):([A-Z]+\d+)\)/g, (_, fn: string, startRef: string, endRef: string) => {
      const result = evaluateRangeFormula(fn, startRef, endRef, grid, new Set(seen));
      return String(result);
    });
    expression = expression.replace(/\b([A-Z]+\d+)\b/g, (_whole: string, ref: string) => String(getNumericCellValue(grid, ref, new Set(seen))));
    if (/[^0-9+\-*/().\s]/.test(expression)) {
      return '#ERR';
    }
    const result = Function(`return (${expression});`)();
    return Number.isFinite(result) ? result : '#ERR';
  } catch {
    return '#ERR';
  }
}

function buildStudyTextFromDraft(draft: FileDraft, grid: SheetCellGrid) {
  if (draft.fileType === 'spreadsheet') {
    const columns = getSheetColumns(draft.metadata, grid[0]?.length ?? 0);
    const lines = [columns.join('\t')];
    for (const row of grid) {
      const values = row.map((cell) => {
        const trimmed = cell.trim();
        if (!trimmed) {
          return '';
        }
        if (trimmed.startsWith('=')) {
          return String(evaluateFormula(trimmed, grid));
        }
        return trimmed;
      });
      if (values.some(Boolean)) {
        lines.push(values.join('\t'));
      }
    }
    return lines.join('\n').trim();
  }

  const blocks = buildDocumentBlocksFromText(draft.content);
  return blocks.map((block) => block.text).join('\n').trim() || draft.content.trim();
}

function convertDraftForFileType(current: FileDraft, nextFileType: FileType): FileDraft {
  if (current.fileType === nextFileType) {
    return current;
  }

  const next = emptyDraft(nextFileType);
  return {
    ...next,
    name: current.name,
    content: nextFileType === 'spreadsheet' ? next.content : current.content,
    metadata: nextFileType === 'spreadsheet'
      ? next.metadata
      : {
          ...next.metadata,
          documentBlocks: buildDocumentBlocksFromText(current.content),
        },
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
  const router = useRouter();
  const [files, setFiles] = useState<NativeFile[]>([]);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [googleFiles, setGoogleFiles] = useState<GoogleDriveFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FileDraft>(emptyDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [editorMode, setEditorMode] = useState<EditorMode>('write');
  const [generatingKind, setGeneratingKind] = useState<'flashcards' | 'quiz' | null>(null);

  const selectedFile = files.find((file) => file.id === selectedFileId) ?? null;
  const sheetShape = getSheetShape(draft.metadata);
  const sheetGrid = useMemo(() => (
    draft.fileType === 'spreadsheet'
      ? normalizeGrid(parseSheetContent(draft.content, draft.metadata), sheetShape.rowCount, sheetShape.colCount)
      : []
  ), [draft.content, draft.fileType, draft.metadata, sheetShape.colCount, sheetShape.rowCount]);
  const documentBlocks = useMemo(
    () => (draft.fileType === 'spreadsheet'
      ? []
      : (Array.isArray(draft.metadata?.documentBlocks) && draft.metadata.documentBlocks.length
        ? draft.metadata.documentBlocks as DocumentBlock[]
        : buildDocumentBlocksFromText(draft.content))),
    [draft.content, draft.fileType, draft.metadata]
  );
  const sheetColumns = useMemo(
    () => getSheetColumns(draft.metadata, sheetGrid[0]?.length ?? sheetShape.colCount),
    [draft.metadata, sheetGrid, sheetShape.colCount]
  );
  const formulaCells = useMemo(
    () => sheetGrid.flatMap((row, rowIndex) =>
      row.flatMap((cell, colIndex) => cell.trim().startsWith('=')
        ? [{ ref: `${getColumnLabel(colIndex)}${rowIndex + 1}`, formula: cell.trim(), value: String(evaluateFormula(cell.trim(), sheetGrid)) }]
        : [])),
    [sheetGrid]
  );

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
            sheetColumns: draft.fileType === 'spreadsheet' ? sheetColumns : undefined,
            documentBlocks: draft.fileType === 'spreadsheet' ? undefined : documentBlocks,
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

  function updateSheetColumnName(colIndex: number, value: string) {
    const nextColumns = Array.from({ length: Math.max(sheetColumns.length, colIndex + 1) }, (_, index) =>
      index === colIndex ? value : (sheetColumns[index] || `Column ${index + 1}`));
    setDraft((current) => ({
      ...current,
      metadata: {
        ...(current.metadata ?? {}),
        sheetColumns: nextColumns,
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
      metadata: {
        ...(current.metadata ?? {}),
        documentBlocks: buildDocumentBlocksFromText(current.content ? `${current.content}\n${prefix}` : prefix),
      },
    }));
  }

  function updateDocumentContent(nextContent: string) {
    setDraft((current) => ({
      ...current,
      content: nextContent,
      metadata: {
        ...(current.metadata ?? {}),
        documentBlocks: buildDocumentBlocksFromText(nextContent),
      },
    }));
  }

  async function generateStudyAsset(kind: 'flashcards' | 'quiz') {
    if (!selectedFileId || generatingKind) {
      return;
    }

    const studyText = buildStudyTextFromDraft(draft, sheetGrid);
    if (studyText.length < 24) {
      setStatus(`Add a little more detail before generating ${kind === 'flashcards' ? 'flashcards' : 'a quiz'}.`);
      return;
    }

    setGeneratingKind(kind);
    setStatus('');
    try {
      const response = await apiFetch(kind === 'flashcards' ? '/api/study/flashcards' : '/api/study/quiz', {
        method: 'POST',
        body: JSON.stringify({
          title: kind === 'flashcards' ? draft.name.trim() : `${draft.name.trim()} Quiz`,
          text: studyText,
          sourceFileId: selectedFileId,
          sourceKind: 'native-file',
          questionCount: kind === 'quiz' ? 6 : undefined,
        }),
      });
      const payload = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(typeof payload.message === 'string' ? payload.message : `Failed to create ${kind}`);
      }
      router.push(kind === 'flashcards'
        ? `/study?set=${encodeURIComponent(String(payload.flashcardSetId ?? ''))}`
        : `/study?quiz=${encodeURIComponent(String(payload.quizId ?? ''))}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `Failed to create ${kind}`);
    } finally {
      setGeneratingKind(null);
    }
  }

  const nativePreview = draft.fileType === 'spreadsheet'
    ? null
    : renderDocumentBlocksAsHtml(documentBlocks);

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
                  <select
                    value={draft.fileType}
                    onChange={(event) => setDraft((current) => convertDraftForFileType(current, event.target.value as FileType))}
                  >
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
                          {sheetColumns.map((columnName, colIndex) => (
                            <th key={colIndex} className="border-b border-r border-[color:var(--line)] px-3 py-2 text-left text-xs uppercase tracking-[0.14em] text-[color:var(--muted)]">
                              <div className="space-y-1">
                                <span>{getColumnLabel(colIndex)}</span>
                                <input
                                  value={columnName}
                                  onChange={(event) => updateSheetColumnName(colIndex, event.target.value)}
                                  className="w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] px-2 py-1 text-[11px] font-medium normal-case tracking-normal text-[color:var(--copy)] outline-none"
                                />
                              </div>
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
                                <div className="space-y-1 px-2 py-2">
                                  <input
                                    value={cell}
                                    onChange={(event) => updateSheetCell(rowIndex, colIndex, event.target.value)}
                                    className="w-full border-0 bg-transparent px-1 py-1 outline-none"
                                    placeholder="—"
                                  />
                                  {cell.trim().startsWith('=') ? (
                                    <div className="text-[11px] text-[color:var(--muted)]">
                                      {String(evaluateFormula(cell.trim(), sheetGrid))}
                                    </div>
                                  ) : null}
                                </div>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-2)] p-4">
                      <p className="eyebrow">Structured sheet</p>
                      <h3 className="section-title">Headers and formulas</h3>
                      <p className="mt-2 text-sm text-[color:var(--muted)]">
                        Use column names for cleaner exports and formulas like <code>=A2+B2</code>, <code>=SUM(B2:B6)</code>, or <code>=AVG(C2:C5)</code>.
                      </p>
                    </section>
                    <section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-2)] p-4">
                      <p className="eyebrow">Live sheet stats</p>
                      <h3 className="section-title">{sheetGrid.length} rows · {sheetColumns.length} columns</h3>
                      <p className="mt-2 text-sm text-[color:var(--muted)]">
                        {formulaCells.length ? `${formulaCells.length} formula cells will export with their evaluated values for study tools.` : 'Add formulas to turn this from a plain grid into a working study sheet.'}
                      </p>
                    </section>
                  </div>
                  {formulaCells.length ? (
                    <section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-2)] p-4">
                      <p className="eyebrow">Formula outputs</p>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {formulaCells.slice(0, 8).map((entry) => (
                          <article key={entry.ref} className="rounded-xl border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2 text-sm">
                            <strong>{entry.ref}</strong>
                            <p className="mt-1 text-[color:var(--muted)]">{entry.formula}</p>
                            <p className="mt-1 font-medium">{entry.value}</p>
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {BLOCK_TEMPLATES.map(({ type, label, icon: Icon, prefix }) => (
                      <button key={type} type="button" className="ghost-button" onClick={() => insertTemplate(prefix)}>
                        <Icon className="mr-2 inline h-4 w-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
                    <section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-2)] p-4">
                      <p className="eyebrow">Structured doc model</p>
                      <h3 className="section-title">{documentBlocks.length} formatting blocks tracked</h3>
                      <p className="mt-2 text-sm text-[color:var(--muted)]">
                        StudyClaw stores headings, lists, checklists, and quotes as structured metadata so previews and study generation stay stable.
                      </p>
                    </section>
                    <section className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel-2)] p-4">
                      <p className="eyebrow">Outline</p>
                      <div className="mt-3 space-y-2 text-sm">
                        {documentBlocks.slice(0, 8).map((block, index) => (
                          <div key={`${block.type}-${index}`} className="rounded-xl border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2">
                            <strong className="capitalize">{block.type.replace('_', ' ')}</strong>
                            <p className="mt-1 text-[color:var(--muted)]">{block.text}</p>
                          </div>
                        ))}
                        {!documentBlocks.length ? <p className="text-[color:var(--muted)]">Start writing to build an outline.</p> : null}
                      </div>
                    </section>
                  </div>

                  {editorMode === 'write' ? (
                    <label className="form-field">
                      <span>Content</span>
                      <textarea
                        rows={22}
                        value={draft.content}
                        onChange={(event) => updateDocumentContent(event.target.value)}
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
                          onChange={(event) => updateDocumentContent(event.target.value)}
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
                  <button type="button" className="ghost-button" onClick={() => void generateStudyAsset('flashcards')} disabled={saving || generatingKind !== null}>
                    <Sparkles className="mr-2 inline h-4 w-4" />
                    {generatingKind === 'flashcards' ? 'Creating flashcards…' : 'Make flashcards'}
                  </button>
                  <button type="button" className="ghost-button" onClick={() => void generateStudyAsset('quiz')} disabled={saving || generatingKind !== null}>
                    <Sparkles className="mr-2 inline h-4 w-4" />
                    {generatingKind === 'quiz' ? 'Creating quiz…' : 'Make quiz'}
                  </button>
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
