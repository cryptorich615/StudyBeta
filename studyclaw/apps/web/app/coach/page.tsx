'use client';

import Link from 'next/link';
import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { extractDocumentText } from '../../lib/document-text';
import { readStoredSession } from '../../lib/session';
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

function createAssetId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export default function CoachPage() {
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
  const [showFullSelectedNote, setShowFullSelectedNote] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    setIsIntroFlow(params.get('intro') === '1' || params.get('bootstrap') === '1');
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
    setShowFullSelectedNote(false);
    setNoteActionStatus(null);
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
    const nextSelectedId = preferredDocumentId ?? selectedDocumentId ?? data[0]?.id ?? null;
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

  async function generateStudyAsset(kind: 'flashcards' | 'quiz') {
    if (!selectedDocumentText?.trim()) {
      setNoteActionStatus({
        tone: 'warning',
        message: 'Open a processed note first so Backpack has something usable to turn into study assets.',
      });
      return;
    }

    setGeneratingAsset(kind);
    setFeedback('');
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
      const raw = await response.text();
      let data: Record<string, any> = {};
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = { message: raw };
        }
      }
      if (!response.ok) {
        throw new Error(data.message || `Failed to generate ${kind}`);
      }

      await loadStudyLibrary();
      setNoteActionStatus({
        tone: 'neutral',
        message:
          kind === 'flashcards'
            ? `Created ${data.cards?.length ?? 0} flashcards from ${selectedDocument?.title ?? 'this note'}.`
            : `Created ${data.questions?.length ?? 0} quiz questions from ${selectedDocument?.title ?? 'this note'}.`,
      });
    } catch (error: any) {
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
      <section className="hero-card hero-card-featured">
        <div className="hero-copy">
          <p className="insight-chip">{isIntroFlow ? 'First-time Backpack' : 'Backpack workspace'}</p>
          <h1 className="hero-title">
            {isIntroFlow
              ? 'Meet your Backpack workflow.'
              : 'Input notes, organize saved material, and turn it into usable flashcards and quizzes.'}
          </h1>
          <p className="hero-description">
            Backpack is now a dedicated note workspace. Capture raw material, process it into organized notes, save reusable knowledge,
            and generate study outputs directly from the notes that matter.
          </p>
        </div>
      </section>

      {feedback ? <StatusBanner tone="warning">{feedback}</StatusBanner> : null}
      {!assets.length ? (
        <StatusBanner tone="neutral">
          Text files and PDFs can be processed directly here. Scanned images, image-only PDFs, and audio still need pasted OCR or transcript text before Backpack can summarize them reliably.
        </StatusBanner>
      ) : null}

      <section className="coach-grid">
        <aside className="coach-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Note intake</p>
              <h2 className="section-title">Backpack intake</h2>
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="coach-title">Capture title</label>
            <input id="coach-title" value={coachTitle} onChange={(event) => setCoachTitle(event.target.value)} />
          </div>
          <div className="upload-zone">
            <input type="file" multiple onChange={handleFileInput} />
          </div>
          <div className="stack-list">
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
          <div className="form-field">
            <label htmlFor="coach-text">Transcript or extracted text</label>
            <textarea
              id="coach-text"
              value={coachText}
              onChange={(event) => setCoachText(event.target.value)}
              rows={10}
              placeholder="Paste OCR, transcript, or cleaned class notes here."
            />
          </div>
          <div className="actions">
            <button type="button" onClick={processCoachNotes} disabled={processing}>
              {processing ? 'Processing...' : 'Summarize Backpack'}
            </button>
          </div>

          {coachSummary ? (
            <div className="summary-card">
              <p className="eyebrow">Summary</p>
              <p className="muted-copy">{coachSummary}</p>
              <p className="eyebrow">Action items</p>
              <div className="timeline">
                {actionItems.map((item) => (
                  <div key={item} className="timeline-item">
                    <p className="muted-copy" style={{ margin: 0 }}>{item}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {knowledgeDrafts.length ? (
            <div className="summary-card">
              <p className="eyebrow">Add to knowledge</p>
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
        </aside>

        <div className="chat-main">
          <section className="backpack-feature-grid">
            <article className="summary-card backpack-feature-card">
              <p className="eyebrow">Capture notes</p>
              <strong>Drop in class materials fast</strong>
              <p className="muted-copy">
                Add notes, PDFs, transcripts, and cleaned text so Backpack can organize the material into something usable.
              </p>
            </article>
            <article className="summary-card backpack-feature-card">
              <p className="eyebrow">Organize notes</p>
              <strong>Keep saved notes grouped by section</strong>
              <p className="muted-copy">
                Processed notes stay grouped into sections so students can reopen the right lecture, worksheet, or transcript quickly.
              </p>
            </article>
            <article className="summary-card backpack-feature-card">
              <p className="eyebrow">Study outputs</p>
              <strong>Generate flashcards and quizzes from saved notes</strong>
              <p className="muted-copy">
                Backpack now feeds directly into your study library so processed material turns into active recall tools, not another chat thread.
              </p>
            </article>
          </section>

          <section className="backpack-room">
            <div className="secondary-card">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Workspace overview</p>
                  <h3 style={{ margin: 0 }}>Backpack at a glance</h3>
                  <p className="muted-copy" style={{ margin: '6px 0 0' }}>
                    Capture raw material here, keep the cleaned notes organized, then push the best material into flashcards and quizzes.
                  </p>
                </div>
              </div>
              <div className="metric-grid">
                <div className="metric-tile">
                  <strong>{savedNotes.length}</strong>
                  <span>saved notes</span>
                </div>
                <div className="metric-tile">
                  <strong>{groupedSavedNotes.length}</strong>
                  <span>note sections</span>
                </div>
                <div className="metric-tile">
                  <strong>{studyLibrary.flashcardSets.length}</strong>
                  <span>flashcard sets</span>
                </div>
                <div className="metric-tile">
                  <strong>{studyLibrary.quizzes.length}</strong>
                  <span>quizzes</span>
                </div>
              </div>
            </div>

            <section className="secondary-card">
              <p className="eyebrow">Saved knowledge</p>
              <div className="stack-list">
                {knowledgeItems.slice(0, 4).map((item) => (
                  <article key={item.id} className="stack-item">
                    <div>
                      <strong>{item.title}</strong>
                      <p className="muted-copy" style={{ margin: '4px 0 0' }}>{item.detail}</p>
                    </div>
                  </article>
                ))}
                {!knowledgeItems.length ? <p className="muted-copy">Save knowledge to keep logistics and preferences reusable.</p> : null}
              </div>
            </section>

            <section className="secondary-card">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Study outputs</p>
                  <h3 style={{ margin: 0 }}>Created from Backpack</h3>
                </div>
                <Link href="/study" className="ghost-button">Open full library</Link>
              </div>
              <div className="backpack-output-grid">
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
                    )) : <p className="muted-copy">No flashcard sets yet. Open a note and generate one here.</p>}
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
                    )) : <p className="muted-copy">No quizzes yet. Process a note and generate one from Backpack.</p>}
                  </div>
                </div>
              </div>
            </section>
          </section>
        </div>
      </section>

      {savedNotes.length ? (
        <section className="secondary-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Notes</p>
              <h2 className="section-title">Saved by section</h2>
            </div>
          </div>

          {groupedSavedNotes.map((group) => (
            <div key={group.sectionName} style={{ marginBottom: '1rem' }}>
              <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>{group.sectionName}</p>
              <div className="thread-ribbon">
                {group.notes.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => setSelectedDocumentId(asset.id)}
                    className={asset.id === selectedDocument?.id ? 'chat-thread-card active' : 'chat-thread-card'}
                  >
                    <strong>{asset.title}</strong>
                    <span>{asset.processedText ? 'Processed note' : 'Saved note'}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {selectedDocument ? (
            <div className="summary-card">
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
        </section>
      ) : null}
    </>
  );
}
