/**
 * Client-side streaming helper for chat.
 * Wraps the SSE endpoint /api/chat/stream and emits typed events to a callback.
 */

export type ChatStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'thread'; threadId: string }
  | { type: 'pending'; threadId?: string }
  | { type: 'assistant_start'; createdAt?: string }
  | { type: 'assistant_delta'; delta: string }
  | { type: 'done' };

export type ChatStreamConfig = {
  threadId: string | null;
  message: string;
  studyMode?: string;
  attachments?: Array<{ name: string; type: string; extractedText: string }>;
};

export function streamChatRequest(
  config: ChatStreamConfig,
  onEvent: (event: ChatStreamEvent) => void
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const response = await fetch(
        `${window.location.origin}/api/chat/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('studyclaw-user') ? JSON.parse(localStorage.getItem('studyclaw-user')!).accessToken : ''}`,
          },
          body: JSON.stringify({
            threadId: config.threadId,
            message: config.message,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Request failed' }));
        reject(new Error(err.message || 'Request failed'));
        return;
      }

      if (!response.body) {
        reject(new Error('No response body'));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr || dataStr === '[DONE]') continue;

          let event: ChatStreamEvent;
          try {
            const parsed = JSON.parse(dataStr);

            // Map SSE event types to ChatStreamEvent
            switch (parsed.type) {
              case 'response.content_part.added':
                event = { type: 'assistant_delta', delta: parsed.item?.content?.[0]?.text ?? '' };
                break;
              case 'response.output_item.added':
                event = { type: 'assistant_start', createdAt: parsed.item?.createdAt };
                break;
              case 'response.completed':
                event = { type: 'done' };
                break;
              case 'response.created':
                event = { type: 'pending', threadId: parsed.response?.id };
                break;
              default:
                continue;
            }
          } catch {
            continue;
          }

          onEvent(event);
        }
      }

      onEvent({ type: 'done' });
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}
