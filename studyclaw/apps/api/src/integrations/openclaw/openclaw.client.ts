export type OpenClawSendMessageInput = {
  agentId?: string;
  instructions?: string;
  sessionId?: string;
  message: string;
  model?: string;
  metadata?: Record<string, unknown>;
  userId?: string;
};

export type OpenClawSendMessageResult = {
  sessionId: string;
  text: string;
  raw: unknown;
};

export class OpenClawClient {
  constructor(
    private readonly baseUrl = process.env.OPENCLAW_BASE_URL ?? 'http://localhost:18789',
    private readonly token = process.env.OPENCLAW_GATEWAY_TOKEN ?? '',
    private readonly defaultModel = process.env.OPENCLAW_DEFAULT_MODEL ?? 'openrouter/auto'
  ) {}

  async sendMessage(input: OpenClawSendMessageInput): Promise<OpenClawSendMessageResult> {
    if (!this.token) {
      throw new Error('Missing OPENCLAW_GATEWAY_TOKEN');
    }

    const response = await fetch(`${this.baseUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(input.agentId ? { 'X-OpenClaw-Agent-Id': input.agentId } : {}),
      },
      body: JSON.stringify({
        model: input.model ?? this.defaultModel,
        instructions: input.instructions,
        input: input.message,
        user: input.userId,
        metadata: {
          ...input.metadata,
            sessionId: input.sessionId,
        },
      }),
    });

    const rawText = await response.text();
    let data: any = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = { rawText };
    }

    if (!response.ok) {
      const message = data?.error?.message ?? rawText ?? 'Unknown OpenClaw error';
      throw new Error(`OpenClaw error ${response.status}: ${message}`);
    }

    const text = Array.isArray(data?.output)
      ? data.output
          .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
          .filter((part: any) => part?.type === 'output_text')
          .map((part: any) => String(part?.text ?? ''))
          .join('\n')
      : '';

    return {
      sessionId: input.sessionId ?? String(data?.id ?? `resp_${Date.now()}`),
      text,
      raw: data,
    };
  }

  /**
   * Returns a ReadableStream of raw SSE data strings from the gateway.
   * The caller pipes this through TextEncoderStream before sending to the client.
   */
  streamMessage(input: OpenClawSendMessageInput): ReadableStream<string> {
    const baseUrl = this.baseUrl;
    const token = this.token;
    const defaultModel = this.defaultModel;

    return new ReadableStream<string>({
      async start(controller) {
        try {
          const response = await fetch(`${baseUrl}/v1/responses`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
              ...(input.agentId ? { 'X-OpenClaw-Agent-Id': input.agentId } : {}),
            },
            body: JSON.stringify({
              model: input.model ?? defaultModel,
              instructions: input.instructions,
              input: input.message,
              user: input.userId,
              stream: true,
              metadata: {
                ...input.metadata,
                sessionId: input.sessionId,
              },
            }),
          });

          if (!response.ok) {
            const err = await response.text();
            controller.enqueue(`error:OpenClaw error ${response.status}: ${err}\n`);
            controller.close();
            return;
          }

          if (!response.body) {
            controller.close();
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
              if (line.startsWith('data:')) {
                const data = line.slice(5).trim();
                if (data && data !== '[DONE]') {
                  controller.enqueue(`data:${data}\n`);
                }
              }
            }
          }

          if (buffer.startsWith('data:')) {
            const data = buffer.slice(5).trim();
            if (data && data !== '[DONE]') {
              controller.enqueue(`data:${data}\n`);
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Stream error';
          controller.enqueue(`error:${msg}\n`);
        } finally {
          controller.close();
        }
      },
    });
  }
}
