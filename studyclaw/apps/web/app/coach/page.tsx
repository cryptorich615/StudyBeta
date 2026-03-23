'use client';

import Link from 'next/link';
import { type ChangeEvent, type Dispatch, type SetStateAction, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api';
import { readStoredSession } from '../../lib/session';
import StatusBanner from '../components/status-banner';

type UploadedAsset = {
  id: string;
  name: string;
  type: string;
  extractedText: string;
};

type KnowledgeItem = {
  id: string;
  title: string;
  detail: string;
  source_type: string;
  created_at: string;
};

const prompts = [
  'Summarize today’s notes into the key ideas.',
  'Summarize today’s notes into action steps.',
  'Summarize today’s notes into a study sprint.',
];

const slashCommands = [
  {
    name: '/new',
    description: 'Start a fresh conversation',
    run: async (helpers: CommandHelpers) => {
      helpers.setActiveThreadId(null);
      helpers.setMessages([]);
      helpers.setThreads((current) => current);
      helpers.setMessage('');
      helpers.setFeedback('Started a new chat. Send a message when you are ready.');
    },
  },
  {
    name: '/planner',
    description: 'Open the dashboard',
    run: async (helpers: CommandHelpers) => {
      helpers.router.push('/dashboard');
    },
  },
  {
    name: '/study',
    description: 'Open study tools',
    run: async (helpers: CommandHelpers) => {
      helpers.router.push('/study');
    },
  },
  {
    name: '/chat',
    description: 'Open the direct chat page',
    run: async (helpers: CommandHelpers) => {
      helpers.router.push('/chat');
    },
  },
  {
    name: '/settings',
    description: 'Open settings',
    run: async (helpers: CommandHelpers) => {
      helpers.router.push('/settings');
    },
  },
];

type CommandHelpers = {
  router: ReturnType<typeof useRouter>;
  setActiveThreadId: (value: string | null) => void;
  setMessages: (value: any[]) => void;
  setThreads: Dispatch<SetStateAction<any[]>>;
  setMessage: (value: string) => void;
  setFeedback: (value: string) => void;
};

function createAssetId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export default function CoachPage() {
  const router = useRouter();
  const isIntroFlow =
    typeof window !== 'undefined' &&
    (() => {
      const searchParams = new URLSearchParams(window.location.search);
      return searchParams.get('intro') === '1' || searchParams.get('bootstrap') === '1';
    })();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [threads, setThreads] = useState<any[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [feedback, setFeedback] = useState('');
  const [commandOpen, setCommandOpen] = useState(false);
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [coachTitle, setCoachTitle] = useState('Lecture note capture');
  const [coachText, setCoachText] = useState('');
  const [processing, setProcessing] = useState(false);
  const [coachSummary, setCoachSummary] = useState('');
  const [coachTranscript, setCoachTranscript] = useState('');
  const [actionItems, setActionItems] = useState<string[]>([]);
  const [knowledgeDrafts, setKnowledgeDrafts] = useState<Array<{ title: string; detail: string; kind: string }>>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);

  useEffect(() => {
    setHasSession(!!readStoredSession()?.user?.id);
  }, []);

  useEffect(() => {
    if (!hasSession) return;

    if (isIntroFlow) {
      void startBootstrapConversation();
    } else {
      void loadThreads();
    }

    void loadKnowledge();
  }, [hasSession, isIntroFlow]);

  async function loadKnowledge() {
    const response = await apiFetch('/api/coach/knowledge');
    const data = await response.json();
    if (response.ok) {
      setKnowledgeItems(data);
    }
  }

  const matchingCommands = message.trim().startsWith('/')
    ? slashCommands.filter((command) => command.name.startsWith(message.trim().toLowerCase()))
    : [];

  async function startBootstrapConversation() {
    const response = await apiFetch('/api/onboarding/bootstrap/start', { method: 'POST' });
    const data = await response.json();

    if (!response.ok) {
      setFeedback(data.message || 'Failed to start bootstrap conversation');
      return;
    }

    setThreads([data.thread]);
    setActiveThreadId(data.thread.id);
    setMessages(data.messages ?? []);
  }

  async function loadThreads(preferredThreadId?: string) {
    const res = await apiFetch('/api/chat/threads');
    const data = await res.json();

    if (!res.ok) {
      setFeedback(data.message || 'Failed to load threads');
      return;
    }

    setThreads(data);
    const nextThreadId = preferredThreadId ?? activeThreadId ?? data[0]?.id ?? null;

    if (nextThreadId) {
      await loadThread(nextThreadId);
    } else {
      setActiveThreadId(null);
      setMessages([]);
    }
  }

  async function loadThread(threadId: string) {
    const res = await apiFetch(`/api/chat/threads/${threadId}`);
    const data = await res.json();

    if (!res.ok) {
      setFeedback(data.message || 'Failed to load thread');
      return;
    }

    setActiveThreadId(threadId);
    setMessages(data.messages ?? []);
  }

  async function send() {
    if (!hasSession) {
      setFeedback('Sign in and complete onboarding before using the assistant.');
      return;
    }

    if (message.trim().startsWith('/')) {
      const selectedCommand = slashCommands.find((command) => command.name === message.trim().toLowerCase());
      if (!selectedCommand) {
        setFeedback('Unknown command.');
        return;
      }

      setSending(true);
      try {
        await selectedCommand.run({ router, setActiveThreadId, setMessages, setThreads, setMessage, setFeedback });
      } finally {
        setSending(false);
        setCommandOpen(false);
      }
      return;
    }

    if (!message.trim()) {
      setFeedback('Write a prompt or use a suggested prompt.');
      return;
    }

    setSending(true);
    setFeedback('');

    try {
      const res = await apiFetch('/api/chat/send', {
        method: 'POST',
        body: JSON.stringify({ threadId: activeThreadId, message }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to send message');
      }

      setMessage('');
      await loadThreads(data.threadId);
    } catch (error: any) {
      setFeedback(error.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  async function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    const nextAssets = await Promise.all(
      selectedFiles.map(async (file) => {
        let extractedText = '';
        if (file.type.startsWith('text/') || /\.(txt|md|json|csv)$/i.test(file.name)) {
          extractedText = await file.text();
        }

        return {
          id: createAssetId(file),
          name: file.name,
          type: file.type || 'application/octet-stream',
          extractedText,
        };
      })
    );

    setAssets((current) => [...current, ...nextAssets]);
    if (!coachText.trim()) {
      setCoachText(nextAssets.map((asset) => asset.extractedText).filter(Boolean).join('\n\n'));
    }
  }

  const coachPayloadText = useMemo(() => {
    const fromAssets = assets
      .map((asset) => asset.extractedText.trim())
      .filter(Boolean)
      .join('\n\n');

    return [fromAssets, coachText].filter(Boolean).join('\n\n').trim();
  }, [assets, coachText]);

  async function processCoachNotes() {
    if (!coachPayloadText) {
      setFeedback('Upload a note or add transcript/extracted text first.');
      return;
    }

    setProcessing(true);
    setFeedback('');

    try {
      const response = await apiFetch('/api/coach/process', {
        method: 'POST',
        body: JSON.stringify({
          title: coachTitle,
          text: coachPayloadText,
          sourceType: assets[0]?.type?.startsWith('audio/') ? 'audio' : assets[0]?.type?.startsWith('image/') ? 'photo' : 'document',
          attachments: assets.map((asset) => ({ name: asset.name, type: asset.type })),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to process note');
      }

      setCoachTranscript(data.transcript || '');
      setCoachSummary(data.summary || '');
      setActionItems(data.actionItems || []);
      setKnowledgeDrafts(data.knowledge || []);
    } catch (error: any) {
      setFeedback(error.message || 'Failed to process note');
    } finally {
      setProcessing(false);
    }
  }

  async function saveKnowledgeItem(item: { title: string; detail: string; kind: string }) {
    const response = await apiFetch('/api/coach/knowledge', {
      method: 'POST',
      body: JSON.stringify({
        title: item.title,
        detail: item.detail,
        sourceType: item.kind,
        metadata: {
          coachTitle,
          attachmentCount: assets.length,
        },
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setFeedback(data.message || 'Failed to save knowledge');
      return;
    }

    setKnowledgeItems((current) => [data, ...current]);
  }

  if (!hasSession) {
    return (
      <section className="hero-card">
        <p className="insight-chip">Backpack</p>
        <h1 className="hero-title">Sign in to use Backpack with your real study context.</h1>
        <p className="hero-description">Backpack is the note intake surface for text, files, photos, and audio.</p>
        <div className="actions">
          <Link href="/login" className="primary-link-button">Log in</Link>
          <Link href="/signup" className="ghost-button">Create account</Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="hero-card hero-card-featured">
        <div className="hero-copy">
          <p className="insight-chip">{isIntroFlow ? 'First-time Backpack' : 'Backpack workspace'}</p>
          <h1 className="hero-title">{isIntroFlow ? 'Meet your Backpack workflow.' : 'Drop in notes, files, photos, and audio, then turn them into something usable.'}</h1>
          <p className="hero-description">
            Backpack is the structured intake workspace. Upload material, attach transcripts or extracted text, summarize it,
            save the important logistics, and carry the cleaned result into one ongoing study conversation.
          </p>
        </div>
      </section>

      {feedback ? <StatusBanner tone="warning">{feedback}</StatusBanner> : null}
      {!assets.length ? (
        <StatusBanner tone="neutral">
          Automatic OCR and audio transcription are not wired in this workspace yet. Uploads are supported now, and you can attach transcript or extracted text for summarization.
        </StatusBanner>
      ) : null}

      <section className="coach-grid">
        <aside className="coach-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Note intake</p>
              <h2 className="section-title">Backpack intake</h2>
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="coach-title">Capture title</label>
            <input id="coach-title" value={coachTitle} onChange={(event) => setCoachTitle(event.target.value)} />
          </div>
          <div className="upload-zone">
            <input type="file" multiple onChange={handleFileInput} />
          </div>
          <div className="stack-list">
            {assets.map((asset) => (
              <article key={asset.id} className="stack-item">
                <div>
                  <strong>{asset.name}</strong>
                  <p className="muted-copy" style={{ margin: '4px 0 0' }}>{asset.type}</p>
                </div>
                <span className="settings-badge">{asset.extractedText ? 'text ready' : 'needs transcript'}</span>
              </article>
            ))}
          </div>
          <div className="form-field">
            <label htmlFor="coach-text">Transcript or extracted text</label>
            <textarea
              id="coach-text"
              value={coachText}
              onChange={(event) => setCoachText(event.target.value)}
              rows={10}
              placeholder="Paste OCR, transcript, or cleaned class notes here."
            />
          </div>
          <div className="actions">
            <button type="button" onClick={processCoachNotes} disabled={processing}>
              {processing ? 'Processing...' : 'Summarize Backpack'}
            </button>
          </div>

          {coachSummary ? (
            <div className="summary-card">
              <p className="eyebrow">Summary</p>
              <p className="muted-copy">{coachSummary}</p>
              <p className="eyebrow">Action items</p>
              <div className="timeline">
                {actionItems.map((item) => (
                  <div key={item} className="timeline-item">
                    <p className="muted-copy" style={{ margin: 0 }}>{item}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {knowledgeDrafts.length ? (
            <div className="summary-card">
              <p className="eyebrow">Add to knowledge</p>
              <div className="stack-list">
                {knowledgeDrafts.map((item) => (
                  <article key={`${item.title}-${item.detail}`} className="stack-item">
                    <div>
                      <strong>{item.title}</strong>
                      <p className="muted-copy" style={{ margin: '4px 0 0' }}>{item.detail}</p>
                    </div>
                    <button type="button" className="chat-mini-button" onClick={() => void saveKnowledgeItem(item)}>
                      Save
                    </button>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </aside>

        <div className="chat-main">
          <section className="backpack-room">
            <div className="chat-prompt-strip">
              {prompts.map((prompt) => (
                <button key={prompt} type="button" className="chat-prompt-chip" onClick={() => setMessage(prompt)}>
                  {prompt}
                </button>
              ))}
              {coachSummary ? (
                <button type="button" className="chat-prompt-chip" onClick={() => setMessage(`Use this note summary in your answer:\n${coachSummary}`)}>
                  Use latest summary
                </button>
              ) : null}
            </div>

            <div className="chat-room">
              <div className="chat-room-header">
                <div>
                  <p className="eyebrow">Backpack conversation</p>
                  <h3 style={{ margin: 0 }}>StudyClaw Backpack</h3>
                </div>
                <span className="chat-room-badge">{activeThreadId ? 'Ongoing' : 'Ready'}</span>
              </div>

              <div className="chat-messages">
                {messages.length ? (
                  messages.map((entry) => (
                    <div key={entry.id} className={entry.role === 'assistant' ? 'chat-bubble assistant' : 'chat-bubble user'}>
                      <strong>{entry.role === 'assistant' ? 'Backpack' : 'You'}</strong>
                      <div>{entry.content}</div>
                    </div>
                  ))
                ) : (
                  <div className="chat-empty-state">
                    <strong>No messages yet</strong>
                    <p>Upload material, process it, then ask Backpack for a plan, summary, or next study block.</p>
                  </div>
                )}
              </div>

              <div className="chat-composer">
                <div className="chat-composer-toolbar">
                  <button
                    type="button"
                    className="chat-mini-button"
                    onClick={() => {
                      setCommandOpen((current) => !current);
                      if (!message.trim()) setMessage('/');
                    }}
                  >
                    /
                  </button>
                  <span className="chat-composer-hint">Commands and note summaries can both seed the next prompt.</span>
                </div>

                {commandOpen || matchingCommands.length ? (
                  <div className="chat-command-menu">
                    {(matchingCommands.length ? matchingCommands : slashCommands).map((command) => (
                      <button
                        key={command.name}
                        type="button"
                        className="chat-command-item"
                        onClick={() => {
                          setMessage(command.name);
                          setCommandOpen(false);
                        }}
                      >
                        <strong>{command.name}</strong>
                        <span>{command.description}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="chat-composer-input">
                  <textarea
                    value={message}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setMessage(nextValue);
                      setCommandOpen(nextValue.trim().startsWith('/'));
                    }}
                    rows={4}
                    placeholder="Ask Backpack to summarize, organize, or turn this material into a study plan..."
                    className="chat-textarea"
                  />
                  <button onClick={send} disabled={sending} className="chat-send-button">
                    {sending ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </div>
            </div>

            <section className="secondary-card">
              <p className="eyebrow">Saved knowledge</p>
              <div className="stack-list">
                {knowledgeItems.slice(0, 4).map((item) => (
                  <article key={item.id} className="stack-item">
                    <div>
                      <strong>{item.title}</strong>
                      <p className="muted-copy" style={{ margin: '4px 0 0' }}>{item.detail}</p>
                    </div>
                  </article>
                ))}
                {!knowledgeItems.length ? <p className="muted-copy">Save knowledge to keep logistics and preferences reusable.</p> : null}
              </div>
            </section>
          </section>
        </div>
      </section>

      {coachTranscript ? (
        <section className="secondary-card">
          <p className="eyebrow">Transcript</p>
          <p className="muted-copy" style={{ whiteSpace: 'pre-wrap' }}>{coachTranscript}</p>
        </section>
      ) : null}
    </>
  );
}
