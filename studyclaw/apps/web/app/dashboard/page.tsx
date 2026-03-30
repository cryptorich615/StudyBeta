'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch, beginGoogleConnect } from '../../lib/api';
import { readStoredSession } from '../../lib/session';
import { consumePayloadFromUrl } from '../../lib/consumePayload';
import StatusBanner from '../components/status-banner';

type DashboardTask = {
  id: string;
  title: string;
  type: string;
  status?: string;
  reminder_at: string;
  urgencyLabel: string;
};

type TaskDraft = {
  title: string;
  type: string;
  reminderAt: string;
};

type DashboardData = {
  generatedAt: string;
  onboardingComplete: boolean;
  heartbeat: {
    status: string;
    cadenceMinutes: number;
    lastEvaluatedAt: string;
    nextRunAt: string;
    source: string;
    summary: string;
  };
  integrations: {
    calendarConnected: boolean;
    sourceLabel: string;
    googleEmail?: string | null;
  };
  studentAgent?: {
    name: string;
    agent_type: string;
    status: string;
  } | null;
  counts: {
    flashcardSets: number;
    quizzes: number;
    conversations: number;
    knowledgeItems: number;
  };
  todayTasks: DashboardTask[];
  dueSoon: DashboardTask[];
  nextExam: DashboardTask | null;
  recommendations: string[];
  weeklyStudyPlan: Array<{
    dateKey: string;
    label: string;
    workload: 'light' | 'steady' | 'heavy';
    focus: string;
    blocks: Array<{
      title: string;
      detail: string;
      timeLabel: string;
    }>;
  }>;
  calendarEvents: Array<{
    id: string;
    title: string;
    startsAt: string | null;
    endsAt: string | null;
    htmlLink: string | null;
  }>;
  activityFeed: Array<{
    action_type: string;
    summary: string;
    created_at: string;
  }>;
  quickActions: Array<{ label: string; href: string }>;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function toLocalDateTimeValue(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function isExamTask(task: DashboardTask) {
  const examPattern = /exam|midterm|final|quiz|test/i;
  return examPattern.test(task.type) || examPattern.test(task.title);
}

function buildUpcomingExams(data: DashboardData | null) {
  if (!data) return [];

  const seen = new Set<string>();
  const items = [data.nextExam, ...data.todayTasks, ...data.dueSoon]
    .filter((task): task is DashboardTask => !!task && isExamTask(task))
    .filter((task) => {
      if (seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    })
    .sort((a, b) => new Date(a.reminder_at).getTime() - new Date(b.reminder_at).getTime());

  return items;
}

function buildWeeklyGoal(data: DashboardData | null) {
  const tasks = data?.todayTasks ?? [];
  const dueSoon = data?.dueSoon ?? [];
  return Math.min(100, Math.max(12, (tasks.length * 18) + (dueSoon.length * 8)));
}

function DashboardPageContent() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState('');
  const [hasSession, setHasSession] = useState<boolean | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }

    return !!readStoredSession()?.user?.id;
  });
  const [loading, setLoading] = useState(false);
  const [taskActionId, setTaskActionId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const upcomingExams = buildUpcomingExams(data);
  const weeklyGoalProgress = buildWeeklyGoal(data);

  async function handleGoogleConnect(returnTo: string) {
    try {
      await beginGoogleConnect(returnTo);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to start Google connection');
    }
  }

  async function loadDashboard(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }

    const response = await apiFetch('/api/dashboard');
    const payload = await response.json();

    if (!response.ok) {
      setStatus(payload.message || 'Failed to load dashboard');
      if (!options?.silent) {
        setLoading(false);
      }
      return false;
    }

    setData(payload);
    setStatus('');
    if (!options?.silent) {
      setLoading(false);
    }
    return true;
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const payloadSession = consumePayloadFromUrl(new URLSearchParams(window.location.search));
    setHasSession((current) => current ?? !!(payloadSession?.user?.id || readStoredSession()?.user?.id));
  }, []);

  useEffect(() => {
    if (!hasSession) return;

    let active = true;

    async function load() {
      if (!active) return;
      await loadDashboard();
    }

    void load();
    const timer = window.setInterval(() => {
      if (active) {
        void loadDashboard({ silent: true });
      }
    }, 60 * 1000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [hasSession]);

  function beginEditingTask(task: DashboardTask) {
    setEditingTaskId(task.id);
    setTaskDraft({
      title: task.title,
      type: task.type,
      reminderAt: toLocalDateTimeValue(task.reminder_at),
    });
    setStatus('');
  }

  function cancelEditingTask() {
    setEditingTaskId(null);
    setTaskDraft(null);
  }

  async function saveTask(taskId: string) {
    if (!taskDraft?.title.trim() || !taskDraft.type.trim() || !taskDraft.reminderAt) {
      setStatus('Title, type, and time are required.');
      return;
    }

    setTaskActionId(taskId);
    const response = await apiFetch(`/api/reminders/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: taskDraft.title.trim(),
        type: taskDraft.type.trim(),
        reminderAt: new Date(taskDraft.reminderAt).toISOString(),
      }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus(payload.message || 'Failed to update task.');
      setTaskActionId(null);
      return;
    }

    cancelEditingTask();
    await loadDashboard({ silent: true });
    setTaskActionId(null);
  }

  async function deleteTask(taskId: string) {
    setTaskActionId(taskId);
    const response = await apiFetch(`/api/reminders/${taskId}`, {
      method: 'DELETE',
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus(payload.message || 'Failed to delete task.');
      setTaskActionId(null);
      return;
    }

    if (editingTaskId === taskId) {
      cancelEditingTask();
    }

    await loadDashboard({ silent: true });
    setTaskActionId(null);
  }

  if (hasSession === null) {
    return (
      <section className="hero-card">
        <p className="insight-chip">Dashboard</p>
        <h1 className="hero-title">Loading your student board.</h1>
        <p className="hero-description">Checking your saved session and pulling the latest dashboard state.</p>
      </section>
    );
  }

  if (!hasSession) {
    return (
      <section className="hero-card">
        <p className="insight-chip">Dashboard</p>
        <h1 className="hero-title">Sign in to see your live student board.</h1>
        <p className="hero-description">The dashboard ranks real reminders and study signals. It is only useful when it is tied to your session.</p>
        <div className="actions">
          <Link href="/login" className="primary-link-button">Log in</Link>
          <Link href="/signup" className="ghost-button">Create account</Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="student-dashboard-shell">
        <header className="student-dashboard-header">
          <div>
            <p className="student-dashboard-header__eyebrow">Student dashboard</p>
            <h1 className="student-dashboard-header__title">Stay on top of today’s work without losing the bigger picture.</h1>
            <p className="student-dashboard-header__description">
              StudyClaw keeps today’s tasks, upcoming exams, calendar context, and study momentum in one focused board.
            </p>
            {data ? (
              <div className="student-dashboard-header__chips">
                <span className="insight-chip">{data.integrations.sourceLabel}</span>
                {data.studentAgent ? <span className="insight-chip">{data.studentAgent.name} · {data.studentAgent.agent_type}</span> : null}
                <span className="insight-chip">Updated {formatDate(data.generatedAt)}</span>
              </div>
            ) : null}
          </div>

          <div className="student-dashboard-header__meta">
            <div className="student-dashboard-header__meta-card">
              <span>Flashcards</span>
              <strong>{data?.counts.flashcardSets ?? 0}</strong>
            </div>
            <div className="student-dashboard-header__meta-card">
              <span>Quizzes</span>
              <strong>{data?.counts.quizzes ?? 0}</strong>
            </div>
            <div className="student-dashboard-header__meta-card">
              <span>Knowledge</span>
              <strong>{data?.counts.knowledgeItems ?? 0}</strong>
            </div>
          </div>
        </header>

        {loading && !data ? <StatusBanner tone="neutral">Loading your dashboard...</StatusBanner> : null}
        {status ? <StatusBanner tone="danger">{status}</StatusBanner> : null}
        {data && !data.onboardingComplete ? (
          <StatusBanner tone="warning">
            Your account is signed in, but setup is not finished yet. Use the shortcuts below to finish onboarding and start feeding the dashboard real study data.
          </StatusBanner>
        ) : null}
        {data && !data.integrations.calendarConnected ? (
          <StatusBanner tone="warning">
            <button type="button" className="inline-edit-button" onClick={() => void handleGoogleConnect('/dashboard')}>
              Connect Google Calendar
            </button>{' '}
            to layer classes, exams, and deadlines onto your board.
          </StatusBanner>
        ) : null}

        <section className="student-dashboard-ribbon">
          <article className="student-dashboard-ribbon__card">
            <span className="preview-pill">Today’s focus</span>
            <strong>{data?.todayTasks[0]?.title ?? 'Nothing urgent right now'}</strong>
            <p className="muted-copy" style={{ margin: '6px 0 0' }}>
              {data?.todayTasks[0] ? `${data.todayTasks[0].type} · ${data.todayTasks[0].urgencyLabel}` : 'Your board is clear for the moment.'}
            </p>
          </article>
          <article className="student-dashboard-ribbon__card">
            <span className="preview-pill">Next exam</span>
            <strong>{upcomingExams[0]?.title ?? 'Nothing scheduled yet'}</strong>
            <p className="muted-copy" style={{ margin: '6px 0 0' }}>
              {upcomingExams[0] ? formatDate(upcomingExams[0].reminder_at) : 'Add exam reminders to keep this visible.'}
            </p>
          </article>
          <article className="student-dashboard-ribbon__card">
            <span className="preview-pill">Weekly momentum</span>
            <strong>{weeklyGoalProgress}% in motion</strong>
            <div className="student-dashboard-progress">
              <div className="student-dashboard-progress__track">
                <div className="student-dashboard-progress__fill" style={{ width: `${weeklyGoalProgress}%` }} />
              </div>
            </div>
          </article>
        </section>

        <section className="student-dashboard-grid">
          <section className="student-dashboard-main">
            <section className="student-dashboard-panel student-dashboard-panel--focus">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Today</p>
                  <h2 className="section-title">Today&apos;s tasks</h2>
                </div>
              </div>
              <ul className="priority-list">
                {(data?.todayTasks ?? []).length ? (
                  data?.todayTasks.map((task) => (
                    <li key={task.id} className="priority-item">
                      {editingTaskId === task.id && taskDraft ? (
                        <div className="task-editor">
                          <input
                            value={taskDraft.title}
                            onChange={(event) =>
                              setTaskDraft((current) => (current ? { ...current, title: event.target.value } : current))
                            }
                            className="task-editor-input"
                            placeholder="Task title"
                          />
                          <div className="task-editor-grid">
                            <input
                              value={taskDraft.type}
                              onChange={(event) =>
                                setTaskDraft((current) => (current ? { ...current, type: event.target.value } : current))
                              }
                              className="task-editor-input"
                              placeholder="Task type"
                            />
                            <input
                              type="datetime-local"
                              value={taskDraft.reminderAt}
                              onChange={(event) =>
                                setTaskDraft((current) => (current ? { ...current, reminderAt: event.target.value } : current))
                              }
                              className="task-editor-input"
                            />
                          </div>
                          <div className="task-action-row">
                            <button
                              type="button"
                              className="task-action-button task-action-button-primary"
                              onClick={() => void saveTask(task.id)}
                              disabled={taskActionId === task.id}
                            >
                              {taskActionId === task.id ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              type="button"
                              className="task-action-button"
                              onClick={cancelEditingTask}
                              disabled={taskActionId === task.id}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="task-main">
                          <div>
                            <strong>{task.title}</strong>
                            <span>{task.type} · {task.urgencyLabel}</span>
                          </div>
                          <div className="task-meta-stack">
                            <div className="task-meta">{formatDate(task.reminder_at)}</div>
                            <div className="task-action-row">
                              <button
                                type="button"
                                className="task-action-button"
                                onClick={() => beginEditingTask(task)}
                                disabled={taskActionId === task.id}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="task-action-button task-action-button-danger"
                                onClick={() => void deleteTask(task.id)}
                                disabled={taskActionId === task.id}
                              >
                                {taskActionId === task.id ? 'Deleting...' : 'Delete'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </li>
                  ))
                ) : (
                  <li className="priority-item priority-empty">
                    <div>
                      <strong>No tasks due today</strong>
                      <span>Add reminders or connect more academic inputs to sharpen this board.</span>
                    </div>
                  </li>
                )}
              </ul>
            </section>

            <section className="student-dashboard-panel">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Weekly plan</p>
                  <h2 className="section-title">Suggested study rhythm for the next few days</h2>
                </div>
              </div>
              {(data?.weeklyStudyPlan ?? []).length ? (
                <div className="student-dashboard-plan-grid">
                  {data?.weeklyStudyPlan.map((day) => (
                    <article key={day.dateKey} className={`student-dashboard-plan-card is-${day.workload}`}>
                      <div className="student-dashboard-plan-card__header">
                        <div>
                          <p className="student-dashboard-plan-card__day">{day.label}</p>
                          <strong>{day.focus}</strong>
                        </div>
                        <span className={`student-dashboard-plan-card__pill is-${day.workload}`}>
                          {day.workload}
                        </span>
                      </div>
                      <div className="student-dashboard-plan-card__blocks">
                        {day.blocks.map((block) => (
                          <div key={`${day.dateKey}-${block.title}`} className="student-dashboard-plan-card__block">
                            <div className="student-dashboard-plan-card__time">{block.timeLabel}</div>
                            <div>
                              <strong>{block.title}</strong>
                              <p>{block.detail}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted-copy">Add reminders, exams, or calendar events to generate a stronger weekly study rhythm.</p>
              )}
            </section>

            <section className="student-dashboard-double">
              <section className="student-dashboard-panel">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">Shortcuts</p>
                    <h2 className="section-title">What to do next</h2>
                  </div>
                </div>
                <div className="student-dashboard-shortcuts">
                  {(data?.quickActions ?? []).length ? (
                    data?.quickActions.map((action) => (
                      <Link key={action.href} href={action.href} className="student-dashboard-shortcut">
                        <strong>{action.label}</strong>
                        <span>Open</span>
                      </Link>
                    ))
                  ) : (
                    <div className="study-library-empty">
                      <strong>No shortcuts yet</strong>
                      <p>Finish setup and add more study data to unlock clearer next steps here.</p>
                    </div>
                  )}
                </div>
              </section>

              <section className="student-dashboard-panel">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">Priority messages</p>
                    <h2 className="section-title">What to keep in mind</h2>
                  </div>
                </div>
                <div className="timeline">
                  {(data?.recommendations ?? []).length ? (
                    data?.recommendations.map((item) => (
                      <div key={item} className="timeline-item">
                        <p className="muted-copy" style={{ margin: 0 }}>{item}</p>
                      </div>
                    ))
                  ) : (
                    <p className="muted-copy">No priority messages yet. Add more study inputs to sharpen the board.</p>
                  )}
                </div>
              </section>
            </section>
          </section>

          <aside className="student-dashboard-side">
            <section className="student-dashboard-panel">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Due soon</p>
                  <h2 className="section-title">Coming up next</h2>
                </div>
              </div>
              <div className="stack-list">
                {(data?.dueSoon ?? []).length ? (
                  data?.dueSoon.map((task) => (
                    <article key={task.id} className="stack-item">
                      <div>
                        <strong>{task.title}</strong>
                        <p className="muted-copy" style={{ margin: '4px 0 0' }}>{task.type} · {task.urgencyLabel}</p>
                      </div>
                      <span className="settings-badge">{formatDate(task.reminder_at)}</span>
                    </article>
                  ))
                ) : (
                  <p className="muted-copy">No near-term work is connected yet. Add reminders or calendar data to populate this list.</p>
                )}
              </div>
            </section>

            <section className="student-dashboard-panel">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Upcoming exams</p>
                  <h2 className="section-title">Tests on deck</h2>
                </div>
              </div>
              {upcomingExams.length ? (
                <div className="stack-list">
                  {upcomingExams.map((task) => (
                    <article key={task.id} className="stack-item">
                      <div>
                        <strong>{task.title}</strong>
                        <p className="muted-copy" style={{ margin: '4px 0 0' }}>{task.type}</p>
                      </div>
                      <span className="settings-badge">{formatDate(task.reminder_at)}</span>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted-copy">No upcoming exams are scheduled yet.</p>
              )}
            </section>

            <section className="student-dashboard-panel">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Calendar</p>
                  <h2 className="section-title">Upcoming events</h2>
                </div>
              </div>
              {data?.integrations.googleEmail ? (
                data.calendarEvents.length ? (
                  <div className="stack-list">
                    {data.calendarEvents.slice(0, 4).map((event) => (
                      <article key={event.id} className="stack-item">
                        <div>
                          <strong>{event.title}</strong>
                          <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                            {event.startsAt ? formatDate(event.startsAt) : 'Date unavailable'}
                          </p>
                        </div>
                        {event.htmlLink ? (
                          <Link href={event.htmlLink} target="_blank" rel="noreferrer" className="ghost-button">
                            Open
                          </Link>
                        ) : null}
                      </article>
                    ))}
                    <Link href="/calendar" className="ghost-button">
                      View calendar
                    </Link>
                  </div>
                ) : (
                  <p className="muted-copy">No upcoming Google Calendar events are available yet.</p>
                )
              ) : (
                <button type="button" className="ghost-button" onClick={() => void handleGoogleConnect('/dashboard')}>
                  Connect Google Calendar
                </button>
              )}
            </section>
          </aside>
        </section>

        <section className="student-dashboard-bottom">
          <section className="student-dashboard-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Activity</p>
                <h2 className="section-title">Recent study activity</h2>
              </div>
            </div>
            <div className="timeline">
              {(data?.activityFeed ?? []).length ? (
                data?.activityFeed.slice(0, 6).map((item) => (
                  <div key={`${item.action_type}-${item.created_at}-${item.summary}`} className="timeline-item">
                    <strong>{item.summary}</strong>
                    <p className="muted-copy" style={{ margin: '4px 0 0' }}>{formatDate(item.created_at)}</p>
                  </div>
                ))
              ) : (
                <p className="muted-copy">Activity will show up here as you chat, generate study tools, and save new materials.</p>
              )}
            </div>
          </section>

          <section className="student-dashboard-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Heartbeat</p>
                <h2 className="section-title">Board status</h2>
              </div>
            </div>
            {data ? (
              <div className="student-dashboard-heartbeat">
                <div className="student-dashboard-heartbeat__summary">
                  <strong>{data.heartbeat.status}</strong>
                  <p className="muted-copy" style={{ margin: '6px 0 0' }}>{data.heartbeat.summary}</p>
                </div>
                <div className="student-dashboard-heartbeat__meta">
                  <div className="student-dashboard-heartbeat__meta-card">
                    <span>Last checked</span>
                    <strong>{formatDate(data.heartbeat.lastEvaluatedAt)}</strong>
                  </div>
                  <div className="student-dashboard-heartbeat__meta-card">
                    <span>Next refresh</span>
                    <strong>{formatDate(data.heartbeat.nextRunAt)}</strong>
                  </div>
                  <div className="student-dashboard-heartbeat__meta-card">
                    <span>Cadence</span>
                    <strong>Every {data.heartbeat.cadenceMinutes} min</strong>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </section>
      </section>
    </>
  );
}

export default function DashboardPage() {
  return <DashboardPageContent />;
}
