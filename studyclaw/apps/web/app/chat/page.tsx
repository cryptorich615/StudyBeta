'use client';

import Link from 'next/link';
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api';
import { readStoredSession } from '../../lib/session';
import StatusBanner from '../components/status-banner';

type ModelOption = {
  key: string;
  name: string;
  provider: string;
  available: boolean;
};

type UserProfile = {
  name: string;
  school: string;
  graduationYear: number | null;
  major: string;
};

type CommandHelpers = {
  router: ReturnType<typeof useRouter>;
  setActiveThreadId: (value: string | null) => void;
  setMessages: (value: any[]) => void;
  setThreads: Dispatch<SetStateAction<any[]>>;
  setMessage: (value: string) => void;
  setFeedback: (value: string) => void;
  ensureModelsLoaded: () => Promise<void>;
  switchModel: (modelKey: string) => Promise<void>;
};

const prompts = [
  'What should I focus on first today?',
  'Turn my next exam into a study plan.',
  'Help me decide what can wait until tomorrow.',
];

const LAST_KNOWN_MODEL_KEY = 'studyclaw-last-model-key';
const LAST_KNOWN_AGENT_NAME = 'studyclaw-last-agent-name';

export default function ChatPage() {
  const router = useRouter();
  const isIntroFlow =
    typeof window !== 'undefined' &&
    (() => {
      const searchParams = new URLSearchParams(window.location.search);
      return searchParams.get('intro') === '1' || searchParams.get('bootstrap') === '1';
    })();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [hasSession, setHasSession] = useState(false);
  const [threads, setThreads] = useState<any[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [feedback, setFeedback] = useState('');
  const [commandOpen, setCommandOpen] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [currentModelKey, setCurrentModelKey] = useState('OpenRouter Auto');
  const [loadingModels, setLoadingModels] = useState(false);
  const [agentName, setAgentName] = useState('StudyClaw');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    setHasSession(!!readStoredSession()?.user?.id);
    if (typeof window === 'undefined') return;

    const lastModelKey = window.localStorage.getItem(LAST_KNOWN_MODEL_KEY);
    const lastAgentName = window.localStorage.getItem(LAST_KNOWN_AGENT_NAME);

    if (lastModelKey) {
      setCurrentModelKey(lastModelKey);
    }

    if (lastAgentName) {
      setAgentName(lastAgentName);
    }
  }, []);

  useEffect(() => {
    if (!hasSession) return;

    if (isIntroFlow) {
      void startBootstrapConversation();
    } else {
      void loadThreads();
    }

    void ensureModelsLoaded();
    void loadUserProfile();
  }, [hasSession, isIntroFlow]);

  useEffect(() => {
    if (!hasSession || isIntroFlow) return;
    if (threads.length || activeThreadId || messages.length) return;
    if (!userProfile?.name || !userProfile.school) return;

    setMessages([
      {
        id: 'first-session-welcome',
        role: 'assistant',
        content: `Hey ${userProfile.name}! I am ${agentName}, your study buddy. I am ready to help you crush your goals at ${userProfile.school}. What are we working on today?`,
      },
    ]);
  }, [activeThreadId, agentName, hasSession, isIntroFlow, messages.length, threads.length, userProfile]);

  
  // Auto-scroll to bottom when messages change or typing starts
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);
  const slashCommands = useMemo(() => ([
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
      name: '/coach',
      description: 'Open the Coach workspace',
      run: async (helpers: CommandHelpers) => {
        helpers.router.push('/coach');
      },
    },
    {
      name: '/settings',
      description: 'Open settings',
      run: async (helpers: CommandHelpers) => {
        helpers.router.push('/settings');
      },
    },
    {
      name: '/models',
      description: 'List available models',
      run: async (helpers: CommandHelpers) => {
        await helpers.ensureModelsLoaded();
        helpers.setFeedback('Use /model <key> to switch. Available models are shown in the slash-command menu.');
        helpers.setMessage('/model ');
      },
    },
  ]), []);

  const modelCommandItems = useMemo(() => {
    if (!message.trim().toLowerCase().startsWith('/model')) {
      return [];
    }

    return modelOptions.map((model) => ({
      name: `/model ${model.key}`,
      description: `${model.provider} · ${model.name}${model.key === currentModelKey ? ' · current' : ''}`,
    }));
  }, [currentModelKey, message, modelOptions]);

  const matchingCommands = useMemo(() => {
    const trimmed = message.trim().toLowerCase();
    if (!trimmed.startsWith('/')) {
      return [];
    }

    if (trimmed.startsWith('/model')) {
      return modelCommandItems.filter((command) => command.name.toLowerCase().startsWith(trimmed));
    }

    return slashCommands.filter((command) => command.name.startsWith(trimmed));
  }, [message, modelCommandItems, slashCommands]);

  async function ensureModelsLoaded() {
    if (loadingModels) return;

    setLoadingModels(true);
    try {
      const [optionsRes, statusRes] = await Promise.all([
        apiFetch('/api/onboarding/options'),
        apiFetch('/api/onboarding/status'),
      ]);
      const optionsData = await optionsRes.json();
      const statusData = await statusRes.json();

      if (optionsRes.ok) {
        const configuredProvider = statusData?.credentials?.providerId;
        const filtered = (optionsData.models ?? []).filter((model: ModelOption) => model.available || model.provider === configuredProvider);
        setModelOptions(filtered);
        const nextModelKey = statusData?.agent?.model_key ?? currentModelKey;
        const nextAgentName = statusData?.agent?.persona_name ?? agentName;

        setCurrentModelKey(nextModelKey);
        setAgentName(nextAgentName);

        if (typeof window !== 'undefined') {
          window.localStorage.setItem(LAST_KNOWN_MODEL_KEY, nextModelKey);
          window.localStorage.setItem(LAST_KNOWN_AGENT_NAME, nextAgentName);
        }
      }
    } finally {
      setLoadingModels(false);
    }
  }

  async function loadUserProfile() {
    const response = await apiFetch('/api/user/profile');
    const data = await response.json();

    if (!response.ok) {
      return;
    }

    setUserProfile(data.profile ?? null);
  }

  async function switchModel(modelKey: string) {
    const response = await apiFetch('/api/onboarding/model-config', {
      method: 'POST',
      body: JSON.stringify({ modelKey }),
    });
    const data = await response.json();

    if (!response.ok) {
      setFeedback(data.message || 'Failed to switch model');
      return;
    }

    setCurrentModelKey(modelKey);
    setFeedback(`Switched to ${modelKey}.`);
    setMessage('');
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LAST_KNOWN_MODEL_KEY, modelKey);
    }
  }

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
      setFeedback('Sign in and complete onboarding before using chat.');
      return;
    }

    const trimmed = message.trim();
    if (trimmed.startsWith('/model ')) {
      setSending(true);
      try {
        await switchModel(trimmed.replace('/model', '').trim());
      } finally {
        setSending(false);
        setCommandOpen(false);
      }
      return;
    }

    if (trimmed.startsWith('/')) {
      const selectedCommand = slashCommands.find((command) => command.name === trimmed.toLowerCase());
      if (!selectedCommand) {
        setFeedback('Unknown command.');
        return;
      }

      setSending(true);
      try {
        await selectedCommand.run({
          router,
          setActiveThreadId,
          setMessages,
          setThreads,
          setMessage,
          setFeedback,
          ensureModelsLoaded,
          switchModel,
        });
      } finally {
        setSending(false);
        setCommandOpen(false);
      }
      return;
    }

    if (!trimmed) {
      setFeedback('Write a prompt or use a suggested prompt.');
      return;
    }

    // Optimistically add user message immediately
    const userMsg = {
      id: `temp-${Date.now()}`,
      role: 'user' as const,
      content: trimmed,
    };
    setMessages((prev: any[]) => [...prev, userMsg]);
    setMessage('');
    setSending(true);
    setIsTyping(true);
    setFeedback('');

    // Scroll to bottom
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);

    try {
      const res = await apiFetch('/api/chat/send', {
        method: 'POST',
        body: JSON.stringify({ threadId: activeThreadId, message: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Remove optimistic message on error
        setMessages((prev: any[]) => prev.filter((m: any) => m.id !== userMsg.id));
        throw new Error(data.message || 'Failed to send message');
      }

      await loadThreads(data.threadId);
    } catch (error: any) {
      setFeedback(error.message || 'Failed to send message');
    } finally {
      setSending(false);
      setIsTyping(false);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }

  if (!hasSession) {
    return (
      <section className="hero-card">
        <p className="insight-chip">Chat</p>
        <h1 className="hero-title">Sign in to talk directly to your agent.</h1>
        <p className="hero-description">This page is the clean chat box surface. Coach handles uploads and organization separately.</p>
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
          <p className="insight-chip">Chat box</p>
          <h1 className="hero-title">Talk directly to the agent without the Coach workflow around it.</h1>
          <p className="hero-description">
            This is the clean conversation page between Backpack and Settings. Use slash commands to move fast, including model switching.
          </p>
        </div>
        <div className="hero-actions">
          <div className="metric-grid">
            <div className="metric-tile">
              <strong>{currentModelKey}</strong>
              <span>active model</span>
            </div>
            <div className="metric-tile">
              <strong>{modelOptions.length}</strong>
              <span>switchable models</span>
            </div>
          </div>
        </div>
      </section>

      {feedback ? <StatusBanner tone="warning">{feedback}</StatusBanner> : null}

      <section className="chat-main">
          <div className="chat-prompt-strip">
            {prompts.map((prompt) => (
              <button key={prompt} type="button" className="chat-prompt-chip" onClick={() => setMessage(prompt)}>
                {prompt}
              </button>
            ))}
            <button type="button" className="chat-prompt-chip" onClick={() => setMessage('/models')}>
              /models
            </button>
          </div>

          <div className="chat-room chat-room-sleek">
            <div className="chat-room-header chat-room-header-sleek">
              <div>
                <p className="eyebrow">Direct conversation</p>
                <h3 style={{ margin: 0 }}>StudyClaw Chat</h3>
                <p className="muted-copy" style={{ margin: '6px 0 0' }}>
                  Clean back-and-forth with your agent. Backpack handles note intake separately.
                </p>
              </div>
              <div className="chat-room-header-stack">
                <span className="chat-room-badge">{activeThreadId ? 'Thread active' : 'Ready'}</span>
                <span className="settings-badge">Model {currentModelKey}</span>
              </div>
            </div>

            <div className="chat-messages">
              {messages.length ? (
                messages.map((entry) => (
                  <div key={entry.id} className={entry.role === 'assistant' ? 'chat-bubble assistant' : 'chat-bubble user'}>
                    <strong>{entry.role === 'assistant' ? agentName : 'You'}</strong>
                    <div>{entry.content}</div>
                  </div>
                ))
              ) : (
                <div className="chat-empty-state">
                  <strong>No messages yet</strong>
                  <p>Start with a prompt, or use `/models` and `/model &lt;key&gt;` to switch the active model first.</p>
                </div>
              )}
            </div>

          {isTyping && (
            <div className="chat-typing-indicator">
              <span className="chat-typing-dots">
                <span /><span /><span />
              </span>
              <span className="chat-typing-label">{agentName} is typing…</span>
            </div>
          )}
          <div ref={messagesEndRef} />

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
                <span className="chat-composer-hint">Try `/models` then `/model openrouter/auto`.</span>
              </div>

              {commandOpen || matchingCommands.length ? (
                <div className="chat-command-menu">
                  {(matchingCommands.length ? matchingCommands : [...slashCommands, ...modelCommandItems]).map((command) => (
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
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      if (!sending) {
                        void send();
                      }
                    }
                  }}
                  rows={4}
                  placeholder="Message the agent or type / for commands..."
                  className="chat-textarea"
                />
                <button onClick={send} disabled={sending} className="chat-send-button">
                  {sending ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>
          </div>

          <section className="chat-bottom-bar">
            <div className="chat-bottom-header">
              <div>
                <p className="eyebrow">Conversations</p>
                <h3 style={{ margin: 0 }}>Threads</h3>
              </div>
              <button onClick={() => void loadThreads()} type="button" className="chat-mini-button">
                Refresh
              </button>
            </div>

            <div className="thread-ribbon">
              {threads.length ? (
                threads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => void loadThread(thread.id)}
                    className={thread.id === activeThreadId ? 'chat-thread-card active' : 'chat-thread-card'}
                  >
                    <strong>{thread.title || 'Untitled chat'}</strong>
                    <span>{new Date(thread.last_message_at).toLocaleString()}</span>
                  </button>
                ))
              ) : (
                <div className="chat-thread-empty">
                  <strong>No chats yet</strong>
                  <p>Your first direct conversation will appear here.</p>
                </div>
              )}
            </div>

            <div className="chat-command-box">
              <p className="eyebrow">Quick controls</p>
              <div className="chat-command-pills">
                {['/new', '/models', '/coach', '/settings'].map((command) => (
                  <button
                    key={command}
                    type="button"
                    className="chat-command-pill"
                    onClick={() => {
                      setMessage(command);
                      setCommandOpen(true);
                    }}
                  >
                    {command}
                  </button>
                ))}
                <Link href="/coach" className="chat-command-pill">Backpack</Link>
                <Link href="/settings" className="chat-command-pill">Settings</Link>
              </div>
            </div>
          </section>
      </section>
    </>
  );
}
