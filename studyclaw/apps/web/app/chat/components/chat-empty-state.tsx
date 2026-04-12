type ChatEmptyStateProps = {
  agentName: string;
  onPromptSelect: (prompt: string) => void;
};

export default function ChatEmptyState({ agentName, onPromptSelect }: ChatEmptyStateProps) {
  return (
    <div className="study-chat-empty">
      <div className="study-chat-empty__badge">Start here</div>
      <h2>Ask a homework question, paste notes, or start a study plan.</h2>
      <p>{agentName} is ready to explain a topic, quiz you, or turn class notes into something easier to review.</p>
      <div className="study-chat-empty__actions">
        {[
          'Explain photosynthesis like I am reviewing for a quiz.',
          'Quiz me on my biology notes.',
          'Help me make a study plan for this week.',
        ].map((prompt) => (
          <button key={prompt} type="button" className="study-chat-empty__chip" onClick={() => onPromptSelect(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
