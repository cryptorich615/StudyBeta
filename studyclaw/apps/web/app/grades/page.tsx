'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch, getApiErrorMessage, readApiPayload } from '../../lib/api';
import StatusBanner from '../components/status-banner';

type CourseSummary = {
  courseId: string;
  courseName: string;
  estimatedPercent: number | null;
  letterGrade: string | null;
  totalItems: number;
  weighted: boolean;
  warnings: string[];
  categoryBreakdown: Array<{
    category: string;
    percent: number | null;
    weight: number | null;
    itemCount: number;
  }>;
  finalExamWeight: number | null;
};

type GradeItem = {
  id: string;
  course_id: string;
  title: string;
  category: string;
  points_earned: number | null;
  points_possible: number | null;
  percent: number | null;
  weight: number | null;
  occurred_on: string | null;
  notes: string | null;
};

type WrongAnswerReview = {
  id: string;
  course_id: string | null;
  course_name?: string | null;
  source_type: string;
  source_title: string;
  question_text: string;
  student_answer: string | null;
  correct_answer: string;
  explanation: string | null;
  concept_tags: string[];
  difficulty: string | null;
  occurred_on: string | null;
  teacher_notes: string | null;
  last_explanation_json?: {
    correctAnswer?: string;
    whyWrong?: string;
    howToSolve?: string;
    reviewConcept?: string;
    beginnerExplanation?: string;
    practiceQuestions?: string[];
  } | null;
};

type GradesPayload = {
  courses: CourseSummary[];
  items: GradeItem[];
  wrongAnswers: WrongAnswerReview[];
  reviewPatterns: Array<{ concept: string; misses: number }>;
  overallAverage: number | null;
};

const EMPTY_GRADE_FORM = {
  courseId: '',
  courseName: '',
  title: '',
  category: 'quiz',
  pointsEarned: '',
  pointsPossible: '',
  percent: '',
  weight: '',
  date: '',
  notes: '',
};

const EMPTY_REVIEW_FORM = {
  courseId: '',
  courseName: '',
  sourceType: 'quiz',
  sourceTitle: '',
  questionText: '',
  studentAnswer: '',
  correctAnswer: '',
  explanation: '',
  conceptTags: '',
  difficulty: 'medium',
  date: '',
  teacherNotes: '',
};

export default function GradesPage() {
  const [data, setData] = useState<GradesPayload | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [gradeForm, setGradeForm] = useState({ ...EMPTY_GRADE_FORM });
  const [reviewForm, setReviewForm] = useState({ ...EMPTY_REVIEW_FORM });
  const [editingGradeId, setEditingGradeId] = useState<string | null>(null);
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [savingGrade, setSavingGrade] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [courseSettings, setCourseSettings] = useState<Record<string, { calculationMode: 'points' | 'weighted'; finalExamWeight: string; homework: string; quiz: string; test: string; project: string; participation: string }>>({});
  const [explainingReviewId, setExplainingReviewId] = useState<string | null>(null);

  const courses = data?.courses ?? [];
  const gradeItems = data?.items ?? [];
  const wrongAnswers = data?.wrongAnswers ?? [];

  async function loadGrades(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }

    const response = await apiFetch('/api/grades');
    const payload = await readApiPayload(response);
    if (!response.ok) {
      setStatus(getApiErrorMessage(payload, 'Failed to load grades.'));
      setLoading(false);
      return;
    }

    setData(payload as GradesPayload);
    const nextSettings: Record<string, { calculationMode: 'points' | 'weighted'; finalExamWeight: string; homework: string; quiz: string; test: string; project: string; participation: string }> = {};
    for (const course of (payload as GradesPayload).courses) {
      const breakdownMap = Object.fromEntries(course.categoryBreakdown.map((item) => [item.category, item.weight ?? '']));
      nextSettings[course.courseId] = {
        calculationMode: course.weighted ? 'weighted' : 'points',
        finalExamWeight: course.finalExamWeight !== null ? String(course.finalExamWeight) : '',
        homework: String(breakdownMap.homework ?? ''),
        quiz: String(breakdownMap.quiz ?? ''),
        test: String(breakdownMap.test ?? ''),
        project: String(breakdownMap.project ?? ''),
        participation: String(breakdownMap.participation ?? ''),
      };
    }
    setCourseSettings(nextSettings);
    setLoading(false);
  }

  useEffect(() => {
    void loadGrades();
  }, []);

  const coursesById = useMemo(
    () => Object.fromEntries(courses.map((course) => [course.courseId, course])),
    [courses]
  );

  async function saveGrade(event: React.FormEvent) {
    event.preventDefault();
    setSavingGrade(true);
    const path = editingGradeId ? `/api/grades/items/${editingGradeId}` : '/api/grades/items';
    const method = editingGradeId ? 'PATCH' : 'POST';
    const response = await apiFetch(path, {
      method,
      body: JSON.stringify({
        courseId: gradeForm.courseId || null,
        courseName: gradeForm.courseId ? null : gradeForm.courseName,
        title: gradeForm.title,
        category: gradeForm.category,
        pointsEarned: gradeForm.pointsEarned ? Number(gradeForm.pointsEarned) : null,
        pointsPossible: gradeForm.pointsPossible ? Number(gradeForm.pointsPossible) : null,
        percent: gradeForm.percent ? Number(gradeForm.percent) : null,
        weight: gradeForm.weight ? Number(gradeForm.weight) : null,
        date: gradeForm.date || null,
        notes: gradeForm.notes || null,
      }),
    });
    const payload = await readApiPayload(response);
    if (!response.ok) {
      setStatus(getApiErrorMessage(payload, 'Failed to save grade.'));
      setSavingGrade(false);
      return;
    }

    setGradeForm({ ...EMPTY_GRADE_FORM });
    setEditingGradeId(null);
    setSavingGrade(false);
    setStatus(editingGradeId ? 'Grade updated.' : 'Grade saved.');
    await loadGrades({ silent: true });
  }

  function startEditGrade(item: GradeItem) {
    setEditingGradeId(item.id);
    setGradeForm({
      courseId: item.course_id,
      courseName: '',
      title: item.title,
      category: item.category,
      pointsEarned: item.points_earned !== null ? String(item.points_earned) : '',
      pointsPossible: item.points_possible !== null ? String(item.points_possible) : '',
      percent: item.percent !== null ? String(item.percent) : '',
      weight: item.weight !== null ? String(item.weight) : '',
      date: item.occurred_on ?? '',
      notes: item.notes ?? '',
    });
  }

  async function removeGrade(itemId: string) {
    const response = await apiFetch(`/api/grades/items/${itemId}`, { method: 'DELETE' });
    const payload = await readApiPayload(response);
    if (!response.ok) {
      setStatus(getApiErrorMessage(payload, 'Failed to delete grade.'));
      return;
    }
    setStatus('Grade deleted.');
    await loadGrades({ silent: true });
  }

  async function saveReview(event: React.FormEvent) {
    event.preventDefault();
    setSavingReview(true);
    const path = editingReviewId ? `/api/grades/reviews/${editingReviewId}` : '/api/grades/reviews';
    const method = editingReviewId ? 'PATCH' : 'POST';
    const response = await apiFetch(path, {
      method,
      body: JSON.stringify({
        courseId: reviewForm.courseId || null,
        courseName: reviewForm.courseId ? null : reviewForm.courseName,
        sourceType: reviewForm.sourceType,
        sourceTitle: reviewForm.sourceTitle,
        questionText: reviewForm.questionText,
        studentAnswer: reviewForm.studentAnswer || null,
        correctAnswer: reviewForm.correctAnswer,
        explanation: reviewForm.explanation || null,
        conceptTags: reviewForm.conceptTags.split(',').map((item) => item.trim()).filter(Boolean),
        difficulty: reviewForm.difficulty || null,
        date: reviewForm.date || null,
        teacherNotes: reviewForm.teacherNotes || null,
      }),
    });
    const payload = await readApiPayload(response);
    if (!response.ok) {
      setStatus(getApiErrorMessage(payload, 'Failed to save wrong-answer review.'));
      setSavingReview(false);
      return;
    }

    setReviewForm({ ...EMPTY_REVIEW_FORM });
    setEditingReviewId(null);
    setSavingReview(false);
    setStatus(editingReviewId ? 'Wrong-answer review updated.' : 'Wrong-answer review saved.');
    await loadGrades({ silent: true });
  }

  function startEditReview(review: WrongAnswerReview) {
    setEditingReviewId(review.id);
    setReviewForm({
      courseId: review.course_id ?? '',
      courseName: '',
      sourceType: review.source_type,
      sourceTitle: review.source_title,
      questionText: review.question_text,
      studentAnswer: review.student_answer ?? '',
      correctAnswer: review.correct_answer,
      explanation: review.explanation ?? '',
      conceptTags: (review.concept_tags ?? []).join(', '),
      difficulty: review.difficulty ?? 'medium',
      date: review.occurred_on ?? '',
      teacherNotes: review.teacher_notes ?? '',
    });
  }

  async function removeReview(reviewId: string) {
    const response = await apiFetch(`/api/grades/reviews/${reviewId}`, { method: 'DELETE' });
    const payload = await readApiPayload(response);
    if (!response.ok) {
      setStatus(getApiErrorMessage(payload, 'Failed to delete wrong-answer review.'));
      return;
    }
    setStatus('Wrong-answer review deleted.');
    await loadGrades({ silent: true });
  }

  async function explainReview(reviewId: string) {
    setExplainingReviewId(reviewId);
    const response = await apiFetch(`/api/grades/reviews/${reviewId}/explain`, { method: 'POST' });
    const payload = await readApiPayload(response);
    if (!response.ok) {
      setStatus(getApiErrorMessage(payload, 'Failed to explain wrong answer.'));
      setExplainingReviewId(null);
      return;
    }
    setStatus('Generated a guided explanation for that missed question.');
    setExplainingReviewId(null);
    await loadGrades({ silent: true });
  }

  async function saveCourseSettings(courseId: string) {
    const settings = courseSettings[courseId];
    const response = await apiFetch(`/api/grades/courses/${courseId}/settings`, {
      method: 'POST',
      body: JSON.stringify({
        calculationMode: settings.calculationMode,
        finalExamWeight: settings.finalExamWeight ? Number(settings.finalExamWeight) : null,
        categoryWeights: {
          homework: settings.homework ? Number(settings.homework) : 0,
          quiz: settings.quiz ? Number(settings.quiz) : 0,
          test: settings.test ? Number(settings.test) : 0,
          project: settings.project ? Number(settings.project) : 0,
          participation: settings.participation ? Number(settings.participation) : 0,
        },
      }),
    });
    const payload = await readApiPayload(response);
    if (!response.ok) {
      setStatus(getApiErrorMessage(payload, 'Failed to save course settings.'));
      return;
    }
    setStatus('Course weighting saved.');
    await loadGrades({ silent: true });
  }

  return (
    <main className="study-grades-page">
      <section className="study-grades-hero">
        <div>
          <p className="insight-chip">Grade Tracker</p>
          <h1>Track scores, estimate outcomes, and review what went wrong.</h1>
          <p>
            Keep class grades in one place, estimate where each course stands, and turn missed questions into clear next steps.
          </p>
        </div>
        <div className="study-grades-hero__stats">
          <div className="study-grades-stat">
            <span>overall estimate</span>
            <strong>{data?.overallAverage !== null && data?.overallAverage !== undefined ? `${data.overallAverage.toFixed(1)}%` : 'No grades yet'}</strong>
          </div>
          <div className="study-grades-stat">
            <span>courses tracked</span>
            <strong>{courses.length}</strong>
          </div>
          <div className="study-grades-stat">
            <span>wrong answers logged</span>
            <strong>{wrongAnswers.length}</strong>
          </div>
        </div>
      </section>

      {status ? <StatusBanner tone="neutral">{status}</StatusBanner> : null}

      <section className="study-grades-layout">
        <div className="study-grades-main">
          <article className="study-grades-panel">
            <div className="study-grades-panel__header">
              <div>
                <strong>{editingGradeId ? 'Edit grade item' : 'Add a grade'}</strong>
                <p>Enter quizzes, tests, projects, homework, or participation scores.</p>
              </div>
            </div>
            <form className="study-grades-form" onSubmit={saveGrade}>
              <label>
                <span>Existing course</span>
                <select value={gradeForm.courseId} onChange={(event) => setGradeForm((current) => ({ ...current, courseId: event.target.value, courseName: '' }))}>
                  <option value="">Create or use a new course below</option>
                  {courses.map((course) => (
                    <option key={course.courseId} value={course.courseId}>{course.courseName}</option>
                  ))}
                </select>
              </label>
              {!gradeForm.courseId ? (
                <label>
                  <span>New course name</span>
                  <input value={gradeForm.courseName} onChange={(event) => setGradeForm((current) => ({ ...current, courseName: event.target.value }))} placeholder="Algebra II" />
                </label>
              ) : null}
              <label>
                <span>Title</span>
                <input value={gradeForm.title} onChange={(event) => setGradeForm((current) => ({ ...current, title: event.target.value }))} placeholder="Chapter 4 quiz" />
              </label>
              <label>
                <span>Category</span>
                <select value={gradeForm.category} onChange={(event) => setGradeForm((current) => ({ ...current, category: event.target.value }))}>
                  {['homework', 'quiz', 'test', 'project', 'participation', 'lab', 'final', 'midterm'].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Points earned</span>
                <input value={gradeForm.pointsEarned} onChange={(event) => setGradeForm((current) => ({ ...current, pointsEarned: event.target.value }))} placeholder="18" inputMode="decimal" />
              </label>
              <label>
                <span>Points possible</span>
                <input value={gradeForm.pointsPossible} onChange={(event) => setGradeForm((current) => ({ ...current, pointsPossible: event.target.value }))} placeholder="25" inputMode="decimal" />
              </label>
              <label>
                <span>Percent override</span>
                <input value={gradeForm.percent} onChange={(event) => setGradeForm((current) => ({ ...current, percent: event.target.value }))} placeholder="72" inputMode="decimal" />
              </label>
              <label>
                <span>Category weight override</span>
                <input value={gradeForm.weight} onChange={(event) => setGradeForm((current) => ({ ...current, weight: event.target.value }))} placeholder="20" inputMode="decimal" />
              </label>
              <label>
                <span>Date</span>
                <input type="date" value={gradeForm.date} onChange={(event) => setGradeForm((current) => ({ ...current, date: event.target.value }))} />
              </label>
              <label className="study-grades-form__wide">
                <span>Notes</span>
                <textarea value={gradeForm.notes} onChange={(event) => setGradeForm((current) => ({ ...current, notes: event.target.value }))} rows={3} placeholder="Optional notes about curve, retake, or context." />
              </label>
              <div className="study-grades-form__actions">
                <button className="study-grades-button study-grades-button--primary" type="submit" disabled={savingGrade}>
                  {savingGrade ? 'Saving…' : editingGradeId ? 'Update grade' : 'Save grade'}
                </button>
                {editingGradeId ? (
                  <button className="study-grades-button" type="button" onClick={() => { setEditingGradeId(null); setGradeForm({ ...EMPTY_GRADE_FORM }); }}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          </article>

          <article className="study-grades-panel">
            <div className="study-grades-panel__header">
              <div>
                <strong>Wrong answer review</strong>
                <p>Log missed questions, then generate an explanation and study next steps.</p>
              </div>
            </div>
            <form className="study-grades-form" onSubmit={saveReview}>
              <label>
                <span>Existing course</span>
                <select value={reviewForm.courseId} onChange={(event) => setReviewForm((current) => ({ ...current, courseId: event.target.value, courseName: '' }))}>
                  <option value="">No linked course</option>
                  {courses.map((course) => (
                    <option key={course.courseId} value={course.courseId}>{course.courseName}</option>
                  ))}
                </select>
              </label>
              {!reviewForm.courseId ? (
                <label>
                  <span>New course name</span>
                  <input value={reviewForm.courseName} onChange={(event) => setReviewForm((current) => ({ ...current, courseName: event.target.value }))} placeholder="Chemistry" />
                </label>
              ) : null}
              <label>
                <span>Source type</span>
                <select value={reviewForm.sourceType} onChange={(event) => setReviewForm((current) => ({ ...current, sourceType: event.target.value }))}>
                  {['quiz', 'test', 'homework', 'assignment'].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Source title</span>
                <input value={reviewForm.sourceTitle} onChange={(event) => setReviewForm((current) => ({ ...current, sourceTitle: event.target.value }))} placeholder="Unit 3 test" />
              </label>
              <label className="study-grades-form__wide">
                <span>Question</span>
                <textarea value={reviewForm.questionText} onChange={(event) => setReviewForm((current) => ({ ...current, questionText: event.target.value }))} rows={4} />
              </label>
              <label className="study-grades-form__wide">
                <span>Your answer</span>
                <textarea value={reviewForm.studentAnswer} onChange={(event) => setReviewForm((current) => ({ ...current, studentAnswer: event.target.value }))} rows={3} />
              </label>
              <label className="study-grades-form__wide">
                <span>Correct answer</span>
                <textarea value={reviewForm.correctAnswer} onChange={(event) => setReviewForm((current) => ({ ...current, correctAnswer: event.target.value }))} rows={3} />
              </label>
              <label className="study-grades-form__wide">
                <span>Teacher or answer-key explanation</span>
                <textarea value={reviewForm.explanation} onChange={(event) => setReviewForm((current) => ({ ...current, explanation: event.target.value }))} rows={3} />
              </label>
              <label>
                <span>Concept tags</span>
                <input value={reviewForm.conceptTags} onChange={(event) => setReviewForm((current) => ({ ...current, conceptTags: event.target.value }))} placeholder="stoichiometry, dimensional analysis" />
              </label>
              <label>
                <span>Difficulty</span>
                <select value={reviewForm.difficulty} onChange={(event) => setReviewForm((current) => ({ ...current, difficulty: event.target.value }))}>
                  {['easy', 'medium', 'hard'].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Date</span>
                <input type="date" value={reviewForm.date} onChange={(event) => setReviewForm((current) => ({ ...current, date: event.target.value }))} />
              </label>
              <label className="study-grades-form__wide">
                <span>Teacher notes</span>
                <textarea value={reviewForm.teacherNotes} onChange={(event) => setReviewForm((current) => ({ ...current, teacherNotes: event.target.value }))} rows={3} />
              </label>
              <div className="study-grades-form__actions">
                <button className="study-grades-button study-grades-button--primary" type="submit" disabled={savingReview}>
                  {savingReview ? 'Saving…' : editingReviewId ? 'Update review item' : 'Save review item'}
                </button>
                {editingReviewId ? (
                  <button className="study-grades-button" type="button" onClick={() => { setEditingReviewId(null); setReviewForm({ ...EMPTY_REVIEW_FORM }); }}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          </article>
        </div>

        <aside className="study-grades-side">
          <article className="study-grades-panel">
            <div className="study-grades-panel__header">
              <div>
                <strong>Course estimates</strong>
                <p>Each course estimate updates when you change grade items or weighting.</p>
              </div>
              <Link href="/chat" className="study-grades-link">Ask in chat</Link>
            </div>
            {loading ? <p className="muted-copy">Loading grade tracker…</p> : null}
            {!loading && !courses.length ? (
              <div className="study-grades-empty">
                <strong>No courses tracked yet</strong>
                <p>Add your first grade above, or ask StudyClaw to log one in chat.</p>
              </div>
            ) : null}
            {courses.map((course) => {
              const settings = courseSettings[course.courseId] ?? {
                calculationMode: course.weighted ? 'weighted' : 'points',
                finalExamWeight: course.finalExamWeight !== null ? String(course.finalExamWeight) : '',
                homework: '',
                quiz: '',
                test: '',
                project: '',
                participation: '',
              };
              return (
                <div key={course.courseId} className="study-grades-course-card">
                  <div className="study-grades-course-card__top">
                    <div>
                      <strong>{course.courseName}</strong>
                      <p>{course.totalItems} items tracked</p>
                    </div>
                    <div className="study-grades-course-card__grade">
                      <span>{course.estimatedPercent !== null ? `${course.estimatedPercent.toFixed(1)}%` : 'N/A'}</span>
                      <em>{course.letterGrade ?? 'N/A'}</em>
                    </div>
                  </div>
                  {course.warnings[0] ? <p className="muted-copy">{course.warnings[0]}</p> : null}
                  <div className="study-grades-settings-grid">
                    <label>
                      <span>Mode</span>
                      <select value={settings.calculationMode} onChange={(event) => setCourseSettings((current) => ({ ...current, [course.courseId]: { ...settings, calculationMode: event.target.value as 'points' | 'weighted' } }))}>
                        <option value="points">Points based</option>
                        <option value="weighted">Weighted categories</option>
                      </select>
                    </label>
                    <label>
                      <span>Final weight %</span>
                      <input value={settings.finalExamWeight} onChange={(event) => setCourseSettings((current) => ({ ...current, [course.courseId]: { ...settings, finalExamWeight: event.target.value } }))} inputMode="decimal" />
                    </label>
                    {['homework', 'quiz', 'test', 'project', 'participation'].map((key) => (
                      <label key={key}>
                        <span>{key} %</span>
                        <input value={(settings as any)[key]} onChange={(event) => setCourseSettings((current) => ({ ...current, [course.courseId]: { ...settings, [key]: event.target.value } }))} inputMode="decimal" />
                      </label>
                    ))}
                  </div>
                  <button className="study-grades-button" type="button" onClick={() => void saveCourseSettings(course.courseId)}>
                    Save weighting
                  </button>
                  <div className="study-grades-breakdown">
                    {course.categoryBreakdown.map((item) => (
                      <div key={`${course.courseId}-${item.category}`} className="study-grades-breakdown__row">
                        <span>{item.category}</span>
                        <span>{item.percent !== null ? `${item.percent.toFixed(1)}%` : 'No scores yet'}{item.weight !== null ? ` · ${item.weight}%` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </article>

          <article className="study-grades-panel">
            <div className="study-grades-panel__header">
              <div>
                <strong>Concepts to review</strong>
                <p>Patterns come from the wrong answers you log here.</p>
              </div>
            </div>
            {!data?.reviewPatterns.length ? (
              <div className="study-grades-empty">
                <strong>No patterns yet</strong>
                <p>Log missed questions to see the concepts you keep missing most.</p>
              </div>
            ) : (
              <div className="study-grades-concepts">
                {data.reviewPatterns.map((item) => (
                  <div key={item.concept} className="study-grades-concept-pill">
                    <strong>{item.concept}</strong>
                    <span>{item.misses} missed</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </aside>
      </section>

      <section className="study-grades-library">
        <article className="study-grades-panel">
          <div className="study-grades-panel__header">
            <div>
              <strong>Recent grade entries</strong>
              <p>Update or remove anything that no longer reflects your class record.</p>
            </div>
          </div>
          {!gradeItems.length ? (
            <div className="study-grades-empty">
              <strong>No grades logged yet</strong>
              <p>Add a score above or ask StudyClaw: “Add my biology quiz grade: 18/25”.</p>
            </div>
          ) : (
            <div className="study-grades-list">
              {gradeItems.slice(0, 20).map((item) => (
                <div key={item.id} className="study-grades-list__item">
                  <div>
                    <strong>{item.title}</strong>
                    <p>{coursesById[item.course_id]?.courseName ?? 'Unsorted'} · {item.category} · {item.percent !== null ? `${Number(item.percent).toFixed(1)}%` : 'No percent yet'}</p>
                  </div>
                  <div className="study-grades-list__actions">
                    <button className="study-grades-button" type="button" onClick={() => startEditGrade(item)}>Edit</button>
                    <button className="study-grades-button study-grades-button--danger" type="button" onClick={() => void removeGrade(item.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="study-grades-panel">
          <div className="study-grades-panel__header">
            <div>
              <strong>Wrong answer review library</strong>
              <p>Open each item for an AI explanation, remediation plan, and practice ideas.</p>
            </div>
          </div>
          {!wrongAnswers.length ? (
            <div className="study-grades-empty">
              <strong>No wrong-answer reviews yet</strong>
              <p>Paste the missed question details above and StudyClaw will help break it down.</p>
            </div>
          ) : (
            <div className="study-grades-review-list">
              {wrongAnswers.map((review) => (
                <div key={review.id} className="study-grades-review-card">
                  <div className="study-grades-review-card__top">
                    <div>
                      <strong>{review.source_title}</strong>
                      <p>{review.course_name ?? 'Unsorted'} · {review.source_type}</p>
                    </div>
                    <div className="study-grades-review-card__actions">
                      <button className="study-grades-button" type="button" onClick={() => startEditReview(review)}>Edit</button>
                      <button className="study-grades-button study-grades-button--danger" type="button" onClick={() => void removeReview(review.id)}>Delete</button>
                    </div>
                  </div>
                  <p className="study-grades-review-card__question">{review.question_text}</p>
                  <div className="study-grades-review-card__meta">
                    {(review.concept_tags ?? []).map((tag) => (
                      <span key={`${review.id}-${tag}`} className="study-grades-tag">{tag}</span>
                    ))}
                  </div>
                  <button className="study-grades-button study-grades-button--primary" type="button" onClick={() => void explainReview(review.id)} disabled={explainingReviewId === review.id}>
                    {explainingReviewId === review.id ? 'Explaining…' : 'Explain this missed question'}
                  </button>
                  {review.last_explanation_json ? (
                    <div className="study-grades-explanation">
                      <strong>{review.last_explanation_json.reviewConcept ?? 'AI review'}</strong>
                      <p><strong>Correct answer:</strong> {review.last_explanation_json.correctAnswer ?? review.correct_answer}</p>
                      <p><strong>Why your answer missed:</strong> {review.last_explanation_json.whyWrong}</p>
                      <p><strong>How to solve it:</strong> {review.last_explanation_json.howToSolve}</p>
                      {review.last_explanation_json.beginnerExplanation ? (
                        <p><strong>Beginner version:</strong> {review.last_explanation_json.beginnerExplanation}</p>
                      ) : null}
                      {review.last_explanation_json.practiceQuestions?.length ? (
                        <div>
                          <strong>Practice next</strong>
                          <ul>
                            {review.last_explanation_json.practiceQuestions.map((question, index) => (
                              <li key={`${review.id}-practice-${index}`}>{question}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
