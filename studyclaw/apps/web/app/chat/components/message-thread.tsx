import type { RefObject } from 'react';
import ChatEmptyState from './chat-empty-state';
import MessageBubble from './message-bubble';

type ChatEntry = {
  id: string;
  role: 'assistant' | 'user' | string;
  content: string;
  createdAt?: string;
  metadata?: {
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
  messagesEndRef,
  onPromptSelect,
  onBubbleAction,
  onSaveResearch,
  savingResearchId,
  onResearchAction,
  activeResearchActionKey,
}: MessageThreadProps) {
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

      {isTyping ? (
        <div className="study-chat-typing">
          <span className="study-chat-typing__dots">
            <span />
            <span />
            <span />
          </span>
          <span className="study-chat-typing__label">{agentName} is typing…</span>
        </div>
      ) : null}

      <div ref={messagesEndRef} />
    </div>
  );
}
