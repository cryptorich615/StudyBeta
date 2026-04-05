'use client';

import Link from 'next/link';
import { type ChangeEvent, type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, getApiErrorMessage, readApiPayload } from '../../lib/api';
import { extractDocumentText } from '../../lib/document-text';
import { readStoredSession } from '../../lib/session';
import GenerationStatusCard, { type GenerationStatus } from '../components/generation-status-card';
import StatusBanner from '../components/status-banner';
import ChatLayout from './components/chat-layout';
import ChatSidebar from './components/chat-sidebar';
import ChatHeader from './components/chat-header';
import StarterPrompts from './components/starter-prompts';
import MessageThread from './components/message-thread';
import Composer from './components/composer';

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

type PendingDocument = {
  id: string;
  name: string;
  type: string;
  extractedText: string;
};

type ChatThread = {
  id: string;
  title?: string | null;
  last_message_at: string;
};

type ChatMessage = {
  id: string;
  role: 'assistant' | 'user' | string;
  content: string;
  createdAt?: string;
  metadata?: {
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

type CommandHelpers = {
  router: ReturnType<typeof useRouter>;
  setActiveThreadId: (value: string | null) => void;
  setMessages: (value: ChatMessage[]) => void;
  setThreads: Dispatch<SetStateAction<ChatThread[]>>;
  setMessage: (value: string) => void;
  setFeedback: (value: string) => void;
  ensureModelsLoaded: () => Promise<void>;
  switchModel: (modelKey: string) => Promise<void>;
};

type StudyMode = 'general' | 'explain' | 'quiz' | 'plan' | 'flashcards' | 'research' | 'library';

const studyModes: Array<{ key: StudyMode; label: string }> = [
  { key: 'general', label: 'Study chat' },
  { key: 'explain', label: 'Explain' },
  { key: 'quiz', label: 'Quiz me' },
  { key: 'plan', label: 'Study plan' },
  { key: 'flashcards', label: 'Flashcards' },
  { key: 'research', label: 'Research' },
  { key: 'library', label: 'Books' },
];

const starterPrompts = [
  {
    label: 'Explain a concept',
    description: 'Break down something confusing in plain language.',
    prompt: 'Explain this concept clearly and step by step:',
    mode: 'explain' as StudyMode,
  },
  {
    label: 'Quiz me on this',
    description: 'Turn what I know into a quick practice round.',
    prompt: 'Quiz me on this topic and wait for my answers:',
    mode: 'quiz' as StudyMode,
  },
  {
    label: 'Make a study plan',
    description: 'Organize the next few days into something realistic.',
    prompt: 'Help me build a study plan for this:',
    mode: 'plan' as StudyMode,
  },
  {
    label: 'Turn notes into flashcards',
    description: 'Pull the key terms and ideas into review prompts.',
    prompt: 'Turn these notes into flashcards:',
    mode: 'flashcards' as StudyMode,
  },
  {
    label: 'Research this on the web',
    description: 'Open the browser tool, verify sources, and bring back the answer.',
    prompt: 'Research this on the web, verify it carefully, and show me what you found:',
    mode: 'research' as StudyMode,
  },
  {
    label: 'Find a textbook',
    description: 'Search books and textbooks first before broader web research.',
    prompt: 'Find the best textbook or book for this class topic:',
    mode: 'library' as StudyMode,
  },
  {
    label: 'Tutor me step by step',
    description: 'Use the deeper tutoring workflow with examples and misconceptions.',
    prompt: 'Tutor me step by step on this topic and explain it in more than one way:',
    mode: 'general' as StudyMode,
  },
  {
    label: 'Optimize my study habits',
    description: 'Use my real schedule and workload to improve consistency.',
    prompt: 'Help me improve my study habits using my real classes, workload, and weak areas:',
    mode: 'general' as StudyMode,
  },
  {
    label: 'Build a revision plan',
    description: 'Create a focused revision schedule for an exam or weak topic set.',
    prompt: 'Build me a revision plan for this exam, deadline, or weak-topic list:',
    mode: 'plan' as StudyMode,
  },
  {
    label: 'Study this course smarter',
    description: 'Use my grades, schedule, and weak areas for one class.',
    prompt: 'Help me study this specific course using my saved data and weak areas:',
    mode: 'general' as StudyMode,
  },
];

const capabilityDefinitions = {
  research: {
    label: 'Browser research',
    summary: 'Browses the web, checks sources, and brings back screenshots or verified answers.',
    actionLabel: 'Use research',
    modeTitle: 'Browser research',
    modeSummary: 'Searches live sources, verifies facts, and returns explicit source-backed results.',
  },
  flashcards: {
    label: 'Study tool builder',
    summary: 'Turns notes or research into flashcards and quizzes you can edit in Study Library.',
    actionLabel: 'Make study set',
    modeTitle: 'Study tool builder',
    modeSummary: 'Transforms notes into flashcards or quizzes using your current study context.',
  },
  plan: {
    label: 'Planning assistant',
    summary: 'Builds realistic study plans from deadlines, reminders, and what you are working on.',
    actionLabel: 'Plan next steps',
    modeTitle: 'Planning assistant',
    modeSummary: 'Uses your workload and context to map out practical next study steps.',
  },
  coach: {
    label: 'Backpack workflow',
    summary: 'Uses uploaded notes and saved material to organize, summarize, and create follow-up work.',
    actionLabel: 'Open Backpack',
    modeTitle: 'Backpack workflow',
    modeSummary: 'Works from uploaded notes, summaries, and saved material instead of only chat context.',
  },
  library: {
    label: 'Student library',
    summary: 'Finds textbooks, editions, subject books, and easier alternatives using Open Library first.',
    actionLabel: 'Find textbooks',
    modeTitle: 'Student library',
    modeSummary: 'Checks Open Library first for textbooks, subject books, editions, and cover-backed book details.',
  },
  tutor: {
    label: 'Adaptive tutor',
    summary: 'Explains concepts in multiple ways, gives examples, and works from your weak areas.',
    actionLabel: 'Start tutoring',
    modeTitle: 'Adaptive tutor',
    modeSummary: 'Uses your notes and performance patterns to teach step by step instead of giving one-size-fits-all answers.',
  },
  revision: {
    label: 'Exam and revision',
    summary: 'Builds revision plans and exam prep from your real deadlines, weak topics, and available time.',
    actionLabel: 'Plan revision',
    modeTitle: 'Exam and revision',
    modeSummary: 'Turns exams, weak areas, and deadlines into realistic review plans and short prep sprints.',
  },
  habits: {
    label: 'Study habits',
    summary: 'Optimizes routines, focus, and study consistency using your actual classes and workload.',
    actionLabel: 'Improve habits',
    modeTitle: 'Study habits',
    modeSummary: 'Uses your saved workload and schedule to improve consistency instead of giving generic productivity tips.',
  },
} as const;

const slashCommands = [
  {
    name: '/new',
    description: 'Start a fresh study session',
  },
  {
    name: '/planner',
    description: 'Open the dashboard',
  },
  {
    name: '/study',
    description: 'Open flashcards and quizzes',
  },
  {
    name: '/coach',
    description: 'Open Backpack',
  },
  {
    name: '/settings',
    description: 'Open settings',
  },
  {
    name: '/models',
    description: 'List available models',
  },
  {
    name: '/research',
    description: 'Switch into web research mode',
  },
  {
    name: '/library',
    description: 'Switch into textbook and book lookup mode',
  },
];

const LAST_KNOWN_MODEL_KEY = 'studyclaw-last-model-key';
const LAST_KNOWN_AGENT_NAME = 'studyclaw-last-agent-name';
const CHAT_DRAFT_KEY = 'studyclaw-chat-draft';

function createDocumentId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function countRecentSessions(threads: ChatThread[]) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return threads.filter((thread) => new Date(thread.last_message_at).getTime() >= weekAgo).length;
}

function countStudyStreak(threads: ChatThread[]) {
  const days = Array.from(
    new Set(
      threads.map((thread) =>
        new Date(thread.last_message_at).toISOString().slice(0, 10)
      )
    )
  ).sort((left, right) => right.localeCompare(left));

  let streak = 0;
  for (let offset = 0; offset < days.length; offset += 1) {
    const expected = new Date();
    expected.setUTCDate(expected.getUTCDate() - offset);
    const expectedKey = expected.toISOString().slice(0, 10);
    if (days.includes(expectedKey)) {
      streak += 1;
    } else {
      break;
    }
  }

  return streak;
}

function buildPromptForMode(mode: StudyMode, prompt: string, hasAttachments: boolean) {
  const trimmed = prompt.trim();
  if (!trimmed && !hasAttachments) {
    return '';
  }

  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  const modePrefixes: Record<StudyMode, string> = {
    general: '',
    explain: 'Explain this clearly and step by step: ',
    quiz: 'Quiz me on this and wait for my answers: ',
    plan: 'Build me a focused study plan for this: ',
    flashcards: 'Turn this into strong study flashcards: ',
    research:
      'Use the browser tool to research this carefully, verify the answer from the web, include direct source links, mention the sources you checked, and summarize what matters for a student: ',
    library:
      'Use the Open Library tools first to find the best textbooks, books, editions, subject matches, and easier alternatives for this request. Include cover or Open Library links when useful: ',
  };

  if (!trimmed && hasAttachments) {
    if (mode === 'flashcards') {
      return 'Turn the attached notes into flashcards with concise fronts and clear backs.';
    }
    if (mode === 'quiz') {
      return 'Use the attached notes to quiz me on the most important ideas.';
    }
    if (mode === 'plan') {
      return 'Use the attached notes to help me make a study plan.';
    }
    if (mode === 'research') {
      return 'Use the browser tool to research the attached notes or question, verify the answer from reliable sources, and summarize what matters most.';
    }
    return 'Summarize the attached notes and pull out the key study points.';
  }

  return `${modePrefixes[mode]}${trimmed}`.trim();
}

function normalizeChatMessage(message: any): ChatMessage {
  const metadata = (message?.metadata_json ?? message?.metadata ?? {}) as ChatMessage['metadata'];
  return {
    id: String(message?.id ?? `message-${Date.now()}`),
    role: String(message?.role ?? 'assistant'),
    content: String(message?.content ?? ''),
    createdAt:
      typeof message?.created_at === 'string' && message.created_at.trim()
        ? message.created_at
        : typeof message?.createdAt === 'string' && message.createdAt.trim()
          ? message.createdAt
          : undefined,
    metadata,
  };
}

function getChatFeedbackTone(message: string): 'neutral' | 'warning' {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return 'neutral';
  }

  if (
    normalized.includes('still working on that response') ||
    normalized.includes('timed out waiting for openclaw') ||
    normalized.includes('could not get a response from openclaw') ||
    normalized.includes('internal server error')
  ) {
    return 'neutral';
  }

  return /failed|error|sign in|required|malformed|not available|not found/i.test(normalized) ? 'warning' : 'neutral';
}

function buildResearchActionText(entry: ChatMessage) {
  const researchResult = entry.metadata?.researchResult;
  const sourcesText = researchResult?.sources?.length
    ? `Sources checked:\n${researchResult.sources.map((source) => `- ${source.label}: ${source.url}`).join('\n')}`
    : '';

  return [
    researchResult?.title ? `Topic: ${researchResult.title}` : '',
    researchResult?.summary ? `Summary:\n${researchResult.summary}` : '',
    entry.content ? `Research notes:\n${entry.content}` : '',
    sourcesText,
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function normalizeChatThread(thread: any): ChatThread | null {
  const id = typeof thread?.id === 'string' ? thread.id.trim() : '';
  if (!id) {
    return null;
  }

  const lastMessageAt =
    typeof thread?.last_message_at === 'string' && thread.last_message_at.trim()
      ? thread.last_message_at
      : new Date().toISOString();

  return {
    id,
    title: typeof thread?.title === 'string' ? thread.title : null,
    last_message_at: lastMessageAt,
  };
}

export default function ChatPage() {
  const router = useRouter();
  const [isIntroFlow, setIsIntroFlow] = useState(false);

  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [feedback, setFeedback] = useState('');
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [currentModelKey, setCurrentModelKey] = useState('OpenRouter Auto');
  const [loadingModels, setLoadingModels] = useState(false);
  const [agentName, setAgentName] = useState('StudyClaw');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocument[]>([]);
  const [studyMode, setStudyMode] = useState<StudyMode>('general');
  const [savingResearchId, setSavingResearchId] = useState<string | null>(null);
  const [activeResearchActionKey, setActiveResearchActionKey] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(-1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHasSession(!!readStoredSession()?.user?.id);
    if (typeof window === 'undefined') return;

    const searchParams = new URLSearchParams(window.location.search);
    setIsIntroFlow(searchParams.get('intro') === '1' || searchParams.get('bootstrap') === '1');

    const lastModelKey = window.localStorage.getItem(LAST_KNOWN_MODEL_KEY);
    const lastAgentName = window.localStorage.getItem(LAST_KNOWN_AGENT_NAME);

    if (lastModelKey) {
      setCurrentModelKey(lastModelKey);
    }

    if (lastAgentName) {
      setAgentName(lastAgentName);
    }

    const draft = window.localStorage.getItem(CHAT_DRAFT_KEY);
    if (draft) {
      try {
        const parsed = JSON.parse(draft) as { message?: string; mode?: StudyMode };
        if (parsed.message) {
          setMessage(parsed.message);
        }
        if (parsed.mode && ['general', 'explain', 'quiz', 'plan', 'flashcards', 'research', 'library'].includes(parsed.mode)) {
          setStudyMode(parsed.mode);
        }
      } catch {
        // ignore malformed carry-over drafts
      }
      window.localStorage.removeItem(CHAT_DRAFT_KEY);
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
        content: `Hey ${userProfile.name}. I’m ${agentName}, and I’m ready to help with ${userProfile.school}. Tell me what class, topic, or deadline you want to work on first.`,
      },
    ]);
  }, [activeThreadId, agentName, hasSession, isIntroFlow, messages.length, threads.length, userProfile]);

  useEffect(() => {
    if (prevMsgCountRef.current === -1) {
      prevMsgCountRef.current = messages.length;
      return;
    }

    if (messages.length > prevMsgCountRef.current || isTyping) {
      prevMsgCountRef.current = messages.length;
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    prevMsgCountRef.current = messages.length;
  }, [messages, isTyping]);

  useEffect(() => {
    if (!hasSession || !activeThreadId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (!sending) {
        void loadThread(activeThreadId);
        void loadThreads(activeThreadId);
      }
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [activeThreadId, hasSession, sending]);

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
  }, [message, modelCommandItems]);

  const weeklySessions = useMemo(() => countRecentSessions(threads), [threads]);
  const studyStreak = useMemo(() => countStudyStreak(threads), [threads]);
  const activeModeCapability =
    studyMode === 'research'
      ? capabilityDefinitions.research
      : studyMode === 'flashcards' || studyMode === 'quiz'
        ? capabilityDefinitions.flashcards
        : studyMode === 'plan'
          ? capabilityDefinitions.plan
          : studyMode === 'library'
            ? capabilityDefinitions.library
          : {
              label: 'Study chat',
              summary: 'Explains, quizzes, and works from your study profile, reminders, and current thread.',
              actionLabel: 'Start chatting',
              modeTitle: 'Study chat',
              modeSummary: 'Uses your study profile, reminders, and current thread to tutor and guide you.',
            };

  function handleCapabilityAction(capabilityKey: string) {
    if (capabilityKey === 'coach') {
      router.push('/coach');
      return;
    }

    if (capabilityKey === 'research') {
      setStudyMode('research');
      setMessage('Research this on the web and show me the best sources:');
      setFeedback('Research mode is ready. Ask a web question and StudyClaw will use browser-backed research.');
      return;
    }

    if (capabilityKey === 'flashcards') {
      setStudyMode('flashcards');
      setMessage('Turn this into flashcards:');
      setFeedback('Flashcard mode is ready. Paste notes or ask StudyClaw to turn material into a study set.');
      return;
    }

    if (capabilityKey === 'plan') {
      setStudyMode('plan');
      setMessage('Help me build a realistic study plan for this:');
      setFeedback('Planning mode is ready. Give StudyClaw a deadline, class, or workload to organize.');
      return;
    }

    if (capabilityKey === 'library') {
      setStudyMode('library');
      setMessage('Find the best textbook or book for this topic:');
      setFeedback('Book mode is ready. Ask for a textbook, edition comparison, or subject reading list.');
      return;
    }

    if (capabilityKey === 'tutor') {
      setStudyMode('general');
      setMessage('Tutor me step by step on this and explain it in multiple ways:');
      setFeedback('Tutor mode is ready. Ask for a concept, worked example, or misconception breakdown.');
      return;
    }

    if (capabilityKey === 'revision') {
      setStudyMode('plan');
      setMessage('Build me a revision plan for this exam or weak-topic list:');
      setFeedback('Revision planning is ready. Give StudyClaw an exam, deadline, or weak-topic list.');
      return;
    }

    if (capabilityKey === 'habits') {
      setStudyMode('general');
      setMessage('Help me improve my study habits using my real schedule and workload:');
      setFeedback('Habit optimization is ready. Ask about procrastination, focus, consistency, or burnout.');
    }
  }

  async function ensureModelsLoaded() {
    if (loadingModels) return;

    setLoadingModels(true);
    try {
      const [optionsRes, statusRes] = await Promise.all([
        apiFetch('/api/onboarding/options'),
        apiFetch('/api/onboarding/status'),
      ]);
      const [optionsData, statusData] = await Promise.all([
        readApiPayload(optionsRes),
        readApiPayload(statusRes),
      ]);

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
    const data = await readApiPayload(response);

    if (!response.ok) {
      return;
    }

    setUserProfile(data.profile ?? null);
  }

  async function handleDocumentInput(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (!selectedFiles.length) {
      return;
    }

    const nextDocuments = await Promise.all(
      selectedFiles.map(async (file) => ({
        id: createDocumentId(file),
        name: file.name,
        type: file.type || 'application/octet-stream',
        extractedText: await extractDocumentText(file),
      }))
    );

    const readyDocuments = nextDocuments.filter((document) => document.extractedText.trim());
    const skippedCount = nextDocuments.length - readyDocuments.length;

    if (readyDocuments.length) {
      setPendingDocuments((current) => [...current, ...readyDocuments]);
      setFeedback(
        skippedCount
          ? `Uploaded ${readyDocuments.length} text-based note${readyDocuments.length === 1 ? '' : 's'}. ${skippedCount} file${skippedCount === 1 ? '' : 's'} still need pasted text first.`
          : `Uploaded ${readyDocuments.length} note${readyDocuments.length === 1 ? '' : 's'} and ready to use.`
      );
    } else {
      setFeedback('Only text-based notes are ready here right now. For PDFs or DOCX, paste extracted text first.');
    }

    event.target.value = '';
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
    const data = await readApiPayload(response);

    if (!response.ok) {
      setFeedback(getApiErrorMessage(data, 'Failed to start bootstrap conversation'));
      return;
    }

    const normalizedThread = normalizeChatThread(data.thread);
    if (!normalizedThread) {
      setFeedback('Bootstrap chat started, but the initial thread was malformed.');
      return;
    }

    setThreads([normalizedThread]);
    setActiveThreadId(normalizedThread.id);
    setMessages((data.messages ?? []).map(normalizeChatMessage));
  }

  async function loadThreads(preferredThreadId?: string) {
    const res = await apiFetch('/api/chat/threads');
    const data = await readApiPayload(res);

    if (!res.ok) {
      setFeedback(getApiErrorMessage(data, 'Failed to load recent study sessions'));
      return;
    }

    const normalizedThreads = Array.isArray(data)
      ? data.map(normalizeChatThread).filter((thread): thread is ChatThread => Boolean(thread))
      : [];

    setThreads(normalizedThreads);
    const nextThreadId = preferredThreadId ?? activeThreadId ?? normalizedThreads[0]?.id ?? null;

    if (nextThreadId) {
      await loadThread(nextThreadId);
    } else {
      setActiveThreadId(null);
      setMessages([]);
    }
  }

  async function loadThread(threadId: string) {
    const res = await apiFetch(`/api/chat/threads/${threadId}`);
    const data = await readApiPayload(res);

    if (!res.ok) {
      setFeedback(getApiErrorMessage(data, 'Failed to load study session'));
      return;
    }

    setActiveThreadId(threadId);
    setMessages((data.messages ?? []).map(normalizeChatMessage));
  }

  async function waitForAssistantReply(threadId: string, baselineMessageCount: number) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 22_000) {
      await new Promise((resolve) => setTimeout(resolve, 1_800));

      const res = await apiFetch(`/api/chat/threads/${threadId}`);
      const data = await readApiPayload(res);
      if (!res.ok) {
        continue;
      }

      const nextMessages = (data.messages ?? []).map(normalizeChatMessage);
      const lastMessage = nextMessages.at(-1);
      const hasFreshAssistantReply = nextMessages.length >= baselineMessageCount + 2 && lastMessage?.role === 'assistant';

      if (!hasFreshAssistantReply) {
        continue;
      }

      setActiveThreadId(threadId);
      setMessages(nextMessages);
      void loadThreads(threadId).catch(() => undefined);
      return true;
    }

    return false;
  }

  async function saveResearchToNotes(messageId: string) {
    if (!activeThreadId) {
      setFeedback('Open a saved study session first so this research has somewhere to save from.');
      return;
    }

    setSavingResearchId(messageId);
    setFeedback('');

    try {
      const response = await apiFetch('/api/chat/research-note', {
        method: 'POST',
        body: JSON.stringify({
          threadId: activeThreadId,
          messageId,
        }),
      });
      const data = await readApiPayload(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'Failed to save research to notes'));
      }

      setMessages((current) =>
        current.map((entry) =>
          entry.id === messageId
            ? {
                ...entry,
                metadata: entry.metadata?.researchResult
                  ? {
                      ...entry.metadata,
                      researchResult: {
                        ...entry.metadata.researchResult,
                        savedToBackpack: true,
                        savedAssetId: data.assetId ?? entry.metadata.researchResult.savedAssetId ?? null,
                      },
                    }
                  : entry.metadata,
              }
            : entry
        )
      );
      setFeedback(data.message || 'Saved to Backpack.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Failed to save research to notes');
    } finally {
      setSavingResearchId(null);
    }
  }

  async function handleResearchAction(messageId: string, action: 'flashcards' | 'quiz' | 'plan') {
    const entry = messages.find((item) => item.id === messageId);
    const researchResult = entry?.metadata?.researchResult;

    if (!entry || !researchResult) {
      setFeedback('That research result is no longer available.');
      return;
    }

    if (action === 'plan') {
      setStudyMode('plan');
      setMessage(`Build me a realistic study plan from this research:\n\n${buildResearchActionText(entry)}`);
      setFeedback('Loaded this research into the study-plan composer.');
      return;
    }

    const actionKey = `${messageId}:${action}`;
    if (activeResearchActionKey === actionKey) {
      return;
    }
    setActiveResearchActionKey(actionKey);
    setFeedback('');
    setGenerationStatus({
      tone: 'neutral',
      title: action === 'flashcards' ? 'Creating flashcards from this research' : 'Creating a quiz from this research',
      detail: 'OpenClaw is using your current study model to turn this research into a study asset.',
    });

    try {
      const response = await apiFetch(action === 'flashcards' ? '/api/study/flashcards' : '/api/study/quiz', {
        method: 'POST',
        body: JSON.stringify({
          title: action === 'flashcards' ? researchResult.title : `${researchResult.title} Quiz`,
          text: buildResearchActionText(entry),
          sourceAssetId: researchResult.savedAssetId ?? undefined,
          ...(action === 'quiz' ? { questionCount: 6 } : {}),
        }),
      });
      const data = await readApiPayload(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, `Failed to create ${action === 'flashcards' ? 'flashcards' : 'quiz'}`));
      }

      setMessages((current) =>
        current.map((item) =>
          item.id === messageId && item.metadata?.researchResult
            ? {
                ...item,
                metadata: {
                  ...item.metadata,
                  researchResult: {
                    ...item.metadata.researchResult,
                    ...(action === 'flashcards'
                      ? { flashcardSetId: data.flashcardSetId ?? item.metadata.researchResult.flashcardSetId ?? null }
                      : { quizId: data.quizId ?? item.metadata.researchResult.quizId ?? null }),
                  },
                },
              }
            : item
        )
      );

      setFeedback(
        action === 'flashcards'
          ? `Created ${data.cards?.length ?? 0} flashcards from this research.`
          : `Created ${data.questions?.length ?? 0} quiz questions from this research.`
      );
      setGenerationStatus({
        tone: 'success',
        title: action === 'flashcards' ? 'Flashcards created from this research' : 'Quiz created from this research',
        detail:
          action === 'flashcards'
            ? 'This research has been turned into a study set and saved in your Study Library.'
            : 'This research has been turned into a quiz and saved in your Study Library.',
        kind: action,
        providerLabel: data.generation?.providerLabel ?? null,
        modelKey: data.generation?.modelKey ?? null,
        countLabel:
          action === 'flashcards'
            ? `${data.generation?.itemCount ?? data.cards?.length ?? 0} cards`
            : `${data.generation?.itemCount ?? data.questions?.length ?? 0} questions`,
        href:
          action === 'flashcards' && data.flashcardSetId
            ? `/study?set=${encodeURIComponent(data.flashcardSetId)}`
            : action === 'quiz' && data.quizId
              ? `/study?quiz=${encodeURIComponent(data.quizId)}`
              : '/study',
        ctaLabel: action === 'flashcards' ? 'Open flashcards' : 'Open quiz',
      });
      router.push(
        action === 'flashcards' && data.flashcardSetId
          ? `/study?set=${encodeURIComponent(data.flashcardSetId)}`
          : action === 'quiz' && data.quizId
            ? `/study?quiz=${encodeURIComponent(data.quizId)}`
            : '/study'
      );
    } catch (error) {
      setGenerationStatus({
        tone: 'warning',
        title: action === 'flashcards' ? 'Flashcards were not created' : 'Quiz was not created',
        detail:
          error instanceof Error
            ? error.message
            : `Failed to create ${action === 'flashcards' ? 'flashcards' : 'quiz'}`,
      });
      setFeedback(
        error instanceof Error
          ? error.message
          : `Failed to create ${action === 'flashcards' ? 'flashcards' : 'quiz'}`
      );
    } finally {
      setActiveResearchActionKey(null);
    }
  }

  async function runSlashCommand(trimmed: string) {
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

    const commandImplementations = new Map<string, (helpers: CommandHelpers) => Promise<void>>([
      [
        '/new',
        async (helpers) => {
          helpers.setActiveThreadId(null);
          helpers.setMessages([]);
          helpers.setThreads((current) => current);
          helpers.setMessage('');
          helpers.setFeedback('Started a fresh study chat.');
        },
      ],
      ['/planner', async (helpers) => helpers.router.push('/dashboard')],
      ['/study', async (helpers) => helpers.router.push('/study')],
      ['/coach', async (helpers) => helpers.router.push('/coach')],
      ['/settings', async (helpers) => helpers.router.push('/settings')],
      [
        '/research',
        async (helpers) => {
          setStudyMode('research');
          helpers.setFeedback('Research mode is on. Ask a web question and StudyClaw will use browser-based research when needed.');
          helpers.setMessage('');
        },
      ],
      [
        '/library',
        async (helpers) => {
          setStudyMode('library');
          helpers.setFeedback('Book mode is on. Ask for a textbook, subject book list, or edition comparison.');
          helpers.setMessage('');
        },
      ],
      [
        '/models',
        async (helpers) => {
          await helpers.ensureModelsLoaded();
          helpers.setFeedback('Use /model <key> to switch. Available options are listed in the command menu.');
          helpers.setMessage('/model ');
        },
      ],
    ]);

    const selectedCommand = commandImplementations.get(trimmed.toLowerCase());
    if (!selectedCommand) {
      setFeedback('Unknown shortcut.');
      return;
    }

    setSending(true);
    try {
      await selectedCommand({
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
  }

  async function send() {
    if (!hasSession) {
      setFeedback('Sign in and finish setup before using study chat.');
      return;
    }

    const trimmed = message.trim();
    if (trimmed.startsWith('/')) {
      await runSlashCommand(trimmed);
      return;
    }

    const effectivePrompt = buildPromptForMode(studyMode, trimmed, pendingDocuments.length > 0);
    if (!effectivePrompt && !pendingDocuments.length) {
      setFeedback('Write a question, paste notes, or upload something to work from.');
      return;
    }

    const attachmentLabel = pendingDocuments.length
      ? `Uploaded ${pendingDocuments.length} note${pendingDocuments.length === 1 ? '' : 's'}: ${pendingDocuments.map((document) => document.name).join(', ')}`
      : '';

    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: [effectivePrompt, attachmentLabel].filter(Boolean).join('\n\n'),
      createdAt: new Date().toISOString(),
    };
    const baselineMessageCount = messages.length;
    const persistedUserMessage: ChatMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: userMsg.content,
      createdAt: userMsg.createdAt,
    };

    setMessages((prev) => [...prev, userMsg]);
    setMessage('');
    setSending(true);
    setIsTyping(true);
    setFeedback('');

    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);

    try {
      const res = await apiFetch('/api/chat/send', {
        method: 'POST',
        body: JSON.stringify({
          threadId: activeThreadId,
          message: effectivePrompt,
          studyMode,
          attachments: pendingDocuments.map((document) => ({
            name: document.name,
            type: document.type,
            extractedText: document.extractedText,
          })),
        }),
      });
      const data = await readApiPayload(res);
      if (res.status === 202 || data?.pending) {
        setPendingDocuments([]);
        const pendingThreadId = typeof data?.threadId === 'string' ? data.threadId : activeThreadId;
        if (pendingThreadId) {
          setActiveThreadId(pendingThreadId);
        }
        setMessages((prev) => [...prev.filter((m) => m.id !== userMsg.id), persistedUserMessage]);
        setFeedback(
          typeof data?.message === 'string' && data.message.trim()
            ? data.message
            : 'Still working on that response. It should appear in the chat shortly.'
        );

        if (pendingThreadId) {
          const resolved = await waitForAssistantReply(pendingThreadId, baselineMessageCount);
          if (resolved) {
            setFeedback('');
          }
        }
        return;
      }
      if (!res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
        throw new Error(getApiErrorMessage(data, 'Failed to send message'));
      }

      setPendingDocuments([]);
      const nextThreadId = typeof data?.threadId === 'string' ? data.threadId : activeThreadId;
      if (nextThreadId) {
        setActiveThreadId(nextThreadId);
      }

      if (typeof data?.assistantMessage === 'string' && data.assistantMessage.trim()) {
        const normalizedAssistantEntry =
          data?.assistantEntry && typeof data.assistantEntry === 'object'
            ? normalizeChatMessage(data.assistantEntry)
            : {
                id: `local-assistant-${Date.now() + 1}`,
                role: 'assistant',
                content: data.assistantMessage,
                createdAt: new Date().toISOString(),
              };
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== userMsg.id),
          persistedUserMessage,
          normalizedAssistantEntry,
        ]);
      } else {
        await loadThreads(nextThreadId ?? undefined);
      }

      void loadThreads(nextThreadId ?? undefined).catch(() => undefined);
    } catch (error: unknown) {
      const nextMessage = error instanceof Error ? error.message : 'Failed to send message';
      const shouldWaitForReply =
        activeThreadId && /internal error|internal server error|timed out|could not get a response/i.test(nextMessage);
      if (shouldWaitForReply) {
        setMessages((prev) => [...prev.filter((m) => m.id !== userMsg.id), persistedUserMessage]);
        setFeedback('Still working on that response. It should appear in the chat shortly.');
        const resolved = await waitForAssistantReply(activeThreadId, baselineMessageCount);
        if (resolved) {
          setFeedback('');
        }
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
        setFeedback(nextMessage);
      }
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
        <p className="insight-chip">Study chat</p>
        <h1 className="hero-title">Sign in to start your study chat.</h1>
        <p className="hero-description">This space is built for questions, quick explanations, study plans, and note-based review.</p>
        <div className="actions">
          <Link href="/login" className="primary-link-button">Log in</Link>
          <Link href="/signup" className="ghost-button">Create account</Link>
        </div>
      </section>
    );
  }

  return (
    <>
      {generationStatus ? <GenerationStatusCard status={generationStatus} /> : null}
      {feedback ? <StatusBanner tone={getChatFeedbackTone(feedback)}>{feedback}</StatusBanner> : null}

      <ChatLayout
        sidebar={
          <ChatSidebar
            userName={userProfile?.name || 'Study session'}
            schoolName={userProfile?.school || 'Your workspace is ready.'}
            currentModelKey={currentModelKey}
            sessionCount={threads.length}
            weeklySessions={weeklySessions}
            streakDays={studyStreak}
            pendingNotes={pendingDocuments.length}
            studyModes={studyModes}
            selectedStudyMode={studyMode}
            onSelectStudyMode={(mode) => setStudyMode(mode as StudyMode)}
            threads={threads}
            activeThreadId={activeThreadId}
            onSelectThread={(threadId) => void loadThread(threadId)}
            onNewChat={() => {
              setActiveThreadId(null);
              setMessages([]);
              setFeedback('Started a fresh study chat.');
            }}
            capabilities={[
              {
                key: 'research',
                ...capabilityDefinitions.research,
                active: studyMode === 'research',
              },
              {
                key: 'flashcards',
                ...capabilityDefinitions.flashcards,
                active: studyMode === 'flashcards' || studyMode === 'quiz',
              },
              {
                key: 'plan',
                ...capabilityDefinitions.plan,
                active: studyMode === 'plan',
              },
              {
                key: 'library',
                ...capabilityDefinitions.library,
                active: studyMode === 'library',
              },
              {
                key: 'tutor',
                ...capabilityDefinitions.tutor,
              },
              {
                key: 'revision',
                ...capabilityDefinitions.revision,
              },
              {
                key: 'habits',
                ...capabilityDefinitions.habits,
              },
              {
                key: 'coach',
                ...capabilityDefinitions.coach,
              },
            ]}
            onCapabilityAction={handleCapabilityAction}
          />
        }
        header={
          <div className="study-chat-top">
            <ChatHeader
              agentName={agentName}
              currentModelKey={currentModelKey}
              activeThreadId={activeThreadId}
              selectedStudyMode={studyMode}
              modeTitle={activeModeCapability.modeTitle}
              modeSummary={activeModeCapability.modeSummary}
            />
            <StarterPrompts
              prompts={starterPrompts}
              onSelect={(prompt) => {
                setStudyMode(prompt.mode as StudyMode);
                setMessage(prompt.prompt);
              }}
            />
          </div>
        }
        thread={
          <MessageThread
            messages={messages}
            isTyping={isTyping}
            agentName={agentName}
            messagesEndRef={messagesEndRef}
            onPromptSelect={(prompt) => setMessage(prompt)}
            onBubbleAction={(instruction) => setMessage(instruction)}
            onSaveResearch={(messageId) => void saveResearchToNotes(messageId)}
            savingResearchId={savingResearchId}
            onResearchAction={(messageId, action) => void handleResearchAction(messageId, action)}
            activeResearchActionKey={activeResearchActionKey}
          />
        }
        composer={
          <Composer
            message={message}
            sending={sending}
            studyMode={studyMode}
            studyModes={studyModes}
            pendingDocuments={pendingDocuments.map((document) => ({
              id: document.id,
              name: document.name,
              type: document.type,
            }))}
            commandOpen={commandOpen}
            matchingCommands={matchingCommands}
            defaultCommands={[...slashCommands, ...modelCommandItems]}
            fileInputRef={fileInputRef}
            onChangeMessage={(nextValue) => {
              setMessage(nextValue);
              setCommandOpen(nextValue.trim().startsWith('/'));
            }}
            onSelectMode={(mode) => setStudyMode(mode as StudyMode)}
            onToggleCommands={() => {
              setCommandOpen((current) => !current);
              if (!message.trim()) {
                setMessage('/');
              }
            }}
            onSelectCommand={(command) => {
              setMessage(command);
              setCommandOpen(false);
            }}
            onFileChange={handleDocumentInput}
            onSend={() => void send()}
          />
        }
      />
    </>
  );
}
