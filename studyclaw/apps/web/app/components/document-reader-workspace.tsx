'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, FileText, FileImage, FileAudio, File, Search, Grid2X2, List, PanelLeft, Bookmark, Highlighter, NotebookPen, ExternalLink, Sparkles, MessageSquare } from 'lucide-react';
import { apiFetch, getApiErrorMessage, readApiPayload } from '../../lib/api';

type ReaderAsset = {
  id: string;
  title: string;
  originalText: string;
  processedText: string;
  fileUrl?: string | null;
  assetType: string;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  subjectId?: string | null;
  sectionName: string;
  readingProgress?: number;
  lastOpenedAt?: string | null;
  lastPage?: number | null;
};

type ReaderAnnotation = {
  id: string;
  kind: 'bookmark' | 'note' | 'highlight';
  label?: string | null;
  snippet?: string | null;
  note?: string | null;
  location?: string | null;
  pageNumber?: number | null;
  createdAt: string;
  updatedAt: string;
};

type ReaderDocument = {
  id: string;
  title: string;
  assetType: string;
  fileUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
  subjectId?: string | null;
  sectionName: string;
  metadata: Record<string, any>;
  content: string;
  format: 'pdf' | 'epub' | 'text' | 'html' | 'word' | 'spreadsheet' | 'presentation' | 'richtext' | 'image' | 'audio' | 'unknown';
  supported: boolean;
  supportMessage: string;
  summary?: string | null;
  pageCount: number;
  readerState: {
    progressPercent: number;
    lastPosition?: string | null;
    lastPage?: number | null;
    viewMode: 'scroll' | 'paged';
    zoomLevel: number;
    fontSize: number;
    lineSpacing: number;
    readingWidth: number;
    theme: 'paper' | 'dark' | 'sage';
    lastOpenedAt?: string | null;
  };
  annotations: ReaderAnnotation[];
};

type SavedBook = {
  key?: string;
  title: string;
  author_name?: string[];
  cover_i?: string | number;
  ia?: string[];
  gb_id?: string;
  first_publish_year?: number;
  subtitle?: string | null;
  ebookAccess?: 'full' | 'borrow' | 'preview' | 'none';
  description?: string | null;
  openLibraryUrl?: string | null;
  savedAt?: string;
  lastOpenedAt?: string | null;
};

type BookSearchResult = {
  title: string;
  subtitle: string | null;
  authors: string[];
  firstPublishYear: number | null;
  cover: {
    id: number | null;
    preferredUrl: string;
  } | null;
  openLibraryWorkKey: string | null;
  openLibraryEditionKey: string | null;
  openLibraryUrl: string | null;
  ebookAccess: 'full' | 'borrow' | 'preview' | 'none';
  description: string | null;
  internetArchiveIds: string[];
};

type GoogleWorkspaceFile = {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
};

type GoogleReaderDocument = {
  id: string;
  title: string;
  mimeType: string;
  modifiedTime: string | null;
  webViewLink: string | null;
  supported: boolean;
  supportMessage: string;
  format: 'pdf' | 'text' | 'html' | 'word' | 'spreadsheet' | 'presentation' | 'richtext' | 'unknown';
  content: string;
  summary: string | null;
};

type Props = {
  initialAssetId?: string | null;
  initialBookId?: string | null;
  mode?: 'embedded' | 'full';
  onUseForFlashcards?: (input: { title: string; text: string }) => void;
  onUseForQuiz?: (input: { title: string; text: string }) => void;
};

type WorkspaceItem =
  | { kind: 'asset'; id: string; title: string; updatedAt: string; progress: number; typeLabel: string; icon: 'text' | 'pdf' | 'image' | 'audio' | 'file'; source: ReaderAsset }
  | { kind: 'book'; id: string; title: string; updatedAt: string; progress: number; typeLabel: string; icon: 'book'; source: SavedBook }
  | { kind: 'google'; id: string; title: string; updatedAt: string; progress: number; typeLabel: string; icon: 'text' | 'file'; source: GoogleWorkspaceFile };

const CHAT_DRAFT_KEY = 'studyclaw-chat-draft';
const EREADER_LIBRARY_KEY = 'ereader_books';

function inferFormat(asset: ReaderAsset) {
  const attachment = Array.isArray(asset.metadata?.attachments) ? asset.metadata.attachments[0] : null;
  const candidate = `${asset.title} ${attachment?.name ?? ''} ${attachment?.type ?? ''}`.toLowerCase();
  if (asset.assetType === 'uploaded_pdf' || candidate.includes('.pdf') || candidate.includes('application/pdf')) return 'pdf';
  if (candidate.includes('.epub')) return 'epub';
  if (candidate.includes('.doc') || candidate.includes('.odt') || candidate.includes('wordprocessingml') || candidate.includes('application/msword')) return 'word';
  if (candidate.includes('.xls') || candidate.includes('.xlsx') || candidate.includes('.ods') || candidate.includes('spreadsheetml') || candidate.includes('application/vnd.ms-excel')) return 'spreadsheet';
  if (candidate.includes('.ppt') || candidate.includes('.pptx') || candidate.includes('.odp') || candidate.includes('presentationml') || candidate.includes('application/vnd.ms-powerpoint')) return 'presentation';
  if (candidate.includes('.rtf') || candidate.includes('application/rtf') || candidate.includes('text/rtf')) return 'richtext';
  if (asset.assetType === 'image_note') return 'image';
  if (asset.assetType === 'audio_note') return 'audio';
  if (candidate.includes('.html') || candidate.includes('.htm') || candidate.includes('text/html')) return 'html';
  return 'text';
}

function iconForFormat(format: string) {
  switch (format) {
    case 'pdf':
    case 'epub':
    case 'word':
    case 'spreadsheet':
    case 'presentation':
    case 'richtext':
    case 'text':
      return FileText;
    case 'image':
      return FileImage;
    case 'audio':
      return FileAudio;
    default:
      return File;
  }
}

function labelForFormat(format: string) {
  switch (format) {
    case 'pdf':
      return 'PDF';
    case 'epub':
      return 'EPUB';
    case 'word':
      return 'DOC/DOCX';
    case 'spreadsheet':
      return 'XLS/XLSX';
    case 'presentation':
      return 'PPT/PPTX';
    case 'richtext':
      return 'RTF';
    case 'image':
      return 'Image';
    case 'audio':
      return 'Audio';
    default:
      return 'Text';
  }
}

function splitPages(text: string, charsPerPage = 2200) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (normalized.length <= charsPerPage) return [normalized];
  const pages: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    let next = Math.min(cursor + charsPerPage, normalized.length);
    const paragraphBreak = normalized.lastIndexOf('\n\n', next);
    const sentenceBreak = normalized.lastIndexOf('. ', next);
    const wordBreak = normalized.lastIndexOf(' ', next);
    const breakPoint = [paragraphBreak, sentenceBreak, wordBreak].find((value) => value > cursor + 400);
    if (breakPoint) {
      next = breakPoint + 1;
    }
    pages.push(normalized.slice(cursor, next).trim());
    cursor = next;
  }
  return pages.filter(Boolean);
}

function formatBytes(value?: number | null) {
  if (!value || !Number.isFinite(value)) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 ** 2)).toFixed(1)} MB`;
}

function formatTimestamp(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function labelForGoogleMimeType(mimeType?: string) {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':
      return 'Google Doc';
    case 'application/vnd.google-apps.spreadsheet':
      return 'Google Sheet';
    case 'application/vnd.google-apps.presentation':
      return 'Google Slides';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'DOCX in Google Drive';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'XLSX in Google Drive';
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return 'PPTX in Google Drive';
    case 'application/pdf':
      return 'PDF in Google Drive';
    case 'text/plain':
      return 'TXT in Google Drive';
    default:
      return 'Google file';
  }
}

export default function DocumentReaderWorkspace({
  initialAssetId = null,
  initialBookId = null,
  mode = 'embedded',
  onUseForFlashcards,
  onUseForQuiz,
}: Props) {
  const [assets, setAssets] = useState<ReaderAsset[]>([]);
  const [savedBooks, setSavedBooks] = useState<SavedBook[]>([]);
  const [googleFiles, setGoogleFiles] = useState<GoogleWorkspaceFile[]>([]);
  const [bookSearchQuery, setBookSearchQuery] = useState('');
  const [bookSearchLoading, setBookSearchLoading] = useState(false);
  const [bookSearchResults, setBookSearchResults] = useState<BookSearchResult[]>([]);
  const [bookSearchStatus, setBookSearchStatus] = useState('');
  const [activeAsset, setActiveAsset] = useState<ReaderDocument | null>(null);
  const [activeBook, setActiveBook] = useState<SavedBook | null>(null);
  const [activeGoogleFile, setActiveGoogleFile] = useState<GoogleReaderDocument | null>(null);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'documents' | 'books' | 'pdf' | 'office' | 'text'>('all');
  const [sort, setSort] = useState<'recent' | 'updated' | 'title'>('recent');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [matchIndexes, setMatchIndexes] = useState<number[]>([]);
  const [annotationNote, setAnnotationNote] = useState('');
  const [annotationLabel, setAnnotationLabel] = useState('');
  const [annotationStatus, setAnnotationStatus] = useState('');
  const readerContentRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void loadAssets();
    void loadGoogleFiles();
    void loadSavedBooks();
  }, []);

  useEffect(() => {
    if (initialBookId) {
      if (activeBook && buildSavedBookId(activeBook) === initialBookId) {
        return;
      }
      const matchingBook = savedBooks.find((book) => buildSavedBookId(book) === initialBookId);
      if (matchingBook) {
        void openSavedBook(matchingBook);
      }
      return;
    }

    if (initialAssetId) {
      if (activeAsset?.id === initialAssetId) {
        return;
      }
      if (assets.some((asset) => asset.id === initialAssetId)) {
        void openAsset(initialAssetId);
      }
      return;
    }

    if (assets.length) {
      void openAsset(assets[0].id);
    }
  }, [activeAsset?.id, activeBook, assets, initialAssetId, initialBookId, savedBooks]);

  useEffect(() => {
    if (!activeAsset) return;
    const pages = splitPages(activeAsset.content);
    const safePageIndex = Math.min(Math.max(0, (activeAsset.readerState.lastPage ?? 1) - 1), Math.max(0, pages.length - 1));
    setPageIndex(safePageIndex);
  }, [activeAsset?.id]);

  useEffect(() => {
    if (!activeAsset) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveReaderState();
    }, 700);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [activeAsset?.id, pageIndex, activeAsset?.readerState.viewMode, activeAsset?.readerState.zoomLevel, activeAsset?.readerState.fontSize, activeAsset?.readerState.lineSpacing, activeAsset?.readerState.readingWidth, activeAsset?.readerState.theme]);

  useEffect(() => {
    if (!activeAsset) {
      setMatchIndexes([]);
      return;
    }
    const q = searchText.trim().toLowerCase();
    if (!q) {
      setMatchIndexes([]);
      return;
    }
    const pages = splitPages(activeAsset.content);
    const matches = pages
      .map((page, index) => (page.toLowerCase().includes(q) ? index : -1))
      .filter((index) => index >= 0);
    setMatchIndexes(matches);
  }, [searchText, activeAsset?.id]);

  const workspaceItems = useMemo<WorkspaceItem[]>(() => {
    const documentItems = assets.map((asset) => {
      const format = inferFormat(asset);
      const icon: WorkspaceItem['icon'] =
        format === 'pdf'
          ? 'pdf'
          : format === 'image'
            ? 'image'
            : format === 'audio'
              ? 'audio'
              : format === 'word' || format === 'spreadsheet' || format === 'presentation' || format === 'richtext'
                ? 'file'
                : 'text';
      return {
        kind: 'asset' as const,
        id: asset.id,
        title: asset.title,
        updatedAt: asset.lastOpenedAt || asset.updatedAt,
        progress: Number(asset.readingProgress ?? 0),
        typeLabel: labelForFormat(format),
        icon,
        source: asset,
      };
    });

    const bookItems = savedBooks.map((book) => ({
      kind: 'book' as const,
      id: String(book.key || book.gb_id || book.title),
      title: book.title,
        updatedAt: String(book.lastOpenedAt || book.savedAt || book.first_publish_year || ''),
        progress: 0,
        typeLabel: 'Saved book',
        icon: 'book' as const,
        source: book,
    }));

    const googleItems = googleFiles.map((file) => ({
      kind: 'google' as const,
      id: file.id,
      title: file.name,
      updatedAt: String(file.modifiedTime || ''),
      progress: 0,
      typeLabel: labelForGoogleMimeType(file.mimeType),
      icon:
        file.mimeType === 'application/vnd.google-apps.document' ||
        file.mimeType === 'application/vnd.google-apps.presentation'
          ? ('text' as const)
          : ('file' as const),
      source: file,
    }));

    let items = [...documentItems, ...bookItems, ...googleItems];
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery) {
      items = items.filter((item) => item.title.toLowerCase().includes(normalizedQuery));
    }
    if (typeFilter === 'documents') items = items.filter((item) => item.kind === 'asset' || item.kind === 'google');
    if (typeFilter === 'books') items = items.filter((item) => item.kind === 'book');
    if (typeFilter === 'pdf') items = items.filter((item) => item.kind === 'asset' && item.typeLabel === 'PDF');
    if (typeFilter === 'office') {
      items = items.filter((item) =>
        item.kind === 'asset'
          ? ['DOC/DOCX', 'XLS/XLSX', 'PPT/PPTX', 'RTF'].includes(item.typeLabel)
          : item.kind === 'google'
            ? /Google (Doc|Sheet|Slides)|DOCX in Google Drive|XLSX in Google Drive|PPTX in Google Drive/.test(item.typeLabel)
            : false
      );
    }
    if (typeFilter === 'text') {
      items = items.filter((item) =>
        item.kind === 'google'
          ? !/DOCX in Google Drive|XLSX in Google Drive|PPTX in Google Drive|PDF in Google Drive/.test(item.typeLabel)
          : item.kind === 'asset' && !['PDF', 'DOC/DOCX', 'XLS/XLSX', 'PPT/PPTX', 'RTF'].includes(item.typeLabel)
      );
    }

    items.sort((left, right) => {
      if (sort === 'title') return left.title.localeCompare(right.title);
      if (sort === 'updated') return String(right.updatedAt).localeCompare(String(left.updatedAt));
      return (right.progress || 0) - (left.progress || 0) || String(right.updatedAt).localeCompare(String(left.updatedAt));
    });

    return items;
  }, [assets, savedBooks, googleFiles, query, typeFilter, sort]);

  const recentDocuments = useMemo(() => {
    return [...assets]
      .filter((asset) => asset.lastOpenedAt || asset.readingProgress)
      .sort((left, right) => String(right.lastOpenedAt || right.updatedAt).localeCompare(String(left.lastOpenedAt || left.updatedAt)))
      .slice(0, 4);
  }, [assets]);

  const recentLibraryItems = useMemo(() => {
    const books = savedBooks
      .filter((book) => book.lastOpenedAt || book.savedAt)
      .map((book) => ({
        kind: 'book' as const,
        id: buildSavedBookId(book),
        title: book.title,
        progressLabel: book.author_name?.[0] || 'Saved book',
        openedAt: String(book.lastOpenedAt || book.savedAt || ''),
        source: book,
      }));

    const documents = recentDocuments.map((asset) => ({
      kind: 'asset' as const,
      id: asset.id,
      title: asset.title,
      progressLabel: `${Math.round(asset.readingProgress ?? 0)}% read`,
      openedAt: String(asset.lastOpenedAt || asset.updatedAt || ''),
      source: asset,
    }));

    return [...documents, ...books]
      .sort((left, right) => right.openedAt.localeCompare(left.openedAt))
      .slice(0, 4);
  }, [recentDocuments, savedBooks]);

  const activePages = useMemo(() => splitPages(activeAsset?.content ?? ''), [activeAsset?.content]);
  const activePage = activePages[pageIndex] ?? '';
  const activeDocumentModifiedAt =
    activeAsset?.readerState.lastOpenedAt ||
    activeAsset?.updatedAt ||
    activeAsset?.createdAt ||
    activeAsset?.metadata?.updatedAt ||
    activeAsset?.metadata?.uploadedAt ||
    activeAsset?.metadata?.savedAt ||
    activeAsset?.metadata?.date ||
    null;

  async function loadAssets() {
    setLoadingAssets(true);
    setError('');
    try {
      const response = await apiFetch('/api/coach/assets');
      const data = (await readApiPayload(response)) as ReaderAsset[];
      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'Failed to load your workspace documents'));
      }
      setAssets(Array.isArray(data) ? data : []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load your workspace documents');
    } finally {
      setLoadingAssets(false);
    }
  }

  async function loadGoogleFiles() {
    try {
      const statusResponse = await apiFetch('/api/google');
      const statusPayload = await readApiPayload(statusResponse);

      if (!statusResponse.ok || !statusPayload?.connected || !statusPayload?.canReadDrive) {
        setGoogleFiles([]);
        return;
      }

      const response = await apiFetch('/api/google/drive?kind=all&max=10');
      const payload = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to load Google files'));
      }

      setGoogleFiles(Array.isArray(payload) ? payload : []);
    } catch {
      setGoogleFiles([]);
    }
  }

  function loadSavedBooksFromStorage() {
    if (typeof window === 'undefined') return [] as SavedBook[];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(EREADER_LIBRARY_KEY) || '[]');
      return Array.isArray(parsed) ? parsed as SavedBook[] : [];
    } catch {
      return [];
    }
  }

  function persistSavedBooks(nextBooks: SavedBook[]) {
    setSavedBooks(nextBooks);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(EREADER_LIBRARY_KEY, JSON.stringify(nextBooks));
    }
  }

  function buildSavedBookId(book: SavedBook) {
    return String(book.key || book.gb_id || book.openLibraryUrl || book.title);
  }

  async function loadSavedBooks() {
    try {
      const response = await apiFetch('/api/study/library/books');
      const payload = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to load saved books'));
      }

      const serverBooks = Array.isArray(payload) ? payload as SavedBook[] : [];
      const localBooks = loadSavedBooksFromStorage();

      if (localBooks.length) {
        const known = new Set(serverBooks.map((book) => buildSavedBookId(book)));
        const missing = localBooks.filter((book) => !known.has(buildSavedBookId(book)));
        if (missing.length) {
          await Promise.all(
            missing.map((book) =>
              apiFetch('/api/study/library/books', {
                method: 'PUT',
                body: JSON.stringify(book),
              }).catch(() => null)
            )
          );
          const refreshed = await apiFetch('/api/study/library/books');
          const refreshedPayload = await readApiPayload(refreshed);
          const merged = Array.isArray(refreshedPayload) ? refreshedPayload as SavedBook[] : serverBooks;
          persistSavedBooks(merged);
          return;
        }
      }

      persistSavedBooks(serverBooks);
    } catch {
      persistSavedBooks(loadSavedBooksFromStorage());
    }
  }

  async function searchBooks() {
    const normalizedQuery = bookSearchQuery.trim();
    if (!normalizedQuery) {
      setBookSearchResults([]);
      setBookSearchStatus('Enter a title, author, subject, or ISBN.');
      return;
    }

    setBookSearchLoading(true);
    setBookSearchStatus('');
    try {
      const response = await apiFetch(`/api/study/books/search?q=${encodeURIComponent(normalizedQuery)}&limit=8`);
      const payload = await readApiPayload(response) as { results?: BookSearchResult[] };
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to search books'));
      }

      const results = Array.isArray(payload.results) ? payload.results : [];
      setBookSearchResults(results);
      setBookSearchStatus(results.length ? '' : 'No textbook or book matches found yet. Try a broader title or subject.');
    } catch (nextError) {
      setBookSearchResults([]);
      setBookSearchStatus(nextError instanceof Error ? nextError.message : 'Failed to search books');
    } finally {
      setBookSearchLoading(false);
    }
  }

  async function saveBookToLibrary(book: BookSearchResult) {
    const key = book.openLibraryWorkKey || book.openLibraryEditionKey || book.openLibraryUrl || book.title;
    const nextBook: SavedBook = {
      key: book.openLibraryWorkKey || undefined,
      title: book.title,
      subtitle: book.subtitle,
      author_name: book.authors,
      cover_i: book.cover?.id ?? undefined,
      ia: book.internetArchiveIds,
      first_publish_year: book.firstPublishYear ?? undefined,
      ebookAccess: book.ebookAccess,
      description: book.description,
      openLibraryUrl: book.openLibraryUrl,
      savedAt: new Date().toISOString(),
    };

    const existing = savedBooks.find((item) => buildSavedBookId(item) === String(key));

    try {
      const response = await apiFetch('/api/study/library/books', {
        method: 'PUT',
        body: JSON.stringify(nextBook),
      });
      const payload = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to save this book'));
      }

      const saved = payload as SavedBook;
      const nextBooks = existing
        ? savedBooks.map((item) => (buildSavedBookId(item) === buildSavedBookId(saved) ? saved : item))
        : [saved, ...savedBooks];
      persistSavedBooks(nextBooks);
      await openSavedBook(saved);
      setBookSearchStatus(existing ? 'Book already in your library. Opened it in the reader.' : 'Saved to your library.');
    } catch (nextError) {
      setBookSearchStatus(nextError instanceof Error ? nextError.message : 'Failed to save this book');
    }
  }

  async function openAsset(assetId: string) {
    setLoadingDocument(true);
    setError('');
    setActiveBook(null);
    setActiveGoogleFile(null);
    try {
      const response = await apiFetch(`/api/coach/assets/${assetId}/reader`);
      const data = (await readApiPayload(response)) as ReaderDocument;
      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'Failed to open this document'));
      }
      setActiveAsset(data);
      setMobileExplorerOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to open this document');
    } finally {
      setLoadingDocument(false);
    }
  }

  async function openGoogleFile(fileId: string) {
    setLoadingDocument(true);
    setError('');
    setActiveAsset(null);
    setActiveBook(null);
    try {
      const response = await apiFetch(`/api/google/drive/${fileId}/reader`);
      const data = (await readApiPayload(response)) as GoogleReaderDocument;
      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'Failed to open this Google file'));
      }
      setActiveGoogleFile(data);
      setMobileExplorerOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to open this Google file');
    } finally {
      setLoadingDocument(false);
    }
  }

  async function saveReaderState() {
    if (!activeAsset) return;
    const response = await apiFetch(`/api/coach/assets/${activeAsset.id}/reader/state`, {
      method: 'PUT',
      body: JSON.stringify({
        progressPercent: activePages.length ? (((pageIndex + 1) / activePages.length) * 100).toFixed(1) : 0,
        lastPage: activePages.length ? pageIndex + 1 : null,
        lastPosition: activeAsset.readerState.viewMode === 'scroll' ? `scroll:${pageIndex + 1}` : `page:${pageIndex + 1}`,
        viewMode: activeAsset.readerState.viewMode,
        zoomLevel: activeAsset.readerState.zoomLevel,
        fontSize: activeAsset.readerState.fontSize,
        lineSpacing: activeAsset.readerState.lineSpacing,
        readingWidth: activeAsset.readerState.readingWidth,
        theme: activeAsset.readerState.theme,
      }),
    });
    if (!response.ok) return;
    const payload = await readApiPayload(response);
    setActiveAsset((current) => current ? { ...current, readerState: payload.readerState } : current);
    setAssets((current) =>
      current.map((asset) =>
        asset.id === activeAsset.id
          ? {
              ...asset,
              readingProgress: payload.readerState?.progressPercent ?? asset.readingProgress,
              lastOpenedAt: payload.readerState?.lastOpenedAt ?? asset.lastOpenedAt,
              lastPage: payload.readerState?.lastPage ?? asset.lastPage,
            }
          : asset
      )
    );
  }

  async function createAnnotation(kind: 'bookmark' | 'note' | 'highlight', snippet?: string | null) {
    if (!activeAsset) return;
    setAnnotationStatus('');
    const response = await apiFetch(`/api/coach/assets/${activeAsset.id}/reader/annotations`, {
      method: 'POST',
      body: JSON.stringify({
        kind,
        label: annotationLabel || (kind === 'bookmark' ? `Page ${pageIndex + 1}` : ''),
        snippet: snippet || (kind === 'bookmark' ? activePage.slice(0, 160) : ''),
        note: annotationNote || null,
        location: `${activeAsset.readerState.viewMode}:${pageIndex + 1}`,
        pageNumber: pageIndex + 1,
      }),
    });
    const payload = await readApiPayload(response);
    if (!response.ok) {
      setAnnotationStatus(getApiErrorMessage(payload, 'Failed to save annotation'));
      return;
    }
    setActiveAsset((current) =>
      current
        ? { ...current, annotations: [payload as ReaderAnnotation, ...current.annotations] }
        : current
    );
    setAnnotationLabel('');
    setAnnotationNote('');
    setAnnotationStatus(kind === 'bookmark' ? 'Bookmark saved.' : kind === 'highlight' ? 'Highlight saved.' : 'Note saved.');
  }

  async function removeAnnotation(annotationId: string) {
    if (!activeAsset) return;
    const response = await apiFetch(`/api/coach/assets/${activeAsset.id}/reader/annotations/${annotationId}`, {
      method: 'DELETE',
    });
    if (!response.ok) return;
    setActiveAsset((current) =>
      current
        ? { ...current, annotations: current.annotations.filter((item) => item.id !== annotationId) }
        : current
    );
  }

  function captureSelectionAsHighlight() {
    const selection = window.getSelection?.()?.toString().trim();
    if (!selection) {
      setAnnotationStatus('Select some text in the document first.');
      return;
    }
    void createAnnotation('highlight', selection.slice(0, 400));
  }

  async function openSavedBook(book: SavedBook) {
    const bookId = encodeURIComponent(buildSavedBookId(book));
    try {
      const response = await apiFetch(`/api/study/library/books/${bookId}/open`, {
        method: 'POST',
      });
      const payload = await readApiPayload(response);
      if (response.ok) {
        const saved = payload as SavedBook;
        setSavedBooks((current) =>
          current.map((item) => (buildSavedBookId(item) === buildSavedBookId(saved) ? saved : item))
        );
        book = saved;
      }
    } catch {
      // Ignore open-state sync failures and still let the reader open the book locally.
    }

    setActiveAsset(null);
    setActiveGoogleFile(null);
    setActiveBook(book);
    setError('');
    setMobileExplorerOpen(false);
  }

  function setReaderSetting<K extends keyof ReaderDocument['readerState']>(key: K, value: ReaderDocument['readerState'][K]) {
    setActiveAsset((current) => (current ? { ...current, readerState: { ...current.readerState, [key]: value } } : current));
  }

  function handoffToChat() {
    if (!activeAsset) return;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(
        CHAT_DRAFT_KEY,
        JSON.stringify({
          message: `Help me study this document:\n\nTitle: ${activeAsset.title}\nSection: ${activeAsset.sectionName}\n\n${(activeAsset.summary || activeAsset.content).slice(0, 2800)}`,
          mode: 'general',
        })
      );
      window.location.assign('/chat');
    }
  }

  function handoffGoogleFileToChat() {
    if (!activeGoogleFile) return;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(
        CHAT_DRAFT_KEY,
        JSON.stringify({
          message: `Help me study this Google file:\n\nTitle: ${activeGoogleFile.title}\nType: ${labelForGoogleMimeType(activeGoogleFile.mimeType)}\n\n${(activeGoogleFile.summary || activeGoogleFile.content).slice(0, 2800)}`,
          mode: 'general',
        })
      );
      window.location.assign('/chat');
    }
  }

  const explorer = (
    <aside className={`reader-workspace__explorer ${mobileExplorerOpen ? 'is-open' : ''}`}>
      <div className="reader-workspace__explorer-head">
        <div>
          <p className="eyebrow">Workspace library</p>
          <h2 className="section-title">Files and books</h2>
        </div>
        <div className="reader-workspace__toggle-group">
          <button type="button" className={view === 'list' ? 'is-active' : ''} onClick={() => setView('list')} aria-label="List view">
            <List className="w-4 h-4" />
          </button>
          <button type="button" className={view === 'grid' ? 'is-active' : ''} onClick={() => setView('grid')} aria-label="Grid view">
            <Grid2X2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="reader-workspace__toolbar">
        <label className="reader-workspace__search">
          <Search className="w-4 h-4" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents and saved books" />
        </label>
        <div className="reader-workspace__toolbar-row">
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as any)}>
            <option value="all">All items</option>
            <option value="documents">Workspace docs</option>
            <option value="books">Saved books</option>
            <option value="pdf">PDFs</option>
            <option value="office">DOCX, XLSX, PPTX, RTF</option>
            <option value="text">Text docs</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value as any)}>
            <option value="recent">Recent</option>
            <option value="updated">Updated</option>
            <option value="title">Title</option>
          </select>
        </div>
      </div>

      <section className="reader-workspace__book-search">
        <div className="reader-workspace__book-search-head">
          <div>
            <p className="eyebrow">Find books</p>
            <strong>Search Open Library and save books here</strong>
          </div>
        </div>
        <div className="reader-workspace__book-search-bar">
          <input
            value={bookSearchQuery}
            onChange={(event) => setBookSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void searchBooks();
              }
            }}
            placeholder="Search by title, author, subject, or ISBN"
          />
          <button type="button" className="primary-link-button" onClick={() => void searchBooks()} disabled={bookSearchLoading}>
            {bookSearchLoading ? 'Searching…' : 'Find books'}
          </button>
        </div>
        {bookSearchStatus ? <p className="muted-copy">{bookSearchStatus}</p> : null}
        {bookSearchResults.length ? (
          <div className="reader-workspace__book-search-results">
            {bookSearchResults.map((book) => {
              const saved = savedBooks.some(
                (item) =>
                  String(item.key || item.gb_id || item.title) ===
                  String(book.openLibraryWorkKey || book.openLibraryEditionKey || book.openLibraryUrl || book.title)
              );
              return (
                <article
                  key={`${book.openLibraryWorkKey || book.openLibraryEditionKey || book.openLibraryUrl || book.title}`}
                  className="reader-workspace__book-result"
                >
                  <div className="reader-workspace__book-result-body">
                    <strong>{book.title}</strong>
                    <span>
                      {book.authors[0] || 'Unknown author'}
                      {book.firstPublishYear ? ` · ${book.firstPublishYear}` : ''}
                      {book.ebookAccess !== 'none' ? ` · ${book.ebookAccess} access` : ''}
                    </span>
                    {book.subtitle ? <small>{book.subtitle}</small> : null}
                  </div>
                  <div className="reader-workspace__book-result-actions">
                    <button
                      type="button"
                      className={saved ? 'ghost-button' : 'primary-link-button'}
                      onClick={() => saveBookToLibrary(book)}
                    >
                      {saved ? 'Open saved' : 'Save to library'}
                    </button>
                    {book.openLibraryUrl ? (
                      <a href={book.openLibraryUrl} target="_blank" rel="noreferrer" className="ghost-button">
                        View source
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

      <div className="reader-workspace__upload-row">
        <Link href="/coach" className="primary-link-button">Upload in Backpack</Link>
        <Link href="/reader" className="ghost-button">Open full reader</Link>
      </div>

      {recentLibraryItems.length ? (
        <section className="reader-workspace__recent">
          <p className="eyebrow">Continue reading</p>
          <div className="reader-workspace__recent-list">
            {recentLibraryItems.map((item) => (
              <button
                key={`${item.kind}-${item.id}`}
                type="button"
                className="reader-workspace__recent-item"
                onClick={() => (item.kind === 'asset' ? void openAsset(item.id) : void openSavedBook(item.source))}
              >
                <strong>{item.title}</strong>
                <span>{item.progressLabel}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {loadingAssets ? (
        <div className="reader-workspace__empty">
          <strong>Loading your workspace files…</strong>
        </div>
      ) : workspaceItems.length ? (
        <div className={view === 'grid' ? 'reader-workspace__grid' : 'reader-workspace__list'}>
          {workspaceItems.map((item) => {
            const Icon =
              item.icon === 'book'
                ? BookOpen
                : item.icon === 'image'
                  ? FileImage
                  : item.icon === 'audio'
                    ? FileAudio
                    : FileText;
            const isActive =
              item.kind === 'asset'
                ? activeAsset?.id === item.id
                : item.kind === 'google'
                  ? activeGoogleFile?.id === item.id
                  : activeBook && (activeBook.key || activeBook.gb_id || activeBook.title) === item.id;
            return (
              <button
                key={`${item.kind}-${item.id}`}
                type="button"
                className={`reader-workspace__item ${isActive ? 'is-active' : ''}`}
                onClick={() =>
                  item.kind === 'asset'
                    ? void openAsset(item.id)
                    : item.kind === 'google'
                      ? void openGoogleFile(item.id)
                      : void openSavedBook(item.source)
                }
              >
                <div className="reader-workspace__item-icon"><Icon className="w-4 h-4" /></div>
                <div className="reader-workspace__item-body">
                  <strong>{item.title}</strong>
                  <span>{item.typeLabel}</span>
                  <small>
                    {item.kind === 'asset'
                      ? `${Math.round(item.progress)}% read · ${formatTimestamp(item.updatedAt)}`
                      : item.kind === 'google'
                        ? `${item.typeLabel} · ${formatTimestamp(item.updatedAt)}`
                        : item.source.author_name?.[0] || 'Saved book'}
                  </small>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="reader-workspace__empty">
          <strong>Upload a document to start reading in your workspace.</strong>
          <p>Backpack uploads, Google workspace files, saved textbook results, and recent reading progress will appear here.</p>
        </div>
      )}
    </aside>
  );

  return (
    <section className={`reader-workspace ${mode === 'full' ? 'is-full' : ''}`}>
      <div className="reader-workspace__mobile-bar">
        <button type="button" className="ghost-button" onClick={() => setMobileExplorerOpen((current) => !current)} aria-label="Toggle document explorer">
          <PanelLeft className="w-4 h-4" />
          Browse library
        </button>
      </div>

      {explorer}

      <main className="reader-workspace__reader">
        {loadingDocument ? (
          <div className="reader-workspace__empty"><strong>Opening document…</strong></div>
        ) : activeAsset ? (
          <>
            <header className="reader-workspace__reader-head">
              <div>
                <p className="eyebrow">Active document</p>
                <h2 className="section-title">{activeAsset.title}</h2>
                <p className="muted-copy">
                  {activeAsset.sectionName} · {labelForFormat(activeAsset.format)} · {activePages.length || 1} page view{activePages.length === 1 ? '' : 's'} · {Math.round(activeAsset.readerState.progressPercent)}% read
                </p>
              </div>
              <div className="reader-workspace__reader-actions">
                <button type="button" className="ghost-button" onClick={() => setReaderSetting('viewMode', activeAsset.readerState.viewMode === 'scroll' ? 'paged' : 'scroll')}>
                  {activeAsset.readerState.viewMode === 'scroll' ? 'Paged view' : 'Scroll view'}
                </button>
                {activeAsset.fileUrl ? (
                  <a href={activeAsset.fileUrl} target="_blank" rel="noreferrer" className="ghost-button">
                    <ExternalLink className="w-4 h-4" />
                    Open file
                  </a>
                ) : null}
              </div>
            </header>

            <section className="reader-workspace__reader-toolbar">
              <label>
                Find in document
                <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search this file" />
              </label>
              <label>
                Font size
                <input type="range" min={14} max={28} value={activeAsset.readerState.fontSize} onChange={(event) => setReaderSetting('fontSize', Number(event.target.value))} />
              </label>
              <label>
                Line spacing
                <input type="range" min={1} max={2.2} step={0.1} value={activeAsset.readerState.lineSpacing} onChange={(event) => setReaderSetting('lineSpacing', Number(event.target.value))} />
              </label>
              <label>
                Theme
                <select value={activeAsset.readerState.theme} onChange={(event) => setReaderSetting('theme', event.target.value as any)}>
                  <option value="paper">Paper</option>
                  <option value="dark">Dark</option>
                  <option value="sage">Sage</option>
                </select>
              </label>
              {activeAsset.readerState.viewMode === 'paged' ? (
                <div className="reader-workspace__pager">
                  <button type="button" className="ghost-button" onClick={() => setPageIndex((current) => Math.max(0, current - 1))}>Prev</button>
                  <span>Page {pageIndex + 1} / {Math.max(activePages.length, 1)}</span>
                  <button type="button" className="ghost-button" onClick={() => setPageIndex((current) => Math.min(Math.max(activePages.length - 1, 0), current + 1))}>Next</button>
                </div>
              ) : null}
            </section>

            <section className={`reader-workspace__reader-panel theme-${activeAsset.readerState.theme}`}>
              <div className="reader-workspace__document-meta">
                <article>
                  <span>Modified</span>
                  <strong>{formatTimestamp(activeDocumentModifiedAt)}</strong>
                </article>
                <article>
                  <span>Size</span>
                  <strong>{formatBytes(activeAsset.metadata?.fileSize || activeAsset.metadata?.attachments?.[0]?.size)}</strong>
                </article>
                <article>
                  <span>Support</span>
                  <strong>{activeAsset.supported ? 'Ready to read' : 'Preview only'}</strong>
                </article>
              </div>

              {activeAsset.summary ? (
                <div className="reader-workspace__summary">
                  <strong>Document summary</strong>
                  <p>{activeAsset.summary}</p>
                </div>
              ) : null}

              {!activeAsset.supported ? (
                <div className="reader-workspace__empty">
                  <strong>{activeAsset.supportMessage}</strong>
                  <p>StudyClaw will still keep the metadata, reading notes, and study actions attached to this file.</p>
                </div>
              ) : activeAsset.readerState.viewMode === 'scroll' ? (
                <div
                  ref={readerContentRef}
                  className="reader-workspace__document reader-workspace__document--scroll"
                  style={{
                    fontSize: `${activeAsset.readerState.fontSize}px`,
                    lineHeight: activeAsset.readerState.lineSpacing,
                    maxWidth: `${activeAsset.readerState.readingWidth}px`,
                  }}
                >
                  {activePages.map((page, index) => (
                    <article key={`${activeAsset.id}-page-${index}`} className="reader-workspace__page">
                      <header><span>Page {index + 1}</span></header>
                      {page.split('\n').filter(Boolean).map((paragraph, paragraphIndex) => (
                        <p key={`${index}-${paragraphIndex}`}>{paragraph}</p>
                      ))}
                    </article>
                  ))}
                </div>
              ) : (
                <div
                  ref={readerContentRef}
                  className="reader-workspace__document"
                  style={{
                    fontSize: `${activeAsset.readerState.fontSize}px`,
                    lineHeight: activeAsset.readerState.lineSpacing,
                    maxWidth: `${activeAsset.readerState.readingWidth}px`,
                  }}
                >
                  <article className="reader-workspace__page">
                    <header><span>Page {pageIndex + 1}</span></header>
                    {activePage.split('\n').filter(Boolean).map((paragraph, paragraphIndex) => (
                      <p key={`${pageIndex}-${paragraphIndex}`}>{paragraph}</p>
                    ))}
                  </article>
                </div>
              )}
            </section>

            <section className="reader-workspace__annotation-tools">
              <div className="reader-workspace__annotation-actions">
                <button type="button" className="ghost-button" onClick={() => void createAnnotation('bookmark')}>
                  <Bookmark className="w-4 h-4" />
                  Bookmark page
                </button>
                <button type="button" className="ghost-button" onClick={captureSelectionAsHighlight}>
                  <Highlighter className="w-4 h-4" />
                  Highlight selection
                </button>
              </div>
              <div className="reader-workspace__annotation-form">
                <input value={annotationLabel} onChange={(event) => setAnnotationLabel(event.target.value)} placeholder="Bookmark or note title" />
                <textarea value={annotationNote} onChange={(event) => setAnnotationNote(event.target.value)} rows={3} placeholder="Add a reading note or reminder for yourself" />
                <button type="button" onClick={() => void createAnnotation('note')}>
                  <NotebookPen className="w-4 h-4" />
                  Save note
                </button>
              </div>
              {annotationStatus ? <p className="muted-copy">{annotationStatus}</p> : null}
            </section>

            <section className="reader-workspace__ai-tools">
              <div>
                <p className="eyebrow">AI actions</p>
                <h3>Use this document without losing your reading spot</h3>
              </div>
              <div className="reader-workspace__ai-actions">
                {onUseForFlashcards ? (
                  <button type="button" onClick={() => onUseForFlashcards({ title: activeAsset.title, text: activeAsset.content || activeAsset.summary || '' })}>
                    <Sparkles className="w-4 h-4" />
                    Use for flashcards
                  </button>
                ) : null}
                {onUseForQuiz ? (
                  <button type="button" onClick={() => onUseForQuiz({ title: activeAsset.title, text: activeAsset.content || activeAsset.summary || '' })}>
                    <Sparkles className="w-4 h-4" />
                    Use for quiz
                  </button>
                ) : null}
                <button type="button" onClick={handoffToChat}>
                  <MessageSquare className="w-4 h-4" />
                  Ask StudyClaw about this
                </button>
              </div>
            </section>

            {matchIndexes.length ? (
              <section className="reader-workspace__matches">
                <strong>Search matches</strong>
                <div className="reader-workspace__match-list">
                  {matchIndexes.slice(0, 8).map((index) => (
                    <button key={`match-${index}`} type="button" className="ghost-button" onClick={() => setPageIndex(index)}>
                      Jump to page {index + 1}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {activeAsset.annotations.length ? (
              <section className="reader-workspace__annotations">
                <div className="reader-workspace__annotations-head">
                  <div>
                    <p className="eyebrow">Saved markers</p>
                    <h3>Bookmarks, highlights, and notes</h3>
                  </div>
                </div>
                <div className="reader-workspace__annotation-list">
                  {activeAsset.annotations.map((annotation) => (
                    <article key={annotation.id} className="reader-workspace__annotation-card">
                      <div>
                        <strong>{annotation.label || annotation.kind}</strong>
                        <p className="muted-copy">
                          {annotation.pageNumber ? `Page ${annotation.pageNumber}` : annotation.location || 'Saved location'} · {formatTimestamp(annotation.createdAt)}
                        </p>
                        {annotation.snippet ? <p>{annotation.snippet}</p> : null}
                        {annotation.note ? <p>{annotation.note}</p> : null}
                      </div>
                      <button type="button" className="ghost-button" onClick={() => void removeAnnotation(annotation.id)}>Remove</button>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : activeGoogleFile ? (
          <>
            <header className="reader-workspace__reader-head">
              <div>
                <p className="eyebrow">Google workspace file</p>
                <h2 className="section-title">{activeGoogleFile.title}</h2>
                <p className="muted-copy">
                  {labelForGoogleMimeType(activeGoogleFile.mimeType)} · {activeGoogleFile.supported ? 'Ready to read' : 'Preview only'}
                </p>
              </div>
              <div className="reader-workspace__reader-actions">
                {activeGoogleFile.webViewLink ? (
                  <a href={activeGoogleFile.webViewLink} target="_blank" rel="noreferrer" className="ghost-button">
                    <ExternalLink className="w-4 h-4" />
                    Open in Google
                  </a>
                ) : null}
              </div>
            </header>

            <section className="reader-workspace__reader-panel theme-paper">
              <div className="reader-workspace__document-meta">
                <article>
                  <span>Modified</span>
                  <strong>{formatTimestamp(activeGoogleFile.modifiedTime)}</strong>
                </article>
                <article>
                  <span>Type</span>
                  <strong>{labelForGoogleMimeType(activeGoogleFile.mimeType)}</strong>
                </article>
                <article>
                  <span>Support</span>
                  <strong>{activeGoogleFile.supported ? 'Ready to read' : 'Preview only'}</strong>
                </article>
              </div>

              {activeGoogleFile.summary ? (
                <div className="reader-workspace__summary">
                  <strong>File summary</strong>
                  <p>{activeGoogleFile.summary}</p>
                </div>
              ) : null}

              {!activeGoogleFile.supported ? (
                <div className="reader-workspace__empty">
                  <strong>{activeGoogleFile.supportMessage}</strong>
                  <p>Open this file in Google for full fidelity while StudyClaw support is still expanding.</p>
                </div>
              ) : (
                <div
                  ref={readerContentRef}
                  className="reader-workspace__document reader-workspace__document--scroll"
                  style={{
                    fontSize: '18px',
                    lineHeight: 1.7,
                    maxWidth: '880px',
                  }}
                >
                  {splitPages(activeGoogleFile.content).map((page, index) => (
                    <article key={`${activeGoogleFile.id}-page-${index}`} className="reader-workspace__page">
                      <header><span>Page {index + 1}</span></header>
                      {page.split('\n').filter(Boolean).map((paragraph, paragraphIndex) => (
                        <p key={`${index}-${paragraphIndex}`}>{paragraph}</p>
                      ))}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="reader-workspace__ai-tools">
              <div>
                <p className="eyebrow">AI actions</p>
                <h3>Use this Google file without leaving your place</h3>
              </div>
              <div className="reader-workspace__ai-actions">
                {onUseForFlashcards ? (
                  <button type="button" onClick={() => onUseForFlashcards({ title: activeGoogleFile.title, text: activeGoogleFile.content || activeGoogleFile.summary || '' })}>
                    <Sparkles className="w-4 h-4" />
                    Use for flashcards
                  </button>
                ) : null}
                {onUseForQuiz ? (
                  <button type="button" onClick={() => onUseForQuiz({ title: activeGoogleFile.title, text: activeGoogleFile.content || activeGoogleFile.summary || '' })}>
                    <Sparkles className="w-4 h-4" />
                    Use for quiz
                  </button>
                ) : null}
                <button type="button" onClick={handoffGoogleFileToChat}>
                  <MessageSquare className="w-4 h-4" />
                  Ask StudyClaw about this
                </button>
              </div>
            </section>
          </>
        ) : activeBook ? (
          <section className="reader-workspace__book-preview">
            <header className="reader-workspace__reader-head">
              <div>
                <p className="eyebrow">Saved book</p>
                <h2 className="section-title">{activeBook.title}</h2>
                <p className="muted-copy">{activeBook.author_name?.join(', ') || 'Saved from the classic StudyClaw eReader library'}</p>
              </div>
            </header>
            {activeBook.ia?.[0] ? (
              <iframe
                title={activeBook.title}
                src={`https://archive.org/embed/${activeBook.ia[0]}?output=html`}
                className="reader-workspace__book-frame"
              />
            ) : (
              <div className="reader-workspace__empty">
                <strong>This saved book does not have a direct preview here yet.</strong>
                <p>Open it in the classic StudyClaw eReader or on Open Library.</p>
                <div className="actions">
                  <Link href="/ereader/index.html" target="_blank" rel="noreferrer" className="primary-link-button">Open classic eReader</Link>
                  {activeBook.openLibraryUrl || activeBook.key ? (
                    <a
                      href={activeBook.openLibraryUrl || `https://openlibrary.org${activeBook.key}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ghost-button"
                    >
                      Open on Open Library
                    </a>
                  ) : null}
                </div>
              </div>
            )}
          </section>
        ) : (
          <div className="reader-workspace__empty">
            {error ? <strong>{error}</strong> : <strong>Select a workspace document or saved book to start reading.</strong>}
            <p>Upload a document in Backpack or save a book in the classic eReader to populate this workspace.</p>
          </div>
        )}
      </main>
    </section>
  );
}
