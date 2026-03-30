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

function createAssetId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
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
  const [studyLibrary, setStudyLibrary] = useState<StudyLibrary>({ flashcardSets: [], quizzes: [] });
  const [generatingAsset, setGeneratingAsset] = useState<'flashcards' | 'quiz' | null>(null);
  const [noteActionStatus, setNoteActionStatus] = useState<{ tone: 'neutral' | 'warning'; message: string } | null>(null);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus | null>(null);
  const [showFullSelectedNote, setShowFullSelectedNote] = useState(false);
  const [actionItemSchedules, setActionItemSchedules] = useState<Record<string, ActionItemSchedulePreset>>({});
  const [schedulingActionItemKey, setSchedulingActionItemKey] = useState<string | null>(null);
  const [scheduledActionItems, setScheduledActionItems] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    setIsIntroFlow(params.get('intro') === '1' || params.get('bootstrap') === '1');
    setQueryPreferredAssetId(params.get('assetId'));
  }, []);

  useEffect(() => {
    setHasSession(!!readStoredSession()?.user?.id);
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

    setSavedNotes(data);
    const nextSelectedId =
      preferredDocumentId ??
      queryPreferredAssetId ??
      selectedDocumentId ??
      data[0]?.id ??
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

  const selectedDocument = savedNotes.find((asset) => asset.id === selectedDocumentId) ?? savedNotes[0] ?? null;
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
          sourceAssetId: selectedDocument?.id,
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
            <p className="backpack-header__eyebrow">{isIntroFlow ? 'First-time Backpack' : 'Backpack workspace'}</p>
            <h1 className="backpack-header__title">
              {isIntroFlow ? 'Set up your study workspace.' : 'Add material, organize notes, and build study tools from one place.'}
            </h1>
            <p className="backpack-header__description">
              Backpack is your intake and study-prep workspace. Drop in class material, clean it up, save the useful parts, and turn the best notes into flashcards and quizzes.
            </p>
          </div>
          <div className="backpack-header__meta">
            <div className="backpack-header__meta-card">
              <span>Saved notes</span>
              <strong>{savedNotes.length}</strong>
            </div>
            <div className="backpack-header__meta-card">
              <span>Study sets</span>
              <strong>{studyLibrary.flashcardSets.length + studyLibrary.quizzes.length}</strong>
            </div>
          </div>
        </header>

        <section className="backpack-workflow-strip" aria-label="Backpack workflow">
          <article className="backpack-workflow-step">
            <p>Add material</p>
            <strong>Upload notes or paste extracted text</strong>
          </article>
          <article className="backpack-workflow-step">
            <p>Organize notes</p>
            <strong>Keep processed notes grouped by section</strong>
          </article>
          <article className="backpack-workflow-step">
            <p>Generate study tools</p>
            <strong>Create flashcards and quizzes from saved notes</strong>
          </article>
        </section>

        {feedback ? <StatusBanner tone="warning">{feedback}</StatusBanner> : null}
        {generationStatus ? <GenerationStatusCard status={generationStatus} /> : null}
        {!assets.length ? (
          <StatusBanner tone="neutral">
            Text files and PDFs can be processed directly here. Scanned images, image-only PDFs, and audio still need pasted OCR or transcript text before Backpack can summarize them reliably.
          </StatusBanner>
        ) : null}

        <section className="backpack-workspace-grid">
          <aside className="backpack-intake-panel">
            <div className="backpack-panel-head">
              <div>
                <p className="eyebrow">Main workspace</p>
                <h2 className="section-title">Add material to Backpack</h2>
              </div>
              <span className="settings-badge">{assets.length ? `${assets.length} item${assets.length === 1 ? '' : 's'} attached` : 'Ready'}</span>
            </div>

            <div className="backpack-intake-panel__body">
              <div className="form-field">
                <label htmlFor="coach-title">Note title</label>
                <input id="coach-title" value={coachTitle} onChange={(event) => setCoachTitle(event.target.value)} />
              </div>

              <div className="backpack-intake-panel__upload">
                <div>
                  <p className="eyebrow">Upload notes</p>
                  <p className="muted-copy" style={{ margin: '6px 0 0' }}>
                    Add text files, PDFs, transcripts, or cleaned notes. Backpack will use whatever text is available.
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

              <div className="form-field">
                <label htmlFor="coach-text">Transcript or extracted text</label>
                <textarea
                  id="coach-text"
                  value={coachText}
                  onChange={(event) => setCoachText(event.target.value)}
                  rows={11}
                  placeholder="Paste OCR, transcript, or cleaned class notes here."
                />
              </div>

              <div className="actions backpack-primary-actions">
                <button type="button" onClick={processCoachNotes} disabled={processing}>
                  {processing ? 'Processing...' : 'Summarize Backpack'}
                </button>
              </div>

              {(coachSummary || knowledgeDrafts.length) ? (
                <div className="backpack-intake-results">
                  {coachSummary ? (
                    <div className="summary-card">
                      <p className="eyebrow">Processed summary</p>
                      <p className="muted-copy">{coachSummary}</p>
                      {actionItems.length ? (
                        <>
                          <p className="eyebrow">Action items</p>
                          <div className="backpack-action-list">
                            {actionItems.map((item) => (
                              <div key={item} className="backpack-action-card">
                                <div>
                                  <strong>{item}</strong>
                                  <p className="muted-copy" style={{ margin: '6px 0 0' }}>
                                    Turn this into a real study task so it shows up on your dashboard and reminders board.
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
                                    {schedulingActionItemKey === buildActionItemKey(selectedDocumentId ?? 'draft', item) ? 'Adding...' : 'Add to tasks'}
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
                      <p className="eyebrow">Save useful details</p>
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
                  <p className="eyebrow">Overview</p>
                  <h3 style={{ margin: 0 }}>Workspace totals</h3>
                </div>
              </div>
              <div className="backpack-stat-grid">
                <div className="backpack-stat-card">
                  <strong>{savedNotes.length}</strong>
                  <span>saved notes</span>
                </div>
                <div className="backpack-stat-card">
                  <strong>{groupedSavedNotes.length}</strong>
                  <span>sections</span>
                </div>
                <div className="backpack-stat-card">
                  <strong>{studyLibrary.flashcardSets.length}</strong>
                  <span>flashcard sets</span>
                </div>
                <div className="backpack-stat-card">
                  <strong>{studyLibrary.quizzes.length}</strong>
                  <span>quizzes</span>
                </div>
              </div>
            </section>

            <section className="backpack-helper-row">
              <article className="backpack-helper-card">
                <p className="eyebrow">Capture</p>
                <strong>Bring in raw material fast</strong>
                <p className="muted-copy">Use Backpack to collect class notes, transcripts, and cleaned text in one workspace.</p>
              </article>
              <article className="backpack-helper-card">
                <p className="eyebrow">Organize</p>
                <strong>Keep processed notes grouped</strong>
                <p className="muted-copy">Saved notes stay grouped by section so the right lecture or worksheet is easy to reopen.</p>
              </article>
              <article className="backpack-helper-card">
                <p className="eyebrow">Study</p>
                <strong>Turn notes into active recall</strong>
                <p className="muted-copy">Generate flashcards and quizzes directly from the notes that are already cleaned and useful.</p>
              </article>
            </section>

            <section className="secondary-card">
              <div className="backpack-panel-head">
                <div>
                  <p className="eyebrow">Saved knowledge</p>
                  <h3 style={{ margin: 0 }}>Reusable details</h3>
                </div>
              </div>
              <div className="stack-list">
                {knowledgeItems.slice(0, 4).map((item) => (
                  <article key={item.id} className="stack-item">
                    <div>
                      <strong>{item.title}</strong>
                      <p className="muted-copy" style={{ margin: '4px 0 0' }}>{item.detail}</p>
                    </div>
                  </article>
                ))}
                {!knowledgeItems.length ? <p className="muted-copy">Save useful details here so class logistics and study preferences stay reusable.</p> : null}
              </div>
            </section>
          </div>
        </section>

        <section className="backpack-library-grid">
          <section className="secondary-card">
            <div className="backpack-panel-head">
              <div>
                <p className="eyebrow">Saved notes</p>
                <h2 className="section-title">Organized note library</h2>
                <p className="muted-copy" style={{ margin: '6px 0 0' }}>
                  Reopen processed notes by section, then generate study tools from the one you want to review next.
                </p>
              </div>
            </div>

            {savedNotes.length ? (
              <div className="backpack-note-workspace">
                <div className="backpack-note-groups">
                  {groupedSavedNotes.map((group) => (
                    <div key={group.sectionName} className="backpack-note-group">
                      <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>{group.sectionName}</p>
                      <div className="backpack-note-chip-grid">
                        {group.notes.map((asset) => (
                          <button
                            key={asset.id}
                            type="button"
                            onClick={() => setSelectedDocumentId(asset.id)}
                            className={asset.id === selectedDocument?.id ? 'backpack-note-chip is-active' : 'backpack-note-chip'}
                          >
                            <strong>{asset.title}</strong>
                            <span>{asset.processedText ? 'Processed note' : 'Saved note'}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {selectedDocument ? (
                  <div className="summary-card backpack-note-detail">
                    <p className="eyebrow">Open note</p>
                    <strong>{selectedDocument.title}</strong>
                    <p className="muted-copy" style={{ margin: '6px 0 0' }}>
                      Section: {selectedDocument.sectionName}
                    </p>
                    <div className="actions">
                      <button type="button" onClick={() => void generateStudyAsset('flashcards')} disabled={generatingAsset !== null}>
                        {generatingAsset === 'flashcards' ? 'Creating flashcards...' : 'Create flashcards'}
                      </button>
                      <button type="button" onClick={() => void generateStudyAsset('quiz')} disabled={generatingAsset !== null}>
                        {generatingAsset === 'quiz' ? 'Creating quiz...' : 'Create quiz'}
                      </button>
                      <Link href="/study" className="ghost-button">Open study library</Link>
                    </div>
                    {noteActionStatus ? <StatusBanner tone={noteActionStatus.tone}>{noteActionStatus.message}</StatusBanner> : null}
                    {selectedActionItems.length ? (
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
                                    {isSubmitting ? 'Adding...' : isScheduled ? 'Added' : 'Add to tasks'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    {selectedDocument.metadata.summary ? (
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
                        {showFullSelectedNote ? 'Show less' : 'Show more'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="backpack-empty-state">
                <strong>No saved notes yet</strong>
                <p>Process your first note in the intake workspace to start building an organized study library.</p>
              </div>
            )}
          </section>

          <section className="secondary-card">
            <div className="backpack-panel-head">
              <div>
                <p className="eyebrow">Study library</p>
                <h3 style={{ margin: 0 }}>Recent outputs from Backpack</h3>
              </div>
              <Link href="/study" className="ghost-button">Open full library</Link>
            </div>

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
                  )) : <p className="muted-copy">No flashcard sets yet. Open a saved note and create one from here.</p>}
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
                  )) : <p className="muted-copy">No quizzes yet. Process a note and create one when you are ready.</p>}
                </div>
              </div>
            </div>
          </section>
        </section>
      </section>
    </>
  );
}
