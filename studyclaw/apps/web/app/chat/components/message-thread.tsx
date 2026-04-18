import type { RefObject } from 'react';
import ChatEmptyState from './chat-empty-state';
import MessageBubble from './message-bubble';

type ChatEntry = {
  id: string;
  role: 'assistant' | 'user' | string;
  content: string;
  createdAt?: string;
  metadata?: {
    attachments?: Array<{
      name: string;
      type: string;
      sourceKind?: string | null;
      sourceFileId?: string | null;
    }>;
    capabilityBadges?: Array<{
      key: string;
      label: string;
    }>;
    researchResult?: {
      kind: 'research_result';
      title: string;
      summary: string;
      sources: Array<{
        label: string;
        url: string;
        hostname: string;
      }>;
      pageTitle: string | null;
      checkedAt: string;
      screenshots: string[];
      screenshotUrl: string | null;
      screenshotAlt: string;
      savedToBackpack?: boolean;
      savedAssetId?: string | null;
      flashcardSetId?: string | null;
      quizId?: string | null;
    } | null;
  };
};

type MessageThreadProps = {
  messages: ChatEntry[];
  isTyping: boolean;
  agentName: string;
  liveAssistant: ChatEntry | null;
  liveProgress: string[];
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onPromptSelect: (prompt: string) => void;
  onBubbleAction: (instruction: string) => void;
  onSaveResearch: (messageId: string) => void;
  savingResearchId: string | null;
  onResearchAction: (messageId: string, action: 'flashcards' | 'quiz' | 'plan') => void;
  activeResearchActionKey: string | null;
};

export default function MessageThread({
  messages,
  isTyping,
  agentName,
  liveAssistant,
  liveProgress,
  messagesEndRef,
  onPromptSelect,
  onBubbleAction,
  onSaveResearch,
  savingResearchId,
  onResearchAction,
  activeResearchActionKey,
}: MessageThreadProps) {
  const currentLiveStatus = liveProgress.length ? liveProgress[liveProgress.length - 1] : null;
  const previousLiveStatuses = currentLiveStatus ? liveProgress.slice(0, -1) : [];

  return (
    <div className="study-chat-thread">
      {messages.length ? (
        messages.map((entry) => (
          <MessageBubble
            key={entry.id}
            entry={entry}
            agentName={agentName}
            onAction={onBubbleAction}
            onSaveResearch={onSaveResearch}
            savingResearchId={savingResearchId}
            onResearchAction={onResearchAction}
            activeResearchActionKey={activeResearchActionKey}
          />
        ))
      ) : (
        <ChatEmptyState agentName={agentName} onPromptSelect={onPromptSelect} />
      )}

      {isTyping && !liveAssistant && !liveProgress.length ? (
        <div className="study-chat-typing">
          <span className="study-chat-typing__dots">
            <span />
            <span />
            <span />
          </span>
          <span className="study-chat-typing__label">{agentName} is typing…</span>
        </div>
      ) : null}

      {liveAssistant || liveProgress.length ? (
        <article className="study-chat-bubble is-assistant is-streaming">
          <div className="study-chat-bubble__meta">
            <span>{agentName}</span>
            <span className="study-chat-bubble__timestamp">live</span>
          </div>
          {currentLiveStatus ? (
            <div className="study-chat-live-activity" aria-live="polite">
              <div className="study-chat-live-activity__header">
                <span className="study-chat-typing__dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <div>
                  <p className="study-chat-live-activity__eyebrow">Working live</p>
                  <strong className="study-chat-live-activity__current">{currentLiveStatus}</strong>
                </div>
              </div>
              {previousLiveStatuses.length ? (
                <div className="study-chat-live-progress">
                  {previousLiveStatuses.map((item) => (
                    <div key={item} className="study-chat-live-progress__item">
                      {item}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {liveAssistant?.content ? (
            <div className="study-chat-bubble__content">
              {liveAssistant.content}
              <span className="study-chat-live-cursor" aria-hidden="true" />
            </div>
          ) : null}
        </article>
      ) : null}

      <div ref={messagesEndRef} />
    </div>
  );
}
