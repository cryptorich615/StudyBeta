import { getApiErrorMessage, readApiPayload, resolveApiUrl } from './api';
import { readStoredSession } from './session';

export type ChatStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'thread'; threadId: string }
  | { type: 'assistant_start'; createdAt?: string }
  | { type: 'assistant_delta'; delta: string }
  | { type: 'assistant_final'; payload: Record<string, unknown> | null }
  | { type: 'pending'; threadId?: string | null; message?: string }
  | { type: 'error'; message: string };

function getChatStreamUrl() {
  if (typeof window !== 'undefined') {
    // Keep browser streaming same-origin so Vercel can proxy to the backend safely.
    return '/api/chat/stream';
  }

  return resolveApiUrl('/api/chat/stream');
}

function debugChatStream(message: string, details?: Record<string, unknown>) {
  if (typeof window === 'undefined') {
    return;
  }

  if (details) {
    console.debug(`[chat-stream] ${message}`, details);
    return;
  }

  console.debug(`[chat-stream] ${message}`);
}

function extractDeltaText(parsed: any) {
  if (typeof parsed?.delta === 'string' && parsed.delta) {
    return parsed.delta;
  }

  if (typeof parsed?.text === 'string' && parsed.text) {
    return parsed.text;
  }

  if (typeof parsed?.part?.text === 'string' && parsed.part.text) {
    return parsed.part.text;
  }

  if (typeof parsed?.item?.content?.[0]?.text === 'string' && parsed.item.content[0].text) {
    return parsed.item.content[0].text;
  }

  return '';
}

function extractFinalText(parsed: any, accumulatedText: string) {
  if (accumulatedText.trim()) {
    return accumulatedText;
  }

  const outputs = Array.isArray(parsed?.response?.output) ? parsed.response.output : [];
  const parts = outputs.flatMap((output: any) => (Array.isArray(output?.content) ? output.content : []));
  const texts = parts
    .map((part: any) => {
      if (typeof part?.text === 'string') return part.text;
      if (typeof part?.output_text === 'string') return part.output_text;
      return '';
    })
    .filter(Boolean);

  return texts.join('');
}

function stripSyntheticOpenClawSuffix(text: string) {
  return text.replace(/\s*No response from OpenClaw\.\s*$/i, '').trimEnd();
}

export async function streamChatRequest(
  body: Record<string, unknown>,
  onEvent: (event: ChatStreamEvent) => void,
) {
  const session = readStoredSession();
  const headers = new Headers({
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  });

  if (session?.accessToken) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
  }

  const streamUrl = getChatStreamUrl();
  debugChatStream('opening stream', { url: streamUrl });

  const response = await fetch(streamUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  debugChatStream('received response headers', {
    status: response.status,
    contentType: response.headers.get('content-type'),
  });

  if (!response.ok) {
    const payload = await readApiPayload(response);
    debugChatStream('non-ok response', { status: response.status, payload });
    throw new Error(getApiErrorMessage(payload, `Chat stream failed with status ${response.status}`));
  }

  if (!response.body) {
    throw new Error('Streaming is unavailable right now.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulatedText = '';
  let pendingThreadId: string | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Split on SSE line boundaries
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      // Skip SSE "event:" meta-lines — only process "data:" lines
      if (line.startsWith('event:')) continue;
      if (!line.startsWith('data:')) continue;

      const json = line.slice(5).trim();
      if (!json || json === '[DONE]') continue;

      try {
        const parsed = JSON.parse(json);
        debugChatStream('parsed event', { type: parsed?.type ?? 'unknown' });

        if (parsed.type === 'pending') {
          pendingThreadId = parsed.threadId ?? pendingThreadId;
          onEvent({
            type: 'pending',
            threadId: pendingThreadId,
            message: typeof parsed.message === 'string' ? parsed.message : undefined,
          });

        } else if (parsed.type === 'response.created') {
          pendingThreadId = parsed.threadId ?? pendingThreadId ?? null;
          onEvent({ type: 'pending', threadId: pendingThreadId });

        } else if (
          parsed.type === 'response.content_part.added' ||
          parsed.type === 'response.output_text.delta' ||
          parsed.type === 'response.output_text.done'
        ) {
          const text = extractDeltaText(parsed);
          if (text) {
            accumulatedText += text;
            onEvent({ type: 'assistant_delta', delta: text });
          }

        } else if (parsed.type === 'response.output_item.added') {
          onEvent({ type: 'assistant_start', createdAt: new Date().toISOString() });

        } else if (parsed.type === 'response.completed') {
          const finalText = stripSyntheticOpenClawSuffix(extractFinalText(parsed, accumulatedText));
          // Build the final payload from accumulated text + threadId
          const payload: Record<string, unknown> = {
            assistantMessage: finalText,
            threadId: pendingThreadId,
          };
          onEvent({ type: 'assistant_final', payload });

        } else if (parsed.type === 'response.failed') {
          onEvent({ type: 'error', message: parsed.response?.status_details?.error ?? 'Response failed' });

        } else if (parsed.type === 'error' || parsed.error) {
          onEvent({ type: 'error', message: parsed.error ?? 'Unknown error' });
        }
      } catch (error) {
        debugChatStream('failed to parse event line', {
          line: json,
          error: error instanceof Error ? error.message : 'unknown',
        });
        // Skip unparseable data lines
      }
    }
  }

  // Process any remaining buffer
  if (buffer) {
    const line = buffer.trim();
    if (line && line.startsWith('data:')) {
      const json = line.slice(5).trim();
      if (json && json !== '[DONE]') {
        try {
          const parsed = JSON.parse(json);
          if (
            parsed.type === 'response.content_part.added' ||
            parsed.type === 'response.output_text.delta' ||
            parsed.type === 'response.output_text.done'
          ) {
            const text = extractDeltaText(parsed);
            if (text) onEvent({ type: 'assistant_delta', delta: text });
          }
        } catch { /* skip */ }
      }
    }
  }

  if (accumulatedText.trim()) {
    const finalText = stripSyntheticOpenClawSuffix(accumulatedText);
    debugChatStream('stream closed without explicit completion event, finalizing from accumulated text', {
      length: finalText.length,
    });
    onEvent({
      type: 'assistant_final',
      payload: {
        assistantMessage: finalText,
        threadId: pendingThreadId,
      },
    });
  }
}
