'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { readStoredSession } from '../../lib/session';
import StatusBanner from '../components/status-banner';

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

export default function StudyPage() {
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

  useEffect(() => {
    setHasSession(!!readStoredSession()?.user?.id);
  }, []);

  useEffect(() => {
    if (!hasSession) return;
    void loadLibrary();
  }, [hasSession]);

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

  async function generateFlashcards() {
    if (!hasSession) {
      setStatus('Sign in and complete onboarding before generating study assets.');
      return;
    }

    setLoadingFlashcards(true);
    setStatus('');

    try {
      const response = await apiFetch('/api/study/flashcards', {
        method: 'POST',
        body: JSON.stringify({ title, text: notes, audienceLevel }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Flashcard request failed');
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
    if (!hasSession) {
      setStatus('Sign in and complete onboarding before generating study assets.');
      return;
    }

    setLoadingQuiz(true);
    setStatus('');

    try {
      const response = await apiFetch('/api/study/quiz', {
        method: 'POST',
        body: JSON.stringify({ title: `${title} Quiz`, text: notes, questionCount: 6, audienceLevel }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Quiz request failed');
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
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.message || 'Failed to update flashcard set');
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
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.message || 'Failed to update flashcard');
      return;
    }
    await loadLibrary();
  }

  async function renameQuiz(quizIdValue: string, nextTitle: string) {
    const response = await apiFetch(`/api/study/quizzes/${quizIdValue}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: nextTitle }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.message || 'Failed to update quiz');
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
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.message || 'Failed to update quiz question');
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

  return (
    <>
      <section className="hero-card hero-card-featured">
        <div className="hero-copy">
          <p className="insight-chip">Study library</p>
          <h1 className="hero-title">Generate once, then keep your study assets clean and usable.</h1>
          <p className="hero-description">
            StudyClaw turns notes into flashcards and quizzes, then keeps them editable, filterable, and organized as a real library.
          </p>
        </div>
        {!hasSession ? (
          <div className="hero-actions">
            <Link href="/login" className="primary-link-button">Log in</Link>
            <Link href="/signup" className="ghost-button">Create account</Link>
          </div>
        ) : null}
      </section>

      {status ? <StatusBanner tone="warning">{status}</StatusBanner> : null}

      <section className="workspace-grid">
        <section className="action-card">
          <p className="eyebrow">Generator</p>
          <div className="form-field">
            <label htmlFor="study-title">Title</label>
            <input id="study-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="form-field" style={{ marginTop: 16 }}>
            <label htmlFor="study-notes">Notes</label>
            <textarea id="study-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={10} />
          </div>
          <div className="form-field" style={{ marginTop: 16 }}>
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
          <div className="actions">
            <button onClick={generateFlashcards} disabled={loadingFlashcards}>
              {loadingFlashcards ? 'Generating flashcards...' : 'Generate flashcards'}
            </button>
            <button onClick={generateQuiz} disabled={loadingQuiz}>
              {loadingQuiz ? 'Generating quiz...' : 'Generate quiz'}
            </button>
          </div>
        </section>

        <section className="secondary-card">
          <p className="eyebrow">Fresh output</p>
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
              <p className="muted-copy">Generate a set or quiz to seed your library.</p>
            ) : null}
          </div>
        </section>
      </section>

      <section className="library-toolbar">
        <div className="form-field">
          <label htmlFor="library-filter">Filter library</label>
          <input
            id="library-filter"
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search by title, question, or answer"
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
              {value}
            </button>
          ))}
        </div>
      </section>

      {(libraryType === 'all' || libraryType === 'flashcards') ? (
        <section className="library-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">Flashcards</p>
              <h2 className="section-title">Sets you can edit</h2>
            </div>
          </div>
          <div className="stack-list">
            {filteredFlashcardSets.map((set) => (
              <article key={set.id} className="library-card">
                <input
                  className="library-title-input"
                  defaultValue={set.title}
                  onBlur={(event) => void renameFlashcardSet(set.id, event.target.value)}
                />
                <div className="library-meta">{new Date(set.created_at).toLocaleDateString()} · {set.cards.length} cards</div>
                <div className="library-items">
                  {set.cards.map((card) => (
                    <div key={card.id ?? `${card.front}-${card.back}`} className="editable-card">
                      <label>Front</label>
                      <textarea
                        defaultValue={card.front}
                        rows={2}
                      />
                      <label>Back</label>
                      <textarea
                        defaultValue={card.back}
                        rows={3}
                      />
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
            {!filteredFlashcardSets.length ? <p className="muted-copy">No flashcard sets match the current filter.</p> : null}
          </div>
        </section>
      ) : null}

      {(libraryType === 'all' || libraryType === 'quizzes') ? (
        <section className="library-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">Quizzes</p>
              <h2 className="section-title">Practice sets with editable prompts</h2>
            </div>
          </div>
          <div className="stack-list">
            {filteredQuizzes.map((quiz) => (
              <article key={quiz.id} className="library-card">
                <input
                  className="library-title-input"
                  defaultValue={quiz.title}
                  onBlur={(event) => void renameQuiz(quiz.id, event.target.value)}
                />
                <div className="library-meta">{new Date(quiz.created_at).toLocaleDateString()} · {quiz.questions.length} questions</div>
                <div className="library-items">
                  {quiz.questions.map((question) => (
                    <div key={question.id ?? question.question_text} className="editable-card">
                      <label>{question.choices?.length ? 'Question' : 'Fill in the blank'}</label>
                      <textarea
                        defaultValue={question.question_text}
                        rows={3}
                      />
                      {question.choices?.length ? (
                        <p className="muted-copy" style={{ margin: 0 }}>
                          Choices: {question.choices.join(' · ')}
                        </p>
                      ) : null}
                      <label>Explanation / answer guidance</label>
                      <textarea
                        defaultValue={question.explanation}
                        rows={3}
                      />
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
            {!filteredQuizzes.length ? <p className="muted-copy">No quizzes match the current filter.</p> : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
