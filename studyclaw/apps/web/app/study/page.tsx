'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch, getApiErrorMessage, readApiPayload } from '../../lib/api';
import { readStoredSession } from '../../lib/session';
import StatusBanner from '../components/status-banner';
import DocumentReaderWorkspace from '../components/document-reader-workspace';

type Flashcard = {
  id?: string;
  front: string;
  back: string;
};

type FlashcardSet = {
  id: string;
  title: string;
  created_at: string;
  cards: Flashcard[];
};

type QuizQuestion = {
  id?: string;
  question_text: string;
  explanation: string;
  choices?: string[];
  answer?: { correct?: string };
};

type Quiz = {
  id: string;
  title: string;
  mode: string;
  created_at: string;
  questions: QuizQuestion[];
};

type LibraryData = {
  flashcardSets: FlashcardSet[];
  quizzes: Quiz[];
};

type GoogleWorkspaceStatus = {
  connected?: boolean;
  needsReconnect?: boolean;
  googleEmail?: string | null;
  canReadDrive?: boolean;
  canUseDocs?: boolean;
  canUseSheets?: boolean;
  canUseSlides?: boolean;
  error?: string | null;
};

type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
};

function formatWorkspaceDate(value?: string) {
  if (!value) {
    return 'Updated recently';
  }

  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function StudyPage() {
  const searchParams = useSearchParams();
  const [title, setTitle] = useState('Biology Notes');
  const [notes, setNotes] = useState('Cells are the basic unit of life. Mitochondria produce ATP.');
  const [audienceLevel, setAudienceLevel] = useState('Use onboarding profile');
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [flashcardSetId, setFlashcardSetId] = useState('');
  const [quizId, setQuizId] = useState('');
  const [library, setLibrary] = useState<LibraryData>({ flashcardSets: [], quizzes: [] });
  const [filter, setFilter] = useState('');
  const [libraryType, setLibraryType] = useState<'all' | 'flashcards' | 'quizzes'>('all');
  const [status, setStatus] = useState('');
  const [loadingFlashcards, setLoadingFlashcards] = useState(false);
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [highlightedSetId, setHighlightedSetId] = useState<string | null>(null);
  const [highlightedQuizId, setHighlightedQuizId] = useState<string | null>(null);
  const [googleStatus, setGoogleStatus] = useState<GoogleWorkspaceStatus | null>(null);
  const [googleFiles, setGoogleFiles] = useState<{
    all: GoogleDriveFile[];
    docs: GoogleDriveFile[];
    sheets: GoogleDriveFile[];
    slides: GoogleDriveFile[];
  }>({
    all: [],
    docs: [],
    sheets: [],
    slides: [],
  });
  const [googleWorkspaceLoading, setGoogleWorkspaceLoading] = useState(false);
  const [googleWorkspaceError, setGoogleWorkspaceError] = useState('');

  useEffect(() => {
    setHasSession(!!readStoredSession()?.user?.id);
  }, []);

  useEffect(() => {
    if (!hasSession) return;
    void loadLibrary();
    void loadGoogleWorkspace();
  }, [hasSession]);

  useEffect(() => {
    const setId = searchParams.get('set');
    const quizIdParam = searchParams.get('quiz');

    setHighlightedSetId(setId);
    setHighlightedQuizId(quizIdParam);

    if (setId) {
      setLibraryType('flashcards');
      setStatus('Opened the flashcards created from chat research.');
      return;
    }

    if (quizIdParam) {
      setLibraryType('quizzes');
      setStatus('Opened the quiz created from chat research.');
    }
  }, [searchParams]);

  useEffect(() => {
    const targetId = highlightedSetId ?? highlightedQuizId;
    if (!targetId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(`study-library-item-${targetId}`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [highlightedQuizId, highlightedSetId, libraryType, library.flashcardSets.length, library.quizzes.length]);

  function getSiblingTextareaValues(element: HTMLElement) {
    const container = element.closest('.editable-card');
    const textareas = container ? Array.from(container.querySelectorAll('textarea')) : [];
    const [first, second] = textareas as HTMLTextAreaElement[];

    return {
      first: first?.value ?? '',
      second: second?.value ?? '',
    };
  }

  async function loadLibrary() {
    const response = await apiFetch('/api/study/library');
    const data = await response.json();

    if (!response.ok) {
      setStatus(data.message || 'Failed to load study library');
      return;
    }

    setLibrary(data);
  }

  async function loadGoogleWorkspace() {
    setGoogleWorkspaceLoading(true);
    setGoogleWorkspaceError('');

    try {
      const statusResponse = await apiFetch('/api/google');
      const statusPayload = await readApiPayload(statusResponse);

      if (!statusResponse.ok) {
        throw new Error(getApiErrorMessage(statusPayload, 'Failed to load Google workspace'));
      }

      setGoogleStatus(statusPayload as GoogleWorkspaceStatus);

      if (!(statusPayload?.connected && statusPayload?.canReadDrive)) {
        setGoogleFiles({ all: [], docs: [], sheets: [], slides: [] });
        return;
      }

      const [allResponse, docsResponse, sheetsResponse, slidesResponse] = await Promise.all([
        apiFetch('/api/google/drive?kind=all&pageSize=4'),
        apiFetch('/api/google/drive?kind=docs&pageSize=3'),
        apiFetch('/api/google/drive?kind=sheets&pageSize=3'),
        apiFetch('/api/google/drive?kind=slides&pageSize=3'),
      ]);

      const [allPayload, docsPayload, sheetsPayload, slidesPayload] = await Promise.all([
        readApiPayload(allResponse),
        readApiPayload(docsResponse),
        readApiPayload(sheetsResponse),
        readApiPayload(slidesResponse),
      ]);

      if (!allResponse.ok || !docsResponse.ok || !sheetsResponse.ok || !slidesResponse.ok) {
        throw new Error(
          getApiErrorMessage(
            allPayload?.message ? allPayload : docsPayload?.message ? docsPayload : sheetsPayload?.message ? sheetsPayload : slidesPayload,
            'Failed to load recent Google files'
          )
        );
      }

      setGoogleFiles({
        all: Array.isArray(allPayload) ? allPayload as GoogleDriveFile[] : [],
        docs: Array.isArray(docsPayload) ? docsPayload as GoogleDriveFile[] : [],
        sheets: Array.isArray(sheetsPayload) ? sheetsPayload as GoogleDriveFile[] : [],
        slides: Array.isArray(slidesPayload) ? slidesPayload as GoogleDriveFile[] : [],
      });
    } catch (error: any) {
      setGoogleWorkspaceError(error.message || 'Failed to load Google workspace');
    } finally {
      setGoogleWorkspaceLoading(false);
    }
  }

  async function generateFlashcards() {
    if (loadingFlashcards) {
      return;
    }

    if (!hasSession) {
      setStatus('Sign in and complete onboarding before generating study assets.');
      return;
    }

    if (!notes.trim() || notes.trim().length < 24) {
      setStatus('Paste a little more note text before generating flashcards.');
      return;
    }

    setLoadingFlashcards(true);
    setStatus('');

    try {
      const response = await apiFetch('/api/study/flashcards', {
        method: 'POST',
        body: JSON.stringify({ title, text: notes, audienceLevel }),
      });
      const data = await readApiPayload(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'Flashcard request failed'));
      }

      setFlashcards(data.cards || []);
      setFlashcardSetId(data.flashcardSetId || '');
      await loadLibrary();
    } catch (error: any) {
      setStatus(error.message || 'Failed to generate flashcards');
    } finally {
      setLoadingFlashcards(false);
    }
  }

  async function generateQuiz() {
    if (loadingQuiz) {
      return;
    }

    if (!hasSession) {
      setStatus('Sign in and complete onboarding before generating study assets.');
      return;
    }

    if (!notes.trim() || notes.trim().length < 24) {
      setStatus('Paste a little more note text before generating a quiz.');
      return;
    }

    setLoadingQuiz(true);
    setStatus('');

    try {
      const response = await apiFetch('/api/study/quiz', {
        method: 'POST',
        body: JSON.stringify({ title: `${title} Quiz`, text: notes, questionCount: 6, audienceLevel }),
      });
      const data = await readApiPayload(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'Quiz request failed'));
      }

      setQuizQuestions(data.questions || []);
      setQuizId(data.quizId || '');
      await loadLibrary();
    } catch (error: any) {
      setStatus(error.message || 'Failed to generate quiz');
    } finally {
      setLoadingQuiz(false);
    }
  }

  async function renameFlashcardSet(setId: string, nextTitle: string) {
    const response = await apiFetch(`/api/study/flashcards/${setId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: nextTitle }),
    });
    const data = await readApiPayload(response);
    if (!response.ok) {
      setStatus(getApiErrorMessage(data, 'Failed to update flashcard set'));
      return;
    }
    await loadLibrary();
  }

  async function saveFlashcard(setId: string, cardId: string | undefined, front: string, back: string) {
    if (!cardId) return;
    const response = await apiFetch(`/api/study/flashcards/${setId}/cards/${cardId}`, {
      method: 'PATCH',
      body: JSON.stringify({ front, back }),
    });
    const data = await readApiPayload(response);
    if (!response.ok) {
      setStatus(getApiErrorMessage(data, 'Failed to update flashcard'));
      return;
    }
    await loadLibrary();
  }

  async function renameQuiz(quizIdValue: string, nextTitle: string) {
    const response = await apiFetch(`/api/study/quizzes/${quizIdValue}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: nextTitle }),
    });
    const data = await readApiPayload(response);
    if (!response.ok) {
      setStatus(getApiErrorMessage(data, 'Failed to update quiz'));
      return;
    }
    await loadLibrary();
  }

  async function saveQuestion(quizIdValue: string, questionId: string | undefined, questionText: string, explanation: string) {
    if (!questionId) return;
    const response = await apiFetch(`/api/study/quizzes/${quizIdValue}/questions/${questionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ questionText, explanation }),
    });
    const data = await readApiPayload(response);
    if (!response.ok) {
      setStatus(getApiErrorMessage(data, 'Failed to update quiz question'));
      return;
    }
    await loadLibrary();
  }

  const filteredFlashcardSets = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return library.flashcardSets.filter((set) => {
      if (!query) return true;
      return set.title.toLowerCase().includes(query) || set.cards.some((card) => `${card.front} ${card.back}`.toLowerCase().includes(query));
    });
  }, [filter, library.flashcardSets]);

  const filteredQuizzes = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return library.quizzes.filter((quiz) => {
      if (!query) return true;
      return quiz.title.toLowerCase().includes(query) || quiz.questions.some((question) => `${question.question_text} ${question.explanation}`.toLowerCase().includes(query));
    });
  }, [filter, library.quizzes]);

  const totalLibraryItems = library.flashcardSets.length + library.quizzes.length;

  return (
    <>
      <section className="study-library-shell">
        <header className="study-library-header">
          <div>
            <p className="study-library-header__eyebrow">Study library</p>
            <h1 className="study-library-header__title">Generate, refine, and keep your study sets ready to use.</h1>
            <p className="study-library-header__description">
              Turn notes into flashcards and quizzes, then keep everything organized in one clean study workspace that is easy to search and edit.
            </p>
          </div>
          <div className="study-library-header__meta">
            <div className="study-library-header__meta-card">
              <span>Total sets</span>
              <strong>{totalLibraryItems}</strong>
            </div>
            <div className="study-library-header__meta-card">
              <span>Flashcards</span>
              <strong>{library.flashcardSets.length}</strong>
            </div>
            <div className="study-library-header__meta-card">
              <span>Quizzes</span>
              <strong>{library.quizzes.length}</strong>
            </div>
          </div>
        </header>

        {!hasSession ? (
          <section className="study-library-gate">
            <div>
              <strong>Sign in to build your study library.</strong>
              <p>Generate flashcards and quizzes from your notes, then keep everything editable and organized here.</p>
            </div>
            <div className="actions">
              <Link href="/login" className="primary-link-button">Log in</Link>
              <Link href="/signup" className="ghost-button">Create account</Link>
            </div>
          </section>
        ) : null}

        {status ? (
          <StatusBanner tone={highlightedSetId || highlightedQuizId ? 'success' : 'warning'}>{status}</StatusBanner>
        ) : null}

        {hasSession ? (
          <section className="study-library-reader-section">
            <div className="study-library-section__head">
              <div>
                <p className="eyebrow">Workspace reader</p>
                <h2 className="section-title">Browse uploaded documents and saved books while you study.</h2>
              </div>
              <Link href="/reader" className="ghost-button">Open full reader</Link>
            </div>

            <DocumentReaderWorkspace
              initialAssetId={searchParams.get('doc')}
              initialBookId={searchParams.get('book')}
              onUseForFlashcards={({ title: nextTitle, text }) => {
                setTitle(nextTitle);
                setNotes(text);
                setLibraryType('flashcards');
                setStatus('Loaded this document into the flashcard generator.');
                window.requestAnimationFrame(() => {
                  document.getElementById('study-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
              }}
              onUseForQuiz={({ title: nextTitle, text }) => {
                setTitle(`${nextTitle} Quiz`);
                setNotes(text);
                setLibraryType('quizzes');
                setStatus('Loaded this document into the quiz generator.');
                window.requestAnimationFrame(() => {
                  document.getElementById('study-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
              }}
            />
          </section>
        ) : null}

        <section className="study-library-workspace">
          <section className="study-generator-panel">
            <div className="study-library-panel-head">
              <div>
                <p className="eyebrow">Generator</p>
                <h2 className="section-title">Build a new study set</h2>
              </div>
              <span className="settings-badge">{audienceLevel}</span>
            </div>

            <div className="study-generator-panel__body">
              <div className="form-field">
                <label htmlFor="study-title">Set title</label>
                <input id="study-title" value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>

              <div className="form-field">
                <label htmlFor="study-notes">Notes</label>
                <textarea
                  id="study-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={11}
                  placeholder="Paste class notes, a summary, or material you want to study from."
                />
              </div>

              <div className="form-field">
                <label htmlFor="audience-level">Difficulty level</label>
                <select id="audience-level" value={audienceLevel} onChange={(event) => setAudienceLevel(event.target.value)}>
                  <option>Use onboarding profile</option>
                  <option>9th grade</option>
                  <option>10th grade</option>
                  <option>11th grade</option>
                  <option>12th grade</option>
                  <option>College freshman</option>
                  <option>College sophomore</option>
                  <option>College junior</option>
                  <option>College senior</option>
                  <option>Graduate level</option>
                </select>
              </div>

              <div className="study-generator-actions">
                <button onClick={generateFlashcards} disabled={loadingFlashcards}>
                  {loadingFlashcards ? 'Generating flashcards...' : 'Generate flashcards'}
                </button>
                <button onClick={generateQuiz} disabled={loadingQuiz}>
                  {loadingQuiz ? 'Generating quiz...' : 'Generate quiz'}
                </button>
              </div>
            </div>
          </section>

          <aside className="study-library-side">
            <section className="study-library-overview">
              <div className="study-library-panel-head">
                <div>
                  <p className="eyebrow">Overview</p>
                  <h3 style={{ margin: 0 }}>Library snapshot</h3>
                </div>
              </div>

              <div className="study-library-stat-grid">
                <div className="study-library-stat-card">
                  <strong>{library.flashcardSets.reduce((sum, set) => sum + set.cards.length, 0)}</strong>
                  <span>cards stored</span>
                </div>
                <div className="study-library-stat-card">
                  <strong>{library.quizzes.reduce((sum, quiz) => sum + quiz.questions.length, 0)}</strong>
                  <span>questions stored</span>
                </div>
                <div className="study-library-stat-card">
                  <strong>{filteredFlashcardSets.length}</strong>
                  <span>visible flashcard sets</span>
                </div>
                <div className="study-library-stat-card">
                  <strong>{filteredQuizzes.length}</strong>
                  <span>visible quizzes</span>
                </div>
              </div>
            </section>

            <section className="study-library-fresh">
              <div className="study-library-panel-head">
                <div>
                  <p className="eyebrow">Fresh output</p>
                  <h3 style={{ margin: 0 }}>Latest generated work</h3>
                </div>
              </div>

              <div className="stack-list">
                {flashcards.length > 0 ? (
                  <article className="stack-item">
                    <div>
                      <strong>Latest flashcard set</strong>
                      <p className="muted-copy" style={{ margin: '4px 0 0' }}>{flashcards.length} cards generated</p>
                    </div>
                    <span className="settings-badge">{flashcardSetId || 'new'}</span>
                  </article>
                ) : null}
                {quizQuestions.length > 0 ? (
                  <article className="stack-item">
                    <div>
                      <strong>Latest quiz</strong>
                      <p className="muted-copy" style={{ margin: '4px 0 0' }}>{quizQuestions.length} questions generated</p>
                    </div>
                    <span className="settings-badge">{quizId || 'new'}</span>
                  </article>
                ) : null}
                {!flashcards.length && !quizQuestions.length ? (
                  <div className="study-library-empty">
                    <strong>No generated sets yet</strong>
                    <p>Paste notes into the generator to create your first flashcards or quiz.</p>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="study-library-overview study-library-google">
              <div className="study-library-panel-head">
                <div>
                  <p className="eyebrow">Google workspace</p>
                  <h3 style={{ margin: 0 }}>Docs, Sheets, Slides, and Drive</h3>
                </div>
                <button type="button" className="ghost-button" onClick={() => void loadGoogleWorkspace()}>
                  Refresh
                </button>
              </div>

              <p className="muted-copy study-library-google__copy">
                Keep your Google study files close to the rest of your library so you can jump between docs, uploads, and AI tools without leaving StudyClaw.
              </p>

              {googleWorkspaceError ? (
                <StatusBanner tone="warning">{googleWorkspaceError}</StatusBanner>
              ) : null}

              {!googleStatus?.connected ? (
                <div className="study-library-empty">
                  <strong>Connect Google to open your workspace files here.</strong>
                  <p>
                    Once connected, recent Docs, Sheets, Slides, and Drive files will appear here for quick access while you study.
                  </p>
                  <Link href="/calendar" className="primary-link-button">Connect Google Calendar</Link>
                </div>
              ) : !googleStatus.canReadDrive ? (
                <div className="study-library-empty">
                  <strong>Reconnect Google to finish workspace access.</strong>
                  <p>
                    Your account is connected, but Drive access still needs to be granted before StudyClaw can show your Google files.
                  </p>
                  <Link href="/calendar" className="primary-link-button">Reconnect Google</Link>
                </div>
              ) : googleWorkspaceLoading ? (
                <div className="study-library-empty">
                  <strong>Loading your Google workspace</strong>
                  <p>Pulling in your latest files now.</p>
                </div>
              ) : (
                <div className="study-library-google__body">
                  <div className="study-library-stat-grid">
                    <div className="study-library-stat-card">
                      <strong>{googleFiles.all.length}</strong>
                      <span>recent Drive files</span>
                    </div>
                    <div className="study-library-stat-card">
                      <strong>{[googleStatus.canUseDocs, googleStatus.canUseSheets, googleStatus.canUseSlides].filter(Boolean).length}</strong>
                      <span>workspace tools ready</span>
                    </div>
                  </div>

                  <div className="study-library-google__groups">
                    {[
                      { label: 'Recent files', files: googleFiles.all },
                      { label: 'Docs', files: googleFiles.docs },
                      { label: 'Sheets', files: googleFiles.sheets },
                      { label: 'Slides', files: googleFiles.slides },
                    ].map((group) => (
                      <section key={group.label} className="study-library-google__group">
                        <div className="study-library-section__head">
                          <div>
                            <p className="eyebrow">{group.label}</p>
                            <h4 className="study-library-google__group-title">{group.files.length} available</h4>
                          </div>
                        </div>
                        {group.files.length ? (
                          <div className="stack-list">
                            {group.files.map((file) => (
                              <article key={`${group.label}-${file.id}`} className="stack-item">
                                <div>
                                  <strong>{file.name}</strong>
                                  <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                                    {file.mimeType ?? 'Google file'} · {formatWorkspaceDate(file.modifiedTime)}
                                  </p>
                                </div>
                                {file.webViewLink ? (
                                  <a href={file.webViewLink} target="_blank" rel="noreferrer" className="ghost-button">
                                    Open
                                  </a>
                                ) : null}
                              </article>
                            ))}
                          </div>
                        ) : (
                          <div className="study-library-empty study-library-google__empty">
                            <strong>No {group.label.toLowerCase()} yet</strong>
                            <p>As you use Google Workspace, your recent files will appear here.</p>
                          </div>
                        )}
                      </section>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="study-library-helper-row">
              <article className="study-library-helper-card">
                <p className="eyebrow">Generate</p>
                <strong>Start from your notes</strong>
                <p className="muted-copy">Use one note set to create either memorization-focused flashcards or quick self-check quizzes.</p>
              </article>
              <article className="study-library-helper-card">
                <p className="eyebrow">Refine</p>
                <strong>Edit anything that needs cleanup</strong>
                <p className="muted-copy">Each flashcard and question stays editable so the library gets better over time instead of locking you in.</p>
              </article>
            </section>
          </aside>
        </section>

        <section className="study-library-controls">
          <div className="form-field">
            <label htmlFor="library-filter">Search library</label>
            <input
              id="library-filter"
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search by title, question, prompt, or answer"
            />
          </div>
          <div className="segmented-control">
            {(['all', 'flashcards', 'quizzes'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={libraryType === value ? 'segment-button active' : 'segment-button'}
                onClick={() => setLibraryType(value)}
              >
                {value === 'all' ? 'All sets' : value}
              </button>
            ))}
          </div>
        </section>

        {(libraryType === 'all' || libraryType === 'flashcards') ? (
          <section className="study-library-section">
            <div className="study-library-section__head">
              <div>
                <p className="eyebrow">Flashcards</p>
                <h2 className="section-title">Editable review sets</h2>
              </div>
              <span className="settings-badge">{filteredFlashcardSets.length} visible</span>
            </div>

            <div className="study-library-list">
              {filteredFlashcardSets.map((set) => (
                <article
                  id={`study-library-item-${set.id}`}
                  key={set.id}
                  className={highlightedSetId === set.id ? 'study-set-card is-highlighted' : 'study-set-card'}
                >
                  <div className="study-set-card__head">
                    <input
                      className="library-title-input"
                      defaultValue={set.title}
                      onBlur={(event) => void renameFlashcardSet(set.id, event.target.value)}
                    />
                    <div className="library-meta">{new Date(set.created_at).toLocaleDateString()} · {set.cards.length} cards</div>
                  </div>

                  <div className="study-set-card__items">
                    {set.cards.map((card) => (
                      <div key={card.id ?? `${card.front}-${card.back}`} className="editable-card study-item-card">
                        <label>Front</label>
                        <textarea defaultValue={card.front} rows={2} />
                        <label>Back</label>
                        <textarea defaultValue={card.back} rows={3} />
                        <div className="card-edit-actions">
                          <button
                            type="button"
                            className="ghost-button inline-edit-button"
                            onClick={(event) => {
                              const values = getSiblingTextareaValues(event.currentTarget);
                              void saveFlashcard(set.id, card.id, values.first, values.second);
                            }}
                          >
                            Save edits
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
              {!filteredFlashcardSets.length ? (
                <div className="study-library-empty">
                  <strong>No flashcard sets match this view</strong>
                  <p>Try a different search or generate a new set from the workspace above.</p>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {(libraryType === 'all' || libraryType === 'quizzes') ? (
          <section className="study-library-section">
            <div className="study-library-section__head">
              <div>
                <p className="eyebrow">Quizzes</p>
                <h2 className="section-title">Practice sets you can refine</h2>
              </div>
              <span className="settings-badge">{filteredQuizzes.length} visible</span>
            </div>

            <div className="study-library-list">
              {filteredQuizzes.map((quiz) => (
                <article
                  id={`study-library-item-${quiz.id}`}
                  key={quiz.id}
                  className={highlightedQuizId === quiz.id ? 'study-set-card is-highlighted' : 'study-set-card'}
                >
                  <div className="study-set-card__head">
                    <input
                      className="library-title-input"
                      defaultValue={quiz.title}
                      onBlur={(event) => void renameQuiz(quiz.id, event.target.value)}
                    />
                    <div className="library-meta">{new Date(quiz.created_at).toLocaleDateString()} · {quiz.questions.length} questions</div>
                  </div>

                  <div className="study-set-card__items">
                    {quiz.questions.map((question) => (
                      <div key={question.id ?? question.question_text} className="editable-card study-item-card">
                        <label>{question.choices?.length ? 'Question' : 'Fill in the blank'}</label>
                        <textarea defaultValue={question.question_text} rows={3} />
                        {question.choices?.length ? (
                          <p className="muted-copy" style={{ margin: 0 }}>
                            Choices: {question.choices.join(' · ')}
                          </p>
                        ) : null}
                        <label>Explanation / answer guidance</label>
                        <textarea defaultValue={question.explanation} rows={3} />
                        <div className="card-edit-actions">
                          <button
                            type="button"
                            className="ghost-button inline-edit-button"
                            onClick={(event) => {
                              const values = getSiblingTextareaValues(event.currentTarget);
                              void saveQuestion(quiz.id, question.id, values.first, values.second);
                            }}
                          >
                            Save edits
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
              {!filteredQuizzes.length ? (
                <div className="study-library-empty">
                  <strong>No quizzes match this view</strong>
                  <p>Adjust the search or generate a new practice set from your notes.</p>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </section>
    </>
  );
}
