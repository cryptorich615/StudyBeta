import type { ChangeEvent, RefObject } from 'react';

type PendingDocument = {
  id: string;
  name: string;
  type: string;
};

type ComposerCommand = {
  name: string;
  description: string;
};

type ComposerProps = {
  message: string;
  sending: boolean;
  studyMode: string;
  studyModes: Array<{ key: string; label: string }>;
  pendingDocuments: PendingDocument[];
  commandOpen: boolean;
  matchingCommands: ComposerCommand[];
  defaultCommands: ComposerCommand[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  onChangeMessage: (value: string) => void;
  onSelectMode: (mode: string) => void;
  onToggleCommands: () => void;
  onSelectCommand: (command: string) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSend: () => void;
};

export default function Composer(props: ComposerProps) {
  return (
    <section className="study-chat-composer">
      <div className="study-chat-composer__topbar">
        <button
          type="button"
          className="study-chat-composer__toolbar-button"
          onClick={() => props.fileInputRef.current?.click()}
        >
          Upload notes
        </button>
        <input
          ref={props.fileInputRef}
          type="file"
          accept=".txt,.md,.markdown,.csv,.json,.log,text/*"
          multiple
          hidden
          onChange={props.onFileChange}
        />

        <button type="button" className="study-chat-composer__toolbar-button is-secondary" onClick={props.onToggleCommands}>
          /
        </button>
      </div>

      <div className="study-chat-composer__modes" role="tablist" aria-label="Study mode">
        {props.studyModes.map((mode) => (
          <button
            key={mode.key}
            type="button"
            className={mode.key === props.studyMode ? 'study-chat-composer__mode is-active' : 'study-chat-composer__mode'}
            onClick={() => props.onSelectMode(mode.key)}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {props.commandOpen || props.matchingCommands.length ? (
        <div className="study-chat-composer__menu">
          {(props.matchingCommands.length ? props.matchingCommands : props.defaultCommands).map((command) => (
            <button
              key={command.name}
              type="button"
              className="study-chat-composer__menu-item"
              onClick={() => props.onSelectCommand(command.name)}
            >
              <strong>{command.name}</strong>
              <span>{command.description}</span>
            </button>
          ))}
        </div>
      ) : null}

      {props.pendingDocuments.length ? (
        <div className="study-chat-composer__attachments">
          {props.pendingDocuments.map((document) => (
            <div key={document.id} className="study-chat-composer__attachment">
              <strong>{document.name}</strong>
              <span>{document.type} ready</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="study-chat-composer__input-wrap">
        <textarea
          value={props.message}
          onChange={(event) => props.onChangeMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (!props.sending) {
                props.onSend();
              }
            }
          }}
          rows={4}
          placeholder="Ask a question, paste notes, or switch to Research mode when you want StudyClaw to browse and verify the answer."
          className="study-chat-composer__textarea"
        />

        <button type="button" onClick={props.onSend} disabled={props.sending} className="study-chat-composer__send">
          {props.sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </section>
  );
}
