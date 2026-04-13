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
  const response = await apiFetch('/api/chat/send-stream', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!response.body) {
    throw new Error('Streaming is unavailable right now.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');

    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line) {
        onEvent(JSON.parse(line) as ChatStreamEvent);
      }

      newlineIndex = buffer.indexOf('\n');
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    onEvent(JSON.parse(trailing) as ChatStreamEvent);
  }
}
