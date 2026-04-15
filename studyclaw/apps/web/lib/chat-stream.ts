import { apiFetch } from './api';

export type ChatStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'thread'; threadId: string }
  | { type: 'assistant_start'; createdAt?: string }
  | { type: 'assistant_delta'; delta: string }
  | { type: 'assistant_final'; payload: Record<string, unknown> | null }
  | { type: 'pending'; threadId?: string | null; message?: string }
  | { type: 'error'; message: string };

export async function streamChatRequest(
  body: Record<string, unknown>,
  onEvent: (event: ChatStreamEvent) => void,
) {
  const response = await apiFetch('/api/chat/stream', {
    method: 'POST',
    body: JSON.stringify(body),
  });

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

        if (parsed.type === 'response.created') {
          pendingThreadId = parsed.threadId ?? null;
          onEvent({ type: 'pending', threadId: pendingThreadId });

        } else if (parsed.type === 'response.content_part.added') {
          const text = parsed.item?.content?.[0]?.text ?? '';
          if (text) {
            accumulatedText += text;
            onEvent({ type: 'assistant_delta', delta: text });
          }

        } else if (parsed.type === 'response.output_item.added') {
          onEvent({ type: 'assistant_start', createdAt: new Date().toISOString() });

        } else if (parsed.type === 'response.completed') {
          // Build the final payload from accumulated text + threadId
          const payload: Record<string, unknown> = {
            assistantMessage: accumulatedText,
            threadId: pendingThreadId,
          };
          onEvent({ type: 'assistant_final', payload });

        } else if (parsed.type === 'error' || parsed.error) {
          onEvent({ type: 'error', message: parsed.error ?? 'Unknown error' });
        }
      } catch {
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
          if (parsed.type === 'response.content_part.added') {
            const text = parsed.item?.content?.[0]?.text ?? '';
            if (text) onEvent({ type: 'assistant_delta', delta: text });
          }
        } catch { /* skip */ }
      }
    }
  }
}
