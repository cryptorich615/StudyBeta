type ChatThread = {
  id: string;
  title?: string | null;
  last_message_at: string;
};

type ChatSidebarProps = {
  userName: string;
  schoolName: string;
  currentModelKey: string;
  sessionCount: number;
  weeklySessions: number;
  streakDays: number;
  pendingNotes: number;
  studyModes: Array<{ key: string; label: string }>;
  selectedStudyMode: string;
  onSelectStudyMode: (mode: string) => void;
  threads: ChatThread[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
  capabilities: Array<{
    key: string;
    label: string;
    summary: string;
    actionLabel: string;
    active?: boolean;
  }>;
  onCapabilityAction: (capabilityKey: string) => void;
};

export default function ChatSidebar(props: ChatSidebarProps) {
  const formatThreadDate = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return 'Recent session';
    }

    return parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div className="study-chat-sidebar">
      <div className="study-chat-sidebar__brand">
        <div className="study-chat-sidebar__logo">SC</div>
        <div>
          <p className="study-chat-sidebar__eyebrow">Study chat</p>
          <h2 className="study-chat-sidebar__title">StudyClaw</h2>
        </div>
      </div>

      <div className="study-chat-sidebar__welcome">
        <p className="study-chat-sidebar__welcome-label">Current setup</p>
        <h3>{props.userName}</h3>
        <p>{props.schoolName || 'Your study workspace is ready.'}</p>
      </div>

      <div className="study-chat-sidebar__metrics">
        <div className="study-chat-sidebar__metric">
          <span>Weekly goal</span>
          <strong>{Math.min(props.weeklySessions, 4)}/4 sessions</strong>
        </div>
        <div className="study-chat-sidebar__metric">
          <span>Study streak</span>
          <strong>{props.streakDays} day{props.streakDays === 1 ? '' : 's'}</strong>
        </div>
        <div className="study-chat-sidebar__metric">
          <span>Notes ready</span>
          <strong>{props.pendingNotes}</strong>
        </div>
        <div className="study-chat-sidebar__metric">
          <span>Active model</span>
          <strong>{props.currentModelKey}</strong>
        </div>
      </div>

      <div className="study-chat-sidebar__section">
        <div className="study-chat-sidebar__section-head">
          <div>
            <p className="study-chat-sidebar__section-label">Study mode</p>
            <p className="study-chat-sidebar__section-caption">Shape the next reply before you send.</p>
          </div>
        </div>
        <div className="study-chat-sidebar__mode-list">
          {props.studyModes.map((mode) => (
            <button
              key={mode.key}
              type="button"
              className={mode.key === props.selectedStudyMode ? 'study-chat-sidebar__mode-chip is-active' : 'study-chat-sidebar__mode-chip'}
              onClick={() => props.onSelectStudyMode(mode.key)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <div className="study-chat-sidebar__section">
        <div className="study-chat-sidebar__section-head">
          <div>
            <p className="study-chat-sidebar__section-label">OpenClaw capabilities</p>
            <p className="study-chat-sidebar__section-caption">Use the agent for more than plain chat.</p>
          </div>
        </div>
        <div className="study-chat-sidebar__capability-list">
          {props.capabilities.map((capability) => (
            <div
              key={capability.key}
              className={capability.active ? 'study-chat-sidebar__capability is-active' : 'study-chat-sidebar__capability'}
            >
              <div>
                <strong>{capability.label}</strong>
                <p>{capability.summary}</p>
              </div>
              <button type="button" onClick={() => props.onCapabilityAction(capability.key)}>
                {capability.actionLabel}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="study-chat-sidebar__section">
        <div className="study-chat-sidebar__section-head">
          <div>
            <p className="study-chat-sidebar__section-label">Recent study sessions</p>
            <p className="study-chat-sidebar__section-caption">{props.sessionCount} saved conversations</p>
          </div>
          <button type="button" className="study-chat-sidebar__new-button" onClick={props.onNewChat}>
            New chat
          </button>
        </div>

        <div className="study-chat-sidebar__thread-list">
          {props.threads.length ? (
            props.threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={thread.id === props.activeThreadId ? 'study-chat-sidebar__thread is-active' : 'study-chat-sidebar__thread'}
                onClick={() => props.onSelectThread(thread.id)}
              >
                <strong>{thread.title || 'Untitled session'}</strong>
                <span>{formatThreadDate(thread.last_message_at)}</span>
              </button>
            ))
          ) : (
            <div className="study-chat-sidebar__empty">
              <strong>No sessions yet</strong>
              <p>Your next study conversation will show up here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
