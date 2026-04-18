'use client';

import Link from 'next/link';
import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { apiFetch, getApiErrorMessage, readApiPayload } from '../../lib/api';
import { extractDocumentText } from '../../lib/document-text';
import { readStoredSession } from '../../lib/session';
import GenerationStatusCard, { type GenerationStatus } from '../components/generation-status-card';
import StatusBanner from '../components/status-banner';

type UploadedAsset = {
  id: string;
  name: string;
  type: string;
  extractedText: string;
};

type KnowledgeItem = {
  id: string;
  title: string;
  detail: string;
  source_type: string;
  created_at: string;
};

type SavedNote = {
  id: string;
  title: string;
  originalText: string;
  processedText: string;
  assetType: string;
  metadata: {
    summary?: string;
    actionItems?: string[];
    knowledge?: Array<{ title: string; detail: string; kind: string }>;
    attachments?: Array<{ name?: string; type?: string }>;
    sectionName?: string;
    sourceType?: string;
  };
  createdAt: string;
  updatedAt: string;
  subjectId: string | null;
  sectionName: string;
  source?: 'backpack' | 'native-file';
  fileType?: 'doc' | 'spreadsheet' | 'note' | null;
};

type FlashcardSet = {
  id: string;
  title: string;
  created_at: string;
  cards: Array<{ id?: string; front: string; back: string }>;
};

type Quiz = {
  id: string;
  title: string;
  mode: string;
  created_at: string;
  questions: Array<{ id?: string; question_text: string; explanation: string }>;
};

type StudyLibrary = {
  flashcardSets: FlashcardSet[];
  quizzes: Quiz[];
};

type ActionItemSchedulePreset = 'today_evening' | 'tomorrow_evening' | 'this_weekend';

const actionItemScheduleOptions: Array<{ key: ActionItemSchedulePreset; label: string }> = [
  { key: 'today_evening', label: 'Tonight · 6 PM' },
  { key: 'tomorrow_evening', label: 'Tomorrow · 6 PM' },
  { key: 'this_weekend', label: 'This weekend · 10 AM' },
];

const coachPersonalities = [
  {
    key: 'quick_start_2',
    name: 'Willow',
    emoji: '🌿',
    tagline: 'Calm and steady',
    description: 'Best when you want patient explanations, step-by-step help, and less pressure.',
  },
  {
    key: 'quick_start_1',
    name: 'Dixie',
    emoji: '⚡',
    tagline: 'Fast and motivating',
    description: 'Best when you want momentum, quick check-ins, and a push to get moving.',
  },
] as const;

function createAssetId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function formatSavedDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Recently saved';
  }

  return parsed.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
}

function buildNotePreview(note: SavedNote | null) {
  const source = note?.metadata.summary || note?.processedText || note?.originalText || '';
  return source.replace(/\s+/g, ' ').trim().slice(0, 180);
}

export default function CoachPage() {
  const [queryPreferredAssetId, setQueryPreferredAssetId] = useState<string | null>(null);
  const [isIntroFlow, setIsIntroFlow] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [coachTitle, setCoachTitle] = useState('Lecture note capture');
  const [coachText, setCoachText] = useState('');
  const [processing, setProcessing] = useState(false);
  const [coachSummary, setCoachSummary] = useState('');
  const [coachTranscript, setCoachTranscript] = useState('');
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [actionItems, setActionItems] = useState<string[]>([]);
  const [knowledgeDrafts, setKnowledgeDrafts] = useState<Array<{ title: string; detail: string; kind: string }>>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [savedNotes, setSavedNotes] = useState<SavedNote[]>([]);
  const [nativeFiles, setNativeFiles] = useState<SavedNote[]>([]);
  const [studyLibrary, setStudyLibrary] = useState<StudyLibrary>({ flashcardSets: [], quizzes: [] });
  const [generatingAsset, setGeneratingAsset] = useState<'flashcards' | 'quiz' | null>(null);
  const [noteActionStatus, setNoteActionStatus] = useState<{ tone: 'neutral' | 'warning'; message: string } | null>(null);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus | null>(null);
  const [showFullSelectedNote, setShowFullSelectedNote] = useState(false);
  const [actionItemSchedules, setActionItemSchedules] = useState<Record<string, ActionItemSchedulePreset>>({});
  const [schedulingActionItemKey, setSchedulingActionItemKey] = useState<string | null>(null);
  const [scheduledActionItems, setScheduledActionItems] = useState<string[]>([]);
  const [showPasteText, setShowPasteText] = useState(false);
  const [showSavedKnowledge, setShowSavedKnowledge] = useState(false);
  const [showStudyOutputs, setShowStudyOutputs] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historySectionFilter, setHistorySectionFilter] = useState('all');
  const [historyDateFilter, setHistoryDateFilter] = useState<'all' | '7d' | '30d'>('all');
  const [activeAgentType, setActiveAgentType] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    setIsIntroFlow(params.get('intro') === '1' || params.get('bootstrap') === '1');
    setQueryPreferredAssetId(params.get('assetId'));
  }, []);

  useEffect(() => {
    const storedSession = readStoredSession();
    setHasSession(!!storedSession?.user?.id);
    setActiveAgentType(storedSession?.user?.agent_type ?? null);
  }, []);

  useEffect(() => {
    if (!hasSession) return;
    void loadKnowledge();
    void loadSavedNotes();
    void loadStudyLibrary();
  }, [hasSession, isIntroFlow]);

  useEffect(() => {
    if (!hasSession || !queryPreferredAssetId) {
      return;
    }

    void loadSavedNotes(queryPreferredAssetId);
  }, [hasSession, queryPreferredAssetId]);

  useEffect(() => {
    setShowFullSelectedNote(false);
    setNoteActionStatus(null);
  }, [selectedDocumentId]);

  useEffect(() => {
    setScheduledActionItems([]);
  }, [selectedDocumentId]);

  useEffect(() => {
    if (coachText.trim()) {
      setShowPasteText(true);
    }
  }, [coachText]);

  async function loadKnowledge() {
    const response = await apiFetch('/api/coach/knowledge');
    const data = await response.json();
    if (response.ok) {
      setKnowledgeItems(data);
    }
  }

  async function loadSavedNotes(preferredDocumentId?: string) {
    const response = await apiFetch('/api/coach/assets');
    const data = await response.json();
    if (!response.ok) {
      setFeedback(data.message || 'Failed to load saved notes');
      return;
    }

    const nextSavedNotes = Array.isArray(data.assets) ? data.assets : [];
    const nextNativeFiles = Array.isArray(data.nativeFiles) ? data.nativeFiles : [];
    setSavedNotes(nextSavedNotes);
    setNativeFiles(nextNativeFiles);
    const nextSelectedId =
      preferredDocumentId ??
      queryPreferredAssetId ??
      selectedDocumentId ??
      nextSavedNotes[0]?.id ??
      nextNativeFiles[0]?.id ??
      null;
    setSelectedDocumentId(nextSelectedId);
  }

  async function loadStudyLibrary() {
    const response = await apiFetch('/api/study/library');
    const data = await response.json();
    if (!response.ok) {
      setFeedback(data.message || 'Failed to load study library');
      return;
    }

    setStudyLibrary({
      flashcardSets: data.flashcardSets ?? [],
      quizzes: data.quizzes ?? [],
    });
  }

  async function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    const nextAssets = await Promise.all(
      selectedFiles.map(async (file) => {
        try {
          return {
            id: createAssetId(file),
            name: file.name,
            type: file.type || 'application/octet-stream',
            extractedText: await extractDocumentText(file),
          };
        } catch {
          return {
            id: createAssetId(file),
            name: file.name,
            type: file.type || 'application/octet-stream',
            extractedText: '',
          };
        }
      })
    );

    setAssets((current) => [...current, ...nextAssets]);
    if (nextAssets.some((asset) => !asset.extractedText.trim())) {
      setFeedback('One or more files were attached without extractable text. You can still submit them, but paste OCR or transcript text for the best summary.');
    } else {
      setFeedback('');
    }
    if (!selectedDocumentId && nextAssets[0]) {
      setSelectedDocumentId(nextAssets[0].id);
    }
    if (!coachText.trim()) {
      setCoachText(nextAssets.map((asset) => asset.extractedText).filter(Boolean).join('\n\n'));
    }

    event.target.value = '';
  }

  const coachPayloadText = useMemo(() => {
    const fromAssets = assets.map((asset) => asset.extractedText.trim()).filter(Boolean).join('\n\n');
    return [fromAssets, coachText].filter(Boolean).join('\n\n').trim();
  }, [assets, coachText]);

  async function processCoachNotes() {
    if (!coachPayloadText && !assets.length) {
      setFeedback('Upload a note or add transcript/extracted text first.');
      return;
    }

    setProcessing(true);
    setFeedback('');

    try {
      const response = await apiFetch('/api/coach/process', {
        method: 'POST',
        body: JSON.stringify({
          title: coachTitle,
          text:
            coachPayloadText ||
            `Uploaded document metadata:\n${assets
              .map((asset) => `- ${asset.name} (${asset.type})`)
              .join('\n')}\n\nNo extracted text was available. Summarize what can be inferred from the document names and ask for pasted transcript or extracted text where needed.`,
          sourceType: assets[0]?.type?.startsWith('audio/')
            ? 'audio'
            : assets[0]?.type?.startsWith('image/')
              ? 'photo'
              : 'document',
          attachments: assets.map((asset) => ({ name: asset.name, type: asset.type })),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to process note');
      }

      setCoachTranscript(data.transcript || '');
      setCoachSummary(data.summary || '');
      setActionItems(data.actionItems || []);
      setKnowledgeDrafts(data.knowledge || []);
      await loadSavedNotes(data.assetId || undefined);
    } catch (error: any) {
      setFeedback(error.message || 'Failed to process note');
    } finally {
      setProcessing(false);
    }
  }

  async function saveKnowledgeItem(item: { title: string; detail: string; kind: string }) {
    const response = await apiFetch('/api/coach/knowledge', {
      method: 'POST',
      body: JSON.stringify({
        title: item.title,
        detail: item.detail,
        sourceType: item.kind,
        metadata: {
          coachTitle,
          attachmentCount: assets.length,
        },
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setFeedback(data.message || 'Failed to save knowledge');
      return;
    }

    setKnowledgeItems((current) => [data, ...current]);
  }

  const coachDocuments = useMemo(
    () => [...savedNotes, ...nativeFiles].sort((left, right) => String(right.updatedAt ?? right.createdAt ?? '').localeCompare(String(left.updatedAt ?? left.createdAt ?? ''))),
    [nativeFiles, savedNotes]
  );
  const selectedDocument = coachDocuments.find((asset) => asset.id === selectedDocumentId) ?? coachDocuments[0] ?? null;
  const selectedDocumentText = selectedDocument?.processedText || selectedDocument?.originalText || coachTranscript;
  const selectedActionItems = Array.isArray(selectedDocument?.metadata?.actionItems)
    ? selectedDocument!.metadata.actionItems.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  const groupedSavedNotes = useMemo(() => {
    const groups = new Map<string, SavedNote[]>();
    for (const note of savedNotes) {
      const key = note.sectionName || 'Unsorted';
      const existing = groups.get(key) ?? [];
      existing.push(note);
      groups.set(key, existing);
    }

    return Array.from(groups.entries()).map(([sectionName, notes]) => ({
      sectionName,
      notes,
    }));
  }, [savedNotes]);

  const recentFlashcardSets = studyLibrary.flashcardSets.slice(0, 4);
  const recentQuizzes = studyLibrary.quizzes.slice(0, 4);
  const noteSections = useMemo(
    () => Array.from(new Set(coachDocuments.map((note) => note.sectionName || 'Unsorted'))).sort((left, right) => left.localeCompare(right)),
    [coachDocuments]
  );
  const filteredSavedNotes = useMemo(() => {
    const normalizedSearch = historySearch.trim().toLowerCase();
    const now = Date.now();

    return coachDocuments.filter((note) => {
      if (historySectionFilter !== 'all' && note.sectionName !== historySectionFilter) {
        return false;
      }

      if (historyDateFilter !== 'all') {
        const createdAt = new Date(note.createdAt).getTime();
        if (Number.isFinite(createdAt)) {
          const maxAge = historyDateFilter === '7d' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
          if (now - createdAt > maxAge) {
            return false;
          }
        }
      }

      if (!normalizedSearch) {
        return true;
      }

      const searchSurface = [
        note.title,
        note.sectionName,
        note.metadata.summary,
        note.processedText,
        note.originalText,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchSurface.includes(normalizedSearch);
    });
  }, [coachDocuments, historyDateFilter, historySearch, historySectionFilter]);
  const activePersonality = coachPersonalities.find((personality) => personality.key === activeAgentType) ?? coachPersonalities[0];

  function buildActionItemKey(assetId: string, actionItem: string) {
    return `${assetId}:${actionItem}`;
  }

  async function addActionItemToTasks(assetId: string, actionItem: string) {
    const actionKey = buildActionItemKey(assetId, actionItem);
    if (scheduledActionItems.includes(actionKey) || schedulingActionItemKey === actionKey) {
      return;
    }
    const schedulePreset = actionItemSchedules[actionKey] ?? 'today_evening';
    setSchedulingActionItemKey(actionKey);
    setNoteActionStatus({
      tone: 'neutral',
      message: 'Adding that Backpack action item to your task list...',
    });

    try {
      const response = await apiFetch(`/api/coach/assets/${assetId}/action-items/reminder`, {
        method: 'POST',
        body: JSON.stringify({
          actionItem,
          schedulePreset,
        }),
      });
      const data = await readApiPayload(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'Failed to add this action item to your task list'));
      }

      setScheduledActionItems((current) => (current.includes(actionKey) ? current : [...current, actionKey]));
      setNoteActionStatus({
        tone: 'neutral',
        message: data.message || 'Added to your task list.',
      });
    } catch (error: any) {
      setNoteActionStatus({
        tone: 'warning',
        message: error.message || 'Failed to add this action item to your task list',
      });
    } finally {
      setSchedulingActionItemKey(null);
    }
  }

  async function generateStudyAsset(kind: 'flashcards' | 'quiz') {
    if (generatingAsset) {
      return;
    }

    if (!selectedDocumentText?.trim()) {
      setNoteActionStatus({
        tone: 'warning',
        message: 'Open a processed note first so Backpack has something usable to turn into study assets.',
      });
      return;
    }

    if (selectedDocumentText.trim().length < 24) {
      setNoteActionStatus({
        tone: 'warning',
        message:
          kind === 'flashcards'
            ? 'This note is too short to turn into useful flashcards yet. Add more source text first.'
            : 'This note is too short to turn into a useful quiz yet. Add more source text first.',
      });
      return;
    }

    setGeneratingAsset(kind);
    setFeedback('');
    setGenerationStatus({
      tone: 'neutral',
      title: kind === 'flashcards' ? 'Creating flashcards from this note' : 'Creating a quiz from this note',
      detail: 'OpenClaw is turning this processed note into a study asset using your current study model.',
    });
    setNoteActionStatus({
      tone: 'neutral',
      message: kind === 'flashcards' ? 'Creating flashcards from this note...' : 'Creating a quiz from this note...',
    });

    try {
      const response = await apiFetch(kind === 'flashcards' ? '/api/study/flashcards' : '/api/study/quiz', {
        method: 'POST',
        body: JSON.stringify({
          title: kind === 'flashcards' ? selectedDocument?.title ?? coachTitle : `${selectedDocument?.title ?? coachTitle} Quiz`,
          text: selectedDocumentText,
          sourceAssetId: selectedDocument?.source === 'backpack' ? selectedDocument?.id : undefined,
          sourceFileId: selectedDocument?.source === 'native-file' ? selectedDocument?.id : undefined,
          sourceKind: selectedDocument?.source === 'native-file' ? 'native-file' : 'asset',
          audienceLevel: 'Use onboarding profile',
          ...(kind === 'quiz' ? { questionCount: 6 } : {}),
        }),
      });
      const data = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, `Failed to generate ${kind}`));
      }

      await loadStudyLibrary();
      setGenerationStatus({
        tone: 'success',
        title: kind === 'flashcards' ? 'Flashcards created from Backpack' : 'Quiz created from Backpack',
        detail:
          kind === 'flashcards'
            ? 'Your processed note is now a flashcard set in Study Library.'
            : 'Your processed note is now a quiz in Study Library.',
        kind,
        providerLabel: data.generation?.providerLabel ?? null,
        modelKey: data.generation?.modelKey ?? null,
        countLabel:
          kind === 'flashcards'
            ? `${data.generation?.itemCount ?? data.cards?.length ?? 0} cards`
            : `${data.generation?.itemCount ?? data.questions?.length ?? 0} questions`,
        href:
          kind === 'flashcards' && data.flashcardSetId
            ? `/study?set=${encodeURIComponent(data.flashcardSetId)}`
            : kind === 'quiz' && data.quizId
              ? `/study?quiz=${encodeURIComponent(data.quizId)}`
              : '/study',
        ctaLabel: kind === 'flashcards' ? 'Open flashcards' : 'Open quiz',
      });
      setNoteActionStatus({
        tone: 'neutral',
        message:
          kind === 'flashcards'
            ? `Created ${data.cards?.length ?? 0} flashcards from ${selectedDocument?.title ?? 'this note'}.`
            : `Created ${data.questions?.length ?? 0} quiz questions from ${selectedDocument?.title ?? 'this note'}.`,
      });
    } catch (error: any) {
      setGenerationStatus({
        tone: 'warning',
        title: kind === 'flashcards' ? 'Flashcards were not created' : 'Quiz was not created',
        detail: error.message || `Failed to generate ${kind}`,
      });
      setNoteActionStatus({
        tone: 'warning',
        message: error.message || `Failed to generate ${kind}`,
      });
    } finally {
      setGeneratingAsset(null);
    }
  }

  if (!hasSession) {
    return (
      <section className="hero-card">
        <p className="insight-chip">Backpack</p>
        <h1 className="hero-title">Sign in to use Backpack with your real study context.</h1>
        <p className="hero-description">Backpack is the note intake surface for text, files, photos, and audio.</p>
        <div className="actions">
          <Link href="/login" className="primary-link-button">Log in</Link>
          <Link href="/signup" className="ghost-button">Create account</Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="backpack-shell">
        <header className="backpack-header">
          <div>
            <p className="backpack-header__eyebrow">{isIntroFlow ? 'First-time Backpack' : 'Backpack'}</p>
            <h1 className="backpack-header__title">
              {isIntroFlow ? 'Drop in one note and let Backpack do the rest.' : 'Turn class notes into something you can study right away.'}
            </h1>
            <p className="backpack-header__description">
              Start with one note, transcript, or PDF. Backpack cleans it up, pulls out next steps, saves useful class details, and turns strong notes into flashcards or quizzes.
            </p>
            <div className="actions" style={{ marginTop: '1rem' }}>
              <a href="#backpack-composer">Add notes</a>
              <Link href="/chat" className="ghost-button">Study chat</Link>
              <a href="#backpack-history" className="ghost-button">Open history</a>
            </div>
          </div>
          <div className="backpack-header__meta">
            <div className="backpack-header__meta-card">
              <span>Notes saved</span>
              <strong>{savedNotes.length}</strong>
            </div>
            <div className="backpack-header__meta-card">
              <span>Study sets</span>
              <strong>{studyLibrary.flashcardSets.length + studyLibrary.quizzes.length}</strong>
            </div>
          </div>
        </header>

        <section className="backpack-workflow-strip backpack-quick-start" aria-label="Backpack quick start">
          <article className="backpack-workflow-step">
            <p>Step 1</p>
            <strong>Add notes or a transcript</strong>
          </article>
          <article className="backpack-workflow-step">
            <p>Step 2</p>
            <strong>Review the summary and next steps</strong>
          </article>
          <article className="backpack-workflow-step">
            <p>Step 3</p>
            <strong>Make flashcards, a quiz, or tasks</strong>
          </article>
        </section>

        {feedback ? <StatusBanner tone="warning">{feedback}</StatusBanner> : null}
        {generationStatus ? <GenerationStatusCard status={generationStatus} /> : null}

        <section className="backpack-workspace-grid">
          <aside className="backpack-intake-panel" id="backpack-composer">
            <div className="backpack-panel-head">
              <div>
                <p className="eyebrow">Start here</p>
                <h2 className="section-title">Add one note to Backpack</h2>
                <p className="muted-copy" style={{ margin: '0.4rem 0 0' }}>
                  Only the title and one source are required. Everything else is optional.
                </p>
              </div>
              <span className="settings-badge">{assets.length ? `${assets.length} item${assets.length === 1 ? '' : 's'} attached` : 'Ready'}</span>
            </div>

            <div className="backpack-intake-panel__body">
              <div className="form-field">
                <label htmlFor="coach-title">Note title</label>
                <input id="coach-title" value={coachTitle} onChange={(event) => setCoachTitle(event.target.value)} placeholder="Example: Biology lecture notes" />
              </div>

              <div className="backpack-intake-panel__upload">
                <div>
                  <p className="eyebrow">Upload a file</p>
                  <p className="muted-copy" style={{ margin: '6px 0 0' }}>
                    Add a PDF, text file, transcript, or cleaned note. Backpack uses any text it can find.
                  </p>
                </div>
                <div className="upload-zone">
                  <input type="file" multiple onChange={handleFileInput} />
                </div>
              </div>

              {assets.length ? (
                <div className="stack-list backpack-asset-list">
                  {assets.map((asset) => (
                    <article key={asset.id} className="stack-item">
                      <div>
                        <strong>{asset.name}</strong>
                        <p className="muted-copy" style={{ margin: '4px 0 0' }}>{asset.type}</p>
                      </div>
                      <span className="settings-badge">{asset.extractedText ? 'text ready' : 'needs transcript'}</span>
                    </article>
                  ))}
                </div>
              ) : null}

              <button
                type="button"
                className="ghost-button backpack-inline-toggle"
                onClick={() => setShowPasteText((current) => !current)}
              >
                {showPasteText ? 'Hide pasted text' : 'Paste text instead'}
              </button>

              {showPasteText ? (
                <div className="form-field">
                  <label htmlFor="coach-text">Pasted text</label>
                  <textarea
                    id="coach-text"
                    value={coachText}
                    onChange={(event) => setCoachText(event.target.value)}
                    rows={10}
                    placeholder="Paste OCR, a transcript, or cleaned class notes here."
                  />
                </div>
              ) : (
                <p className="muted-copy">Need to paste OCR or a transcript? Open “Paste text instead.”</p>
              )}

              <div className="actions backpack-primary-actions">
                <button type="button" onClick={processCoachNotes} disabled={processing}>
                  {processing ? 'Saving and cleaning up...' : 'Save and clean up notes'}
                </button>
              </div>

              {!assets.length && !coachText.trim() ? (
                <StatusBanner tone="neutral">
                  Start with whatever you have. Backpack works best with readable text, but you can still upload first and paste cleaned text later.
                </StatusBanner>
              ) : null}

              {(coachSummary || knowledgeDrafts.length) ? (
                <div className="backpack-intake-results">
                  {coachSummary ? (
                    <div className="summary-card">
                      <p className="eyebrow">What Backpack found</p>
                      <p className="muted-copy">{coachSummary}</p>
                      {actionItems.length ? (
                        <>
                          <p className="eyebrow">Suggested next steps</p>
                          <div className="backpack-action-list">
                            {actionItems.map((item) => (
                              <div key={item} className="backpack-action-card">
                                <div>
                                  <strong>{item}</strong>
                                  <p className="muted-copy" style={{ margin: '6px 0 0' }}>
                                    Add this to your task list so it shows up on your dashboard and reminders board.
                                  </p>
                                </div>
                                <div className="backpack-action-card__controls">
                                  <select
                                    value={actionItemSchedules[buildActionItemKey(selectedDocumentId ?? 'draft', item)] ?? 'today_evening'}
                                    onChange={(event) =>
                                      setActionItemSchedules((current) => ({
                                        ...current,
                                        [buildActionItemKey(selectedDocumentId ?? 'draft', item)]: event.target.value as ActionItemSchedulePreset,
                                      }))
                                    }
                                  >
                                    {actionItemScheduleOptions.map((option) => (
                                      <option key={option.key} value={option.key}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    className="chat-mini-button"
                                    disabled={!selectedDocumentId || schedulingActionItemKey === buildActionItemKey(selectedDocumentId ?? 'draft', item)}
                                    onClick={() => selectedDocumentId ? void addActionItemToTasks(selectedDocumentId, item) : null}
                                  >
                                    {schedulingActionItemKey === buildActionItemKey(selectedDocumentId ?? 'draft', item) ? 'Adding...' : 'Add to task list'}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}

                  {knowledgeDrafts.length ? (
                    <div className="summary-card">
                      <p className="eyebrow">Save useful class details</p>
                      <div className="stack-list">
                        {knowledgeDrafts.map((item) => (
                          <article key={`${item.title}-${item.detail}`} className="stack-item">
                            <div>
                              <strong>{item.title}</strong>
                              <p className="muted-copy" style={{ margin: '4px 0 0' }}>{item.detail}</p>
                            </div>
                            <button type="button" className="chat-mini-button" onClick={() => void saveKnowledgeItem(item)}>
                              Save
                            </button>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </aside>

          <div className="backpack-side-stack">
            <section className="backpack-overview-panel">
              <div className="backpack-panel-head">
                <div>
                  <p className="eyebrow">Next move</p>
                  <h3 style={{ margin: 0 }}>{selectedDocument ? 'Use this note now' : 'Pick what you want Backpack to help with'}</h3>
                </div>
              </div>
              {selectedDocument ? (
                <div className="summary-card backpack-focus-card">
                  <p className="eyebrow">Selected note</p>
                  <strong>{selectedDocument.title}</strong>
                  <p className="muted-copy" style={{ margin: '0.5rem 0 0' }}>
                    {selectedDocument.sectionName} · {formatSavedDate(selectedDocument.createdAt)}
                  </p>
                  <p className="muted-copy" style={{ marginTop: '0.75rem' }}>
                    {buildNotePreview(selectedDocument) || 'This note is ready. Open it below to review the full text, tasks, and study actions.'}
                  </p>
                  <div className="actions" style={{ marginTop: '1rem' }}>
                    <button type="button" onClick={() => void generateStudyAsset('flashcards')} disabled={generatingAsset !== null}>
                      {generatingAsset === 'flashcards' ? 'Creating flashcards...' : 'Make flashcards'}
                    </button>
                    <button type="button" onClick={() => void generateStudyAsset('quiz')} disabled={generatingAsset !== null}>
                      {generatingAsset === 'quiz' ? 'Creating quiz...' : 'Make quiz'}
                    </button>
                    <Link href="/chat" className="ghost-button">Open study chat</Link>
                  </div>
                  {noteActionStatus ? <StatusBanner tone={noteActionStatus.tone}>{noteActionStatus.message}</StatusBanner> : null}
                </div>
              ) : (
                <div className="backpack-empty-state">
                  <strong>No note selected yet</strong>
                  <p>Process your first note, then Backpack will help you turn it into tasks, flashcards, or a quiz.</p>
                  <a href="#backpack-composer" className="primary-link-button">Add a note</a>
                </div>
              )}
            </section>

            <section className="secondary-card">
              <div className="backpack-panel-head">
                <div>
                  <p className="eyebrow">Coach style</p>
                  <h3 style={{ margin: 0 }}>Choose the vibe that fits your mood</h3>
                </div>
                <Link href="/onboarding" className="ghost-button">Change</Link>
              </div>
              <div className="backpack-personality-grid">
                {coachPersonalities.map((personality) => (
                  <article
                    key={personality.key}
                    className={`backpack-personality-card${activePersonality.key === personality.key ? ' is-active' : ''}`}
                  >
                    <div className="backpack-personality-card__badge">
                      <span>{personality.emoji}</span>
                      <span>{personality.tagline}</span>
                    </div>
                    <strong>{personality.name}</strong>
                    <p className="muted-copy" style={{ margin: '0.6rem 0 0' }}>{personality.description}</p>
                    {activePersonality.key === personality.key ? <span className="settings-badge">Current</span> : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="secondary-card">
              <div className="backpack-panel-head">
                <div>
                  <p className="eyebrow">More from Backpack</p>
                  <h3 style={{ margin: 0 }}>Hide the extra stuff until you need it</h3>
                </div>
              </div>
              <div className="stack-list">
                <article className="stack-item">
                  <div>
                    <strong>Saved class details</strong>
                    <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                      Keep grading rules, exam dates, and class preferences handy.
                    </p>
                  </div>
                  <button type="button" className="chat-mini-button" onClick={() => setShowSavedKnowledge((current) => !current)}>
                    {showSavedKnowledge ? 'Hide' : 'Show'}
                  </button>
                </article>
                {showSavedKnowledge ? (
                  <div className="summary-card">
                    <div className="stack-list">
                      {knowledgeItems.slice(0, 4).map((item) => (
                        <article key={item.id} className="stack-item">
                          <div>
                            <strong>{item.title}</strong>
                            <p className="muted-copy" style={{ margin: '4px 0 0' }}>{item.detail}</p>
                          </div>
                        </article>
                      ))}
                      {!knowledgeItems.length ? (
                        <p className="muted-copy">Save one useful class detail after your next note so Backpack can reuse it later.</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <article className="stack-item">
                  <div>
                    <strong>Recent study sets</strong>
                    <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                      Jump back into the flashcards and quizzes Backpack already made for you.
                    </p>
                  </div>
                  <button type="button" className="chat-mini-button" onClick={() => setShowStudyOutputs((current) => !current)}>
                    {showStudyOutputs ? 'Hide' : 'Show'}
                  </button>
                </article>
                {showStudyOutputs ? (
                  <div className="backpack-study-library">
                    <div className="summary-card">
                      <p className="eyebrow">Recent flashcards</p>
                      <div className="stack-list">
                        {recentFlashcardSets.length ? recentFlashcardSets.map((set) => (
                          <article key={set.id} className="stack-item">
                            <div>
                              <strong>{set.title}</strong>
                              <p className="muted-copy" style={{ margin: '4px 0 0' }}>{set.cards.length} cards</p>
                            </div>
                          </article>
                        )) : <p className="muted-copy">No flashcards yet. Make one from a saved note when you are ready.</p>}
                      </div>
                    </div>
                    <div className="summary-card">
                      <p className="eyebrow">Recent quizzes</p>
                      <div className="stack-list">
                        {recentQuizzes.length ? recentQuizzes.map((quiz) => (
                          <article key={quiz.id} className="stack-item">
                            <div>
                              <strong>{quiz.title}</strong>
                              <p className="muted-copy" style={{ margin: '4px 0 0' }}>{quiz.questions.length} questions</p>
                            </div>
                          </article>
                        )) : <p className="muted-copy">No quizzes yet. Make one from a saved note when you are ready.</p>}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </section>

        <section className="backpack-library-grid" id="backpack-history">
          <section className="secondary-card">
            <div className="backpack-panel-head">
              <div>
                <p className="eyebrow">Backpack history</p>
                <h2 className="section-title">Search your saved notes</h2>
                <p className="muted-copy" style={{ margin: '6px 0 0' }}>
                  Reopen any Backpack note or StudyClaw Drive file, then pick one to turn into a task, flashcards, or a quiz.
                </p>
              </div>
            </div>

            {savedNotes.length ? (
              <div className="backpack-note-workspace">
                <div className="backpack-history-toolbar">
                  <div className="form-field">
                    <label htmlFor="backpack-history-search">Search notes</label>
                    <input
                      id="backpack-history-search"
                      value={historySearch}
                      onChange={(event) => setHistorySearch(event.target.value)}
                      placeholder="Search by title, class, or note text"
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="backpack-section-filter">Class</label>
                    <select
                      id="backpack-section-filter"
                      value={historySectionFilter}
                      onChange={(event) => setHistorySectionFilter(event.target.value)}
                    >
                      <option value="all">All classes</option>
                      {noteSections.map((sectionName) => (
                        <option key={sectionName} value={sectionName}>
                          {sectionName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="backpack-date-filter">Saved</label>
                    <select
                      id="backpack-date-filter"
                      value={historyDateFilter}
                      onChange={(event) => setHistoryDateFilter(event.target.value as 'all' | '7d' | '30d')}
                    >
                      <option value="all">Any time</option>
                      <option value="7d">Last 7 days</option>
                      <option value="30d">Last 30 days</option>
                    </select>
                  </div>
                </div>

                <div className="backpack-history-list">
                  {filteredSavedNotes.length ? filteredSavedNotes.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => setSelectedDocumentId(asset.id)}
                      className={asset.id === selectedDocument?.id ? 'backpack-history-card is-active' : 'backpack-history-card'}
                    >
                      <div className="backpack-history-card__meta">
                        <span className="settings-badge">{asset.source === 'native-file' ? `Drive · ${asset.fileType ?? 'file'}` : asset.sectionName}</span>
                        <span className="muted-copy">{formatSavedDate(asset.createdAt)}</span>
                      </div>
                      <strong>{asset.title}</strong>
                      <p className="muted-copy" style={{ margin: '0.5rem 0 0' }}>
                        {buildNotePreview(asset) || 'Saved note ready to open.'}
                      </p>
                    </button>
                  )) : (
                    <div className="backpack-empty-state">
                      <strong>No notes match that filter yet</strong>
                      <p>Try a broader search or switch the date range.</p>
                    </div>
                  )}
                </div>

                {selectedDocument ? (
                  <div className="summary-card backpack-note-detail">
                    <p className="eyebrow">Open note</p>
                      <strong>{selectedDocument.title}</strong>
                    <p className="muted-copy" style={{ margin: '6px 0 0' }}>
                      {selectedDocument.source === 'native-file'
                        ? `StudyClaw Drive · Saved ${formatSavedDate(selectedDocument.createdAt)}`
                        : `${selectedDocument.sectionName} · Saved ${formatSavedDate(selectedDocument.createdAt)}`}
                    </p>
                    <div className="actions">
                      <button type="button" onClick={() => void generateStudyAsset('flashcards')} disabled={generatingAsset !== null}>
                        {generatingAsset === 'flashcards' ? 'Creating flashcards...' : 'Make flashcards'}
                      </button>
                      <button type="button" onClick={() => void generateStudyAsset('quiz')} disabled={generatingAsset !== null}>
                        {generatingAsset === 'quiz' ? 'Creating quiz...' : 'Make quiz'}
                      </button>
                      <Link href="/study" className="ghost-button">Open study library</Link>
                    </div>
                    {noteActionStatus ? <StatusBanner tone={noteActionStatus.tone}>{noteActionStatus.message}</StatusBanner> : null}
                    {selectedDocument.source !== 'native-file' && selectedActionItems.length ? (
                      <div className="backpack-note-actions">
                        <p className="eyebrow">Task handoff</p>
                        <div className="backpack-action-list">
                          {selectedActionItems.map((item) => {
                            const actionKey = buildActionItemKey(selectedDocument.id, item);
                            const isScheduled = scheduledActionItems.includes(actionKey);
                            const isSubmitting = schedulingActionItemKey === actionKey;
                            return (
                              <div key={actionKey} className="backpack-action-card">
                                <div>
                                  <strong>{item}</strong>
                                  <p className="muted-copy" style={{ margin: '6px 0 0' }}>
                                    Move this note takeaway onto your task list with a realistic study time.
                                  </p>
                                </div>
                                <div className="backpack-action-card__controls">
                                  <select
                                    value={actionItemSchedules[actionKey] ?? 'today_evening'}
                                    onChange={(event) =>
                                      setActionItemSchedules((current) => ({
                                        ...current,
                                        [actionKey]: event.target.value as ActionItemSchedulePreset,
                                      }))
                                    }
                                  >
                                    {actionItemScheduleOptions.map((option) => (
                                      <option key={option.key} value={option.key}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    className="chat-mini-button"
                                    disabled={isScheduled || isSubmitting}
                                    onClick={() => void addActionItemToTasks(selectedDocument.id, item)}
                                  >
                                    {isSubmitting ? 'Adding...' : isScheduled ? 'Added' : 'Add to task list'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    {selectedDocument.source !== 'native-file' && selectedDocument.metadata.summary ? (
                      <p className="muted-copy" style={{ marginTop: '1rem' }}>
                        {selectedDocument.metadata.summary}
                      </p>
                    ) : null}
                    <p
                      className={`muted-copy backpack-note-preview${showFullSelectedNote ? ' expanded' : ''}`}
                      style={{ whiteSpace: 'pre-wrap' }}
                    >
                      {selectedDocumentText || 'This document does not have extracted text yet.'}
                    </p>
                    {selectedDocumentText?.trim() ? (
                      <button
                        type="button"
                        className="ghost-button backpack-note-toggle"
                        onClick={() => setShowFullSelectedNote((current) => !current)}
                      >
                        {showFullSelectedNote ? 'Show less' : 'Show full note'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="backpack-empty-state">
                <strong>Your Backpack history is empty for now</strong>
                <p>Save your first note above and it will appear here with a preview, class tag, and study actions.</p>
                <a href="#backpack-composer" className="primary-link-button">Add a note</a>
              </div>
            )}
          </section>
        </section>

        <nav className="backpack-bottom-bar" aria-label="Backpack quick actions">
          <a href="#backpack-composer" className="backpack-bottom-bar__primary">Add notes</a>
          <a href="#backpack-history" className="ghost-button">History</a>
          <Link href="/chat" className="ghost-button">Chat</Link>
        </nav>
      </section>
    </>
  );
}
