type StarterPrompt = {
  label: string;
  description: string;
  prompt: string;
  mode: string;
};

type StarterPromptsProps = {
  prompts: StarterPrompt[];
  onSelect: (prompt: StarterPrompt) => void;
};

export default function StarterPrompts({ prompts, onSelect }: StarterPromptsProps) {
  return (
    <section className="study-chat-starters" aria-label="Starter actions">
      {prompts.map((prompt) => (
        <button key={prompt.label} type="button" className="study-chat-starter" onClick={() => onSelect(prompt)}>
          <strong>{prompt.label}</strong>
          <span>{prompt.description}</span>
        </button>
      ))}
    </section>
  );
}
