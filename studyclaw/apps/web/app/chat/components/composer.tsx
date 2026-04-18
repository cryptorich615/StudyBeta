import type { ChangeEvent, RefObject } from 'react';

type PendingDocument = {
  id: string;
  name: string;
  type: string;
};

type NativeDocument = {
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
  nativeDocuments: NativeDocument[];
  nativePickerOpen: boolean;
  commandOpen: boolean;
  matchingCommands: ComposerCommand[];
  defaultCommands: ComposerCommand[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  onChangeMessage: (value: string) => void;
  onSelectMode: (mode: string) => void;
  onToggleCommands: () => void;
  onToggleNativePicker: () => void;
  onSelectNativeDocument: (documentId: string) => void;
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

        <button type="button" className="study-chat-composer__toolbar-button is-secondary" onClick={props.onToggleNativePicker}>
          Use Drive file
        </button>
        <button type="button" className="study-chat-composer__toolbar-button is-secondary" onClick={props.onToggleCommands}>
          /
        </button>
      </div>

      {props.nativePickerOpen ? (
        <div className="study-chat-composer__menu">
          {props.nativeDocuments.length ? props.nativeDocuments.map((document) => (
            <button
              key={document.id}
              type="button"
              className="study-chat-composer__menu-item"
              onClick={() => props.onSelectNativeDocument(document.id)}
            >
              <strong>{document.name}</strong>
              <span>{document.type}</span>
            </button>
          )) : (
            <div className="study-chat-composer__menu-item">
              <strong>No StudyClaw files yet</strong>
              <span>Create a note, doc, or sheet in Drive first.</span>
            </div>
          )}
        </div>
      ) : null}

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
          placeholder="Ask a question, paste notes, switch to Research for live sources, or use Books mode when you want StudyClaw to find textbooks and editions."
          className="study-chat-composer__textarea"
        />

        <button type="button" onClick={props.onSend} disabled={props.sending} className="study-chat-composer__send">
          {props.sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </section>
  );
}
