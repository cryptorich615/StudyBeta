import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import {
  MANAGED_MINIMAX_MODEL_KEYS,
  getManagedUsageProfileByIdentity,
  verifyManagedVirtualApiKey,
} from '../../lib/managed-usage';

const minimaxProxyRouter = Router();

const OPENCLAW_MAIN_MODELS_PATH =
  process.env.STUDYCLAW_SERVER_MINIMAX_MODELS_PATH || '/home/ubuntu/.openclaw/agents/main/agent/models.json';
const MINIMAX_PROXY_BASE_URL = process.env.STUDYCLAW_SERVER_MINIMAX_BASE_URL || 'https://api.minimax.io/anthropic';

async function loadManagedMiniMaxApiKey() {
  if (process.env.MINIMAX_API_KEY?.trim()) {
    return process.env.MINIMAX_API_KEY.trim();
  }

  const raw = await readFile(OPENCLAW_MAIN_MODELS_PATH, 'utf8');
  const config = JSON.parse(raw) as {
    providers?: Record<string, { apiKey?: string }>;
  };
  const apiKey = String(config.providers?.minimax?.apiKey ?? '').trim();
  if (!apiKey) {
    throw new Error('Managed MiniMax API key is not configured server-side');
  }

  return apiKey;
}

function readInternalBearerToken(headerValue: string | undefined) {
  if (!headerValue?.startsWith('Bearer ')) {
    return null;
  }

  return headerValue.slice('Bearer '.length).trim();
}

minimaxProxyRouter.post('/v1/messages', async (req, res) => {
  const virtualKey = readInternalBearerToken(req.header('authorization'));
  const identity = verifyManagedVirtualApiKey(virtualKey);

  if (!identity) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid StudyClaw managed MiniMax credential.',
    });
  }

  const profile = await getManagedUsageProfileByIdentity(identity);
  if (!profile || profile.role === 'admin' || profile.billingMode !== 'managed' || !profile.usesManagedCredits) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Managed MiniMax access is not active for this StudyClaw account.',
    });
  }

  const requestedModel = String(req.body?.model ?? '').trim();
  if (requestedModel && !MANAGED_MINIMAX_MODEL_KEYS.includes(`minimax/${requestedModel}` as (typeof MANAGED_MINIMAX_MODEL_KEYS)[number])) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'Only StudyClaw-managed MiniMax configured profiles may use this proxy.',
    });
  }

  try {
    const minimaxApiKey = await loadManagedMiniMaxApiKey();
    const upstream = await fetch(`${MINIMAX_PROXY_BASE_URL.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: req.header('accept') || 'application/json',
        Authorization: `Bearer ${minimaxApiKey}`,
        'x-api-key': minimaxApiKey,
        'anthropic-version': req.header('anthropic-version') || '2023-06-01',
        ...(req.header('anthropic-beta') ? { 'anthropic-beta': req.header('anthropic-beta') as string } : {}),
      },
      body: JSON.stringify(req.body),
    });

    const rawText = await upstream.text();
    res.status(upstream.status);
    if (upstream.headers.get('content-type')) {
      res.setHeader('content-type', upstream.headers.get('content-type') as string);
    }
    return res.send(rawText);
  } catch (error) {
    return res.status(502).json({
      error: 'managed_minimax_proxy_failed',
      message: error instanceof Error ? error.message : 'Failed to reach MiniMax',
    });
  }
});

export { minimaxProxyRouter };
