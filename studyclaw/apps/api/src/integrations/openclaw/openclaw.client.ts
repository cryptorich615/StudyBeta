import { networkInterfaces } from 'node:os';

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
    private readonly defaultModel = process.env.OPENCLAW_DEFAULT_MODEL ?? 'openrouter/auto',
    private readonly timeoutMs = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 180000)
  ) {}

  async sendMessage(input: OpenClawSendMessageInput): Promise<OpenClawSendMessageResult> {
    if (!this.token) {
      throw new Error('Missing OPENCLAW_GATEWAY_TOKEN');
    }

    let response: Response | null = null;
    let lastError: unknown = null;

    for (const baseUrl of getCandidateBaseUrls(this.baseUrl)) {
      try {
        response = await fetch(`${baseUrl}/v1/responses`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            ...(input.agentId ? { 'X-OpenClaw-Agent-Id': input.agentId } : {}),
          },
          body: JSON.stringify({
            model: input.agentId ? `openclaw/${input.agentId}` : 'openclaw',
            instructions: input.instructions,
            input: input.message,
            metadata: normalizeMetadata({
              ...input.metadata,
              sessionId: input.sessionId,
            }),
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        break;
      } catch (error) {
        lastError = error;
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new Error(`OpenClaw request timed out after ${this.timeoutMs}ms`);
        }
      }
    }

    if (!response) {
      if (lastError instanceof Error) {
        throw lastError;
      }
      throw new Error('Failed to reach OpenClaw gateway');
    }

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

    const text = extractResponseText(data);

    return {
      sessionId: input.sessionId ?? String(data?.id ?? `resp_${Date.now()}`),
      text,
      raw: data,
    };
  }
}

function normalizeMetadata(metadata: Record<string, unknown>) {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) {
      continue;
    }

    normalized[key] =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);
  }

  return normalized;
}

function getCandidateBaseUrls(preferredBaseUrl: string) {
  const candidates = new Set<string>();
  const normalizedPreferred = preferredBaseUrl.replace(/\/$/, '');

  if (normalizedPreferred) {
    candidates.add(normalizedPreferred);
  }

  candidates.add('http://127.0.0.1:18789');
  candidates.add('http://localhost:18789');

  for (const addresses of Object.values(networkInterfaces())) {
    for (const addressInfo of addresses ?? []) {
      if (addressInfo.family !== 'IPv4' || addressInfo.internal) {
        continue;
      }

      if (addressInfo.address.startsWith('100.')) {
        candidates.add(`http://${addressInfo.address}:18789`);
      }
    }
  }

  return Array.from(candidates);
}

function extractResponseText(data: any) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (Array.isArray(data?.output)) {
    const outputText = data.output
      .flatMap((item: any) => {
        if (Array.isArray(item?.content)) {
          return item.content;
        }

        return item?.type === 'message' ? [item] : [];
      })
      .filter((part: any) => part?.type === 'output_text' || typeof part?.text === 'string')
      .map((part: any) => String(part?.text ?? ''))
      .join('\n')
      .trim();

    if (outputText) {
      return outputText;
    }
  }

  if (typeof data?.content === 'string' && data.content.trim()) {
    return data.content.trim();
  }

  if (typeof data?.rawText === 'string' && data.rawText.trim()) {
    return data.rawText.trim();
  }

  return '';
}
