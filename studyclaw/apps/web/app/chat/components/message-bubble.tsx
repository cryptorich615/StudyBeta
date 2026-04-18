import Link from 'next/link';

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
    researchUnavailable?: boolean;
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

type MessageBubbleProps = {
  entry: ChatEntry;
  agentName: string;
  onAction: (instruction: string) => void;
  onSaveResearch: (messageId: string) => void;
  savingResearchId: string | null;
  onResearchAction: (messageId: string, action: 'flashcards' | 'quiz' | 'plan') => void;
  activeResearchActionKey: string | null;
};

const assistantActions = [
  'Research this on the web.',
  'Turn this into flashcards.',
  'Turn this into a quiz.',
  'Simplify this.',
  'Explain this at a beginner level.',
];

function formatChatTimestamp(value?: string) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
    .format(parsed)
    .replace(' AM', ' am')
    .replace(' PM', ' pm');
}

export default function MessageBubble({
  entry,
  agentName,
  onAction,
  onSaveResearch,
  savingResearchId,
  onResearchAction,
  activeResearchActionKey,
}: MessageBubbleProps) {
  const isAssistant = entry.role === 'assistant';
  const researchResult = entry.metadata?.researchResult;
  const researchUnavailable = Boolean(entry.metadata?.researchUnavailable);
  const capabilityBadges = entry.metadata?.capabilityBadges ?? [];
  const attachments = entry.metadata?.attachments ?? [];
  const isSavingResearch = savingResearchId === entry.id;
  const alreadySaved = Boolean(researchResult?.savedToBackpack || researchResult?.savedAssetId);
  const sourceCount = researchResult?.sources.length ?? 0;
  const screenshots = researchResult?.screenshots?.length
    ? researchResult.screenshots
    : researchResult?.screenshotUrl
      ? [researchResult.screenshotUrl]
      : [];
  const checkedAtLabel =
    researchResult?.checkedAt
      ? new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(researchResult.checkedAt))
      : null;
  const currentResearchAction = activeResearchActionKey?.startsWith(`${entry.id}:`)
    ? activeResearchActionKey.split(':')[1]
    : null;
  const timestampLabel = formatChatTimestamp(entry.createdAt);

  return (
    <article className={isAssistant ? 'study-chat-bubble is-assistant' : 'study-chat-bubble is-user'}>
      <div className="study-chat-bubble__meta">
        <span>{isAssistant ? agentName : 'You'}</span>
        {timestampLabel ? <time className="study-chat-bubble__timestamp" dateTime={entry.createdAt}>{timestampLabel}</time> : null}
      </div>
      <div className="study-chat-bubble__content">{entry.content}</div>
      {!isAssistant && attachments.length ? (
        <div className="study-chat-bubble__capabilities">
          {attachments.map((attachment, index) => (
            <span key={`${entry.id}-attachment-${index}`} className="study-chat-bubble__capability">
              {attachment.sourceKind === 'native-file' ? 'Drive' : 'Attachment'}: {attachment.name}
            </span>
          ))}
        </div>
      ) : null}
      {isAssistant && researchResult ? (
        <section className="study-chat-research-card">
          <div className="study-chat-research-card__top">
            <div>
              <p className="study-chat-research-card__eyebrow">Research result</p>
              <h3>{researchResult.title}</h3>
              <p>{researchResult.summary}</p>
            </div>
            <button
              type="button"
              className="study-chat-research-card__save"
              onClick={() => onSaveResearch(entry.id)}
              disabled={alreadySaved || isSavingResearch}
            >
              {alreadySaved ? 'Saved to Backpack' : isSavingResearch ? 'Saving…' : 'Save to notes'}
            </button>
          </div>

          {researchResult.pageTitle || checkedAtLabel ? (
            <div className="study-chat-research-card__meta-row">
              {researchResult.pageTitle ? (
                <span className="study-chat-research-card__meta-pill">Page: {researchResult.pageTitle}</span>
              ) : null}
              {checkedAtLabel ? (
                <span className="study-chat-research-card__meta-pill">Checked {checkedAtLabel}</span>
              ) : null}
            </div>
          ) : null}

          {screenshots.length ? (
            <div className={screenshots.length > 1 ? 'study-chat-research-card__gallery' : 'study-chat-research-card__media'}>
              {screenshots.map((screenshot, index) => (
                <div
                  key={`${entry.id}-screenshot-${index}`}
                  className={screenshots.length > 1 ? 'study-chat-research-card__gallery-item' : 'study-chat-research-card__preview'}
                >
                  <img
                    src={screenshot}
                    alt={
                      screenshots.length > 1
                        ? `${researchResult.screenshotAlt || 'Research preview'} ${index + 1}`
                        : researchResult.screenshotAlt || 'Research preview'
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}

          <div className="study-chat-research-card__sources">
            <div className="study-chat-research-card__sources-header">
              <strong>Sources checked</strong>
              <span>{sourceCount} linked</span>
            </div>
            {researchResult.sources.length ? (
              <div className="study-chat-research-card__source-list">
                {researchResult.sources.map((source) => (
                  <a
                    key={source.url}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="study-chat-research-card__source"
                  >
                    <span className="study-chat-research-card__source-badge" aria-hidden="true">
                      {source.hostname.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="study-chat-research-card__source-copy">
                      <span>{source.label}</span>
                      <small>{source.hostname}</small>
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="study-chat-research-card__empty">No direct links were returned in this reply yet.</p>
            )}
          </div>

          <div className="study-chat-research-card__actions">
            <button
              type="button"
              className="study-chat-research-card__action"
              disabled={Boolean(currentResearchAction)}
              onClick={() => onResearchAction(entry.id, 'flashcards')}
            >
              {currentResearchAction === 'flashcards' ? 'Creating flashcards…' : 'Make flashcards'}
            </button>
            <button
              type="button"
              className="study-chat-research-card__action"
              disabled={Boolean(currentResearchAction)}
              onClick={() => onResearchAction(entry.id, 'quiz')}
            >
              {currentResearchAction === 'quiz' ? 'Creating quiz…' : 'Turn into quiz'}
            </button>
            <button
              type="button"
              className="study-chat-research-card__action is-secondary"
              disabled={Boolean(currentResearchAction)}
              onClick={() => onResearchAction(entry.id, 'plan')}
            >
              Use for study plan
            </button>
          </div>

          {researchResult.flashcardSetId || researchResult.quizId ? (
            <div className="study-chat-research-card__generated">
              <span>Created from this research</span>
              <div className="study-chat-research-card__generated-links">
                {researchResult.flashcardSetId ? (
                  <Link href={`/study?set=${encodeURIComponent(researchResult.flashcardSetId)}`} className="study-chat-research-card__open">
                    Open flashcards
                  </Link>
                ) : null}
                {researchResult.quizId ? (
                  <Link href={`/study?quiz=${encodeURIComponent(researchResult.quizId)}`} className="study-chat-research-card__open">
                    Open quiz
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}

          {researchResult.savedAssetId ? (
            <div className="study-chat-research-card__footer">
              <span>Saved in Backpack</span>
              <Link href={`/coach?assetId=${encodeURIComponent(researchResult.savedAssetId)}`} className="study-chat-research-card__open">
                Open in Backpack
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}
      {isAssistant && capabilityBadges.length ? (
        <div className="study-chat-bubble__capabilities">
          {capabilityBadges.map((badge) => (
            <span key={`${entry.id}-${badge.key}`} className="study-chat-bubble__capability">
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}
      {isAssistant && !researchUnavailable ? (
        <div className="study-chat-bubble__actions">
          {assistantActions.map((action) => (
            <button key={action} type="button" className="study-chat-bubble__action" onClick={() => onAction(action)}>
              {action}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}
