type ChatHeaderProps = {
  agentName: string;
  currentModelKey: string;
  activeThreadId: string | null;
  selectedStudyMode: string;
  modeTitle: string;
  modeSummary: string;
};

export default function ChatHeader({
  agentName,
  currentModelKey,
  activeThreadId,
  selectedStudyMode,
  modeTitle,
  modeSummary,
}: ChatHeaderProps) {
  return (
    <header className="study-chat-header">
      <div className="study-chat-header__copy">
        <p className="study-chat-header__eyebrow">Study chat</p>
        <h1 className="study-chat-header__title">What are we studying today?</h1>
        <p className="study-chat-header__description">
          Ask a homework question, paste notes, or use {agentName} for research, planning, reminders, and study tools.
        </p>
      </div>

      <div className="study-chat-header__status">
        <div className="study-chat-header__status-card">
          <span>Session</span>
          <strong>{activeThreadId ? 'In progress' : 'Ready to start'}</strong>
        </div>
        <div className="study-chat-header__status-card">
          <span>Model</span>
          <strong>{currentModelKey}</strong>
        </div>
        <div className="study-chat-header__status-card">
          <span>OpenClaw mode</span>
          <strong>{modeTitle}</strong>
        </div>
        <div className="study-chat-header__status-card is-wide">
          <span>What it will do</span>
          <strong>{modeSummary}</strong>
        </div>
      </div>
    </header>
  );
}
