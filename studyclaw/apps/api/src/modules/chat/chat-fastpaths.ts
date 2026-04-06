export type GoogleWorkspaceIntent =
  | { action: 'list_files'; kind: 'all' | 'docs' | 'sheets' | 'slides'; limit: number }
  | { action: 'list_gmail'; limit: number; query: string }
  | { action: 'send_gmail'; to: string; subject: string; bodyText: string }
  | { action: 'create_doc'; title: string; bodyText: string };

export function looksLikeReminderStatusQuestion(message: string) {
  const normalized = message.toLowerCase();
  if (!normalized.includes('reminder')) {
    return false;
  }

  return (
    /\b(why|where|when|didn'?t|did not|not get|did not get|didn't get|did not receive|didn't receive|missed)\b/.test(
      normalized
    ) || /\b(status|show|check|find)\b/.test(normalized)
  );
}

export function normalizeChatFailureMessage(messageText: string) {
  const normalized = messageText.trim();
  if (/OpenClaw error 500:/i.test(normalized) || /internal error/i.test(normalized) || /internal server error/i.test(normalized)) {
    return 'StudyClaw could not get a response from OpenClaw just now. Please try again.';
  }

  if (/timed out/i.test(normalized)) {
    return 'StudyClaw timed out waiting for OpenClaw. Please try again.';
  }

  return normalized || 'StudyClaw could not send this chat message right now.';
}

function parseGmailBodyInstruction(value: string) {
  const bodyMatch = value.match(/\b(?:body|just say|say|saying|and say)\b[\s:,-]*([\s\S]+)$/i);
  return bodyMatch?.[1]?.trim() ?? '';
}

function parseGmailSubjectInstruction(value: string) {
  const subjectMatch = value.match(/\bsubject\b[\s:,-]*["“]?([^"”\n]+?)["”]?(?=\s+\b(?:body|just say|say|saying|and say)\b|$)/i);
  if (!subjectMatch?.[1]) {
    return '';
  }

  const subject = subjectMatch[1].trim();
  if (/\b(?:empty|blank|none|no subject)\b/i.test(subject)) {
    return '';
  }

  return subject;
}

function parseSendGmailIntent(message: string): GoogleWorkspaceIntent | null {
  const baseMatch = message.match(
    /\b(?:send|write)\s+(?:an?\s+)?email\s+to\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})([\s\S]*)$/i
  );
  if (!baseMatch) {
    return null;
  }

  const to = baseMatch[1].trim();
  const remainder = (baseMatch[2] ?? '').trim();

  const strictMatch = remainder.match(/\bsubject\s+(.+?)\s+body\s+([\s\S]+)$/i);
  if (strictMatch) {
    return {
      action: 'send_gmail',
      to,
      subject: strictMatch[1].trim(),
      bodyText: strictMatch[2].trim(),
    };
  }

  const subjectShouldBeEmpty =
    /\b(?:leave|keep|make)\s+(?:the\s+)?subject\s+(?:empty|blank)\b/i.test(remainder) || /\bno\s+subject\b/i.test(remainder);
  const bodyText = parseGmailBodyInstruction(remainder);
  const subject = subjectShouldBeEmpty ? '' : parseGmailSubjectInstruction(remainder);

  if (!bodyText) {
    return null;
  }

  return {
    action: 'send_gmail',
    to,
    subject,
    bodyText,
  };
}

function parseFollowupSendGmailIntent(message: string, history: string | null | undefined): GoogleWorkspaceIntent | null {
  if (!history?.trim()) {
    return null;
  }

  if (!/\b(?:send|write)\b.*\b(?:them|it)?\b.*\b(?:another|one more)\b.*\b(?:email|message|one)\b/i.test(message)) {
    return null;
  }

  const bodyText = parseGmailBodyInstruction(message);
  if (!bodyText) {
    return null;
  }

  const historyLines = history
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();

  for (const line of historyLines) {
    const previousIntent = parseSendGmailIntent(line);
    if (!previousIntent) {
      continue;
    }

    if (previousIntent.action !== 'send_gmail') {
      continue;
    }

    return {
      action: 'send_gmail',
      to: previousIntent.to,
      subject: /\bsubject\b/i.test(message) ? parseGmailSubjectInstruction(message) : previousIntent.subject,
      bodyText,
    };
  }

  return null;
}

export function parseGoogleWorkspaceIntent(message: string, options?: { history?: string | null }): GoogleWorkspaceIntent | null {
  const normalized = message.trim();
  if (!normalized) {
    return null;
  }

  const createDocMatch = normalized.match(
    /\b(?:create|make|start)\s+(?:a\s+)?google doc(?:ument)?(?:\s+(?:called|named|titled)\s+["“]?([^"”]+)["”]?)?(?:\s+(?:about|with|for)\s+([\s\S]+))?/i
  );
  if (createDocMatch) {
    const title = createDocMatch[1]?.trim() || 'StudyClaw Notes';
    const bodyText = createDocMatch[2]?.trim() || '';
    return {
      action: 'create_doc',
      title,
      bodyText,
    };
  }

  const sendEmailIntent = parseSendGmailIntent(normalized);
  if (sendEmailIntent) {
    return sendEmailIntent;
  }

  const followupSendIntent = parseFollowupSendGmailIntent(normalized, options?.history);
  if (followupSendIntent) {
    return followupSendIntent;
  }

  if (/\b(gmail|email|mail|inbox|messages?)\b/i.test(normalized)) {
    if (/\b(show|list|find|open|recent|latest|unread|my email|my emails|my mail|inbox)\b/i.test(normalized)) {
      return {
        action: 'list_gmail',
        limit: 5,
        query: /\bunread\b/i.test(normalized) ? 'is:unread' : 'in:inbox',
      };
    }
  }

  if (!/\b(google|drive|docs?|sheets?|slides?)\b/i.test(normalized)) {
    return null;
  }

  if (!/\b(show|list|find|open|recent|latest|my files|my file|drive files|google drive)\b/i.test(normalized)) {
    return null;
  }

  const kind = /\bslides?\b/i.test(normalized)
    ? 'slides'
    : /\bsheets?\b/i.test(normalized)
      ? 'sheets'
      : /\bdocs?\b/i.test(normalized)
        ? 'docs'
        : 'all';

  return {
    action: 'list_files',
    kind,
    limit: 5,
  };
}

export function formatGoogleWorkspaceListLabel(kind: 'all' | 'docs' | 'sheets' | 'slides') {
  if (kind === 'docs') return 'Google Docs';
  if (kind === 'sheets') return 'Google Sheets';
  if (kind === 'slides') return 'Google Slides';
  return 'Google Drive files';
}

export function isRetryableChatFailure(messageText: string) {
  const normalized = messageText.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('internal error') ||
    normalized.includes('internal server error') ||
    normalized.includes('timed out') ||
    normalized.includes('gateway is draining') ||
    normalized.includes('temporarily unavailable') ||
    normalized.includes('openclaw error 500') ||
    normalized.includes('openclaw could not get a response')
  );
}
