export type ChatContextScope = 'minimal' | 'targeted' | 'full';

export type ChatRequestStrategy = {
  contextScope: ChatContextScope;
  historyLimit: number;
  simpleGreeting: boolean;
  fileListRequest: boolean;
  googleStatusRequest: boolean;
  calendarAgendaRequest: boolean;
};

export function looksLikeLibraryRequest(message: string, studyMode?: string | null) {
  if (studyMode === 'library') {
    return true;
  }

  const normalized = message.toLowerCase();
  return /\b(textbook|text book|book|edition|isbn|reading list|library|novel|author)\b/.test(normalized);
}

function looksLikeSimpleGreeting(message: string) {
  return /^(hey|hi|hello|yo|sup|what'?s up|good morning|good afternoon|good evening)[!. ]*$/i.test(message.trim());
}

function looksLikeWorkspaceFileRequest(message: string, studyMode?: string | null) {
  if (studyMode === 'library') {
    return /\b(my files|workspace files|documents|uploads|notes|backpack|library files)\b/i.test(message);
  }

  return /\b(show|list|open|what are)\b.*\b(my files|workspace files|documents|uploads|notes|backpack|library files)\b/i.test(message);
}

function looksLikeGoogleConnectionStatusRequest(message: string) {
  return (
    /\b(is|am|do|can)\b.*\b(google|gmail|calendar|drive|docs?|sheets?|slides?)\b.*\b(connect|connected|setup|linked|access|available|working|work|use|using)\b/i.test(
      message
    ) ||
    /\b(google|gmail|calendar|drive|docs?|sheets?|slides?)\b.*\b(connect|connected|setup|linked|access|permission|permissions|available|working|work|use|using)\b/i.test(
      message
    )
  );
}

function looksLikeCalendarAgendaRequest(message: string) {
  return /\b(agenda|calendar|events)\b/i.test(message) && /\b(today|tomorrow|week|upcoming|next|coming up|on my calendar)\b/i.test(message);
}

export function inferChatRequestStrategy(input: {
  message: string;
  studyMode?: string | null;
  hasAttachments: boolean;
}): ChatRequestStrategy {
  const normalized = input.message.trim();
  const simpleGreeting = looksLikeSimpleGreeting(normalized);
  const fileListRequest = looksLikeWorkspaceFileRequest(normalized, input.studyMode);
  const googleStatusRequest = looksLikeGoogleConnectionStatusRequest(normalized);
  const calendarAgendaRequest = looksLikeCalendarAgendaRequest(normalized);
  const targetedLookup =
    fileListRequest ||
    googleStatusRequest ||
    calendarAgendaRequest ||
    /calendar|schedule|class|period|teacher|room|grade|average|final|target score|reminder|deadline|due|google|drive|docs?|sheets?|slides?/i.test(
      normalized
    );
  const fullNeed =
    input.hasAttachments ||
    input.studyMode === 'plan' ||
    input.studyMode === 'research' ||
    input.studyMode === 'library' ||
    /\b(plan|essay|research|compare|analyze|study plan|revision|flashcards|project|outline|long answer)\b/i.test(normalized);

  if (simpleGreeting) {
    return {
      contextScope: 'minimal',
      historyLimit: 4,
      simpleGreeting,
      fileListRequest,
      googleStatusRequest,
      calendarAgendaRequest,
    };
  }

  if (fullNeed) {
    return {
      contextScope: 'full',
      historyLimit: 16,
      simpleGreeting,
      fileListRequest,
      googleStatusRequest,
      calendarAgendaRequest,
    };
  }

  if (targetedLookup || input.studyMode === 'quiz' || input.studyMode === 'explain') {
    return {
      contextScope: 'targeted',
      historyLimit: 8,
      simpleGreeting,
      fileListRequest,
      googleStatusRequest,
      calendarAgendaRequest,
    };
  }

  return {
    contextScope: 'targeted',
    historyLimit: 10,
    simpleGreeting,
    fileListRequest,
    googleStatusRequest,
    calendarAgendaRequest,
  };
}

export function getLocalApiBaseUrl() {
  return (process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
}

export function buildStreamingProgressMessages(input: {
  agentName: string;
  message: string;
  studyMode?: string | null;
  hasAttachments: boolean;
  strategy: ChatRequestStrategy;
}) {
  const normalized = input.message.trim();
  const initial = `${input.agentName} is thinking...`;

  if (input.hasAttachments) {
    return [initial, 'Reading your document...', 'Pulling together the best next explanation...'];
  }
  if (input.strategy.calendarAgendaRequest) {
    return [initial, 'Checking your Google Calendar...'];
  }
  if (/\b(send|write)\b.*\bemail\b/i.test(normalized)) {
    return [initial, 'Using Gmail tools...', 'Preparing that email through your connected Google account...'];
  }
  if (/\b(gmail|email|mail|inbox|messages?)\b/i.test(normalized)) {
    return [initial, 'Using Gmail tools...', 'Checking your inbox through StudyClaw...'];
  }
  if (/\b(drive|docs?|sheets?|slides?)\b/i.test(normalized)) {
    return [initial, 'Using Google Workspace tools...', 'Checking your connected Google files...'];
  }
  if (input.strategy.fileListRequest) {
    return [initial, 'Opening your workspace files...'];
  }
  if (input.strategy.googleStatusRequest) {
    return [initial, 'Checking your Google connection...', 'Verifying which Google tools are ready in StudyClaw...'];
  }
  if (/schedule|class|period|teacher|room|today|next class/i.test(normalized)) {
    return [initial, 'Opening your schedule...'];
  }
  if (/grade|average|final|target score|letter grade/i.test(normalized)) {
    return [initial, 'Loading current grades...'];
  }
  if (/reminder|deadline|due/i.test(normalized)) {
    return [initial, 'Checking reminders...'];
  }
  if (input.studyMode === 'library' || looksLikeLibraryRequest(normalized, input.studyMode)) {
    return [initial, 'Searching books...'];
  }
  if (input.studyMode === 'research') {
    return [initial, 'Checking live sources...'];
  }
  if (input.strategy.simpleGreeting) {
    return [initial];
  }

  return [initial, 'Pulling together the best next explanation...'];
}

export function buildStreamingHeartbeatMessage(input: {
  agentName: string;
  message: string;
  studyMode?: string | null;
  strategy: ChatRequestStrategy;
  tick: number;
}) {
  const normalized = input.message.trim();
  const isEvenTick = input.tick % 2 === 0;

  if (input.strategy.calendarAgendaRequest) {
    return isEvenTick ? 'Still checking your Google Calendar...' : 'Working through your upcoming events...';
  }
  if (/\b(send|write)\b.*\bemail\b/i.test(normalized)) {
    return isEvenTick ? 'Still using Gmail send tools...' : 'Sending through your connected Google account...';
  }
  if (/\b(gmail|email|mail|inbox|messages?)\b/i.test(normalized)) {
    return isEvenTick ? 'Still using Gmail tools...' : 'Checking your inbox through StudyClaw...';
  }
  if (/\b(drive|docs?|sheets?|slides?)\b/i.test(normalized)) {
    return isEvenTick ? 'Still using Google Workspace tools...' : 'Checking which connected Google files are available...';
  }
  if (input.strategy.fileListRequest) {
    return isEvenTick ? 'Still opening your workspace files...' : 'Checking what is ready in your library...';
  }
  if (input.strategy.googleStatusRequest) {
    return isEvenTick ? 'Still checking your Google connection...' : 'Verifying your Google tools are ready...';
  }
  if (/gmail|email|inbox|drive|docs?|sheets?|slides?/i.test(normalized)) {
    return isEvenTick ? 'Still using your Google Workspace tools...' : 'Checking what Google access is available...';
  }
  if (/schedule|class|period|teacher|room|today|next class/i.test(normalized)) {
    return isEvenTick ? 'Still opening your schedule...' : 'Checking the next class details...';
  }
  if (/grade|average|final|target score|letter grade/i.test(normalized)) {
    return isEvenTick ? 'Still loading current grades...' : 'Checking the numbers that matter most...';
  }
  if (/reminder|deadline|due/i.test(normalized)) {
    return isEvenTick ? 'Still checking reminders...' : 'Reviewing what is coming up next...';
  }
  if (input.studyMode === 'library' || looksLikeLibraryRequest(normalized, input.studyMode)) {
    return isEvenTick ? 'Still searching your books and documents...' : 'Checking what you can open next...';
  }
  if (input.studyMode === 'research') {
    return isEvenTick ? 'Still checking live sources...' : 'Pulling together the most useful source trail...';
  }
  if (input.strategy.simpleGreeting) {
    return `${input.agentName} is still with you...`;
  }

  return isEvenTick
    ? 'Still working through the next best answer...'
    : 'Using the right StudyClaw tools before I answer...';
}

export function createStreamChunkPlan(text: string) {
  const words = String(text ?? '').split(/(\s+)/).filter(Boolean);
  if (words.length <= 1) {
    return text ? [text] : [];
  }

  const chunks: string[] = [];
  let buffer = '';

  for (const word of words) {
    const next = `${buffer}${word}`;
    if (next.length >= 42 && buffer.trim()) {
      chunks.push(buffer);
      buffer = word;
      continue;
    }

    buffer = next;
  }

  if (buffer.trim()) {
    chunks.push(buffer);
  }

  return chunks;
}

export function normalizeAssistantIdentity(replyText: string, personaName: string) {
  const trimmedPersona = personaName.trim();
  if (!trimmedPersona || trimmedPersona === 'StudyClaw') {
    return replyText;
  }

  return replyText
    .replace(/\b(My name is|I(?:'| a)m)\s+StudyClaw\b/gi, (match, prefix: string) => `${prefix} ${trimmedPersona}`)
    .replace(/\bcall me\s+StudyClaw\b/gi, `call me ${trimmedPersona}`)
    .replace(/\bStudyClaw\b/g, trimmedPersona);
}

export function styleDeterministicAssistantReply(replyText: string, personaName: string) {
  const normalized = normalizeAssistantIdentity(replyText, personaName).trim();
  if (!normalized) {
    return normalized;
  }

  if (/^Dixie$/i.test(personaName.trim())) {
    if (/^(all right|alright|got it|clock'?s ticking|hey)/i.test(normalized)) {
      return normalized;
    }
    return `All right. ${normalized}`;
  }

  if (/^Willow$/i.test(personaName.trim())) {
    if (/^(let'?s|here we go|easy does it|hey)/i.test(normalized)) {
      return normalized;
    }
    return `Let’s take it step by step. ${normalized}`;
  }

  return normalized;
}
