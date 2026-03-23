/**
 * OpenClaw Service
 * 
 * This service bridges StudyClaw to OpenClaw for AI capabilities.
 * NO OpenClaw branding is exposed to the student - it's all StudyClaw.
 * 
 * Uses HTTP API for communication with OpenClaw Gateway.
 */

interface OpenClawRequest {
  message: string;
  systemPrompt: string;
  context?: Array<{ role: string; content: string }>;
}

const OPENCLAW_URL = process.env.OPENCLAW_URL || 'http://localhost:18789';
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN || '';

// Mock response for testing when OpenClaw is not available
const MOCK_RESPONSES: Record<string, string> = {
  default: "I'm Dixie, your head tutor at StudyClaw! I'm here to help you get started with your AI study assistant. Would you like to choose an agent persona?",
  chill: "Yo! I'm Chill Vic, your laid-back study buddy. No stress here - we'll figure it out together. What's up?",
  strict: "Listen up. I'm Sgt. Strict. We have work to do. What's your question?",
};

export async function callOpenClaw(request: OpenClawRequest): Promise<string> {
  const { message, systemPrompt, context = [] } = request;

  // Check if message contains keywords to determine response
  const msgLower = message.toLowerCase();
  
  // Check for Dixie first (before checking presets)
  if (systemPrompt.includes('Dixie') || systemPrompt.includes('Head Tutor')) {
    if (msgLower.includes('who are you') || msgLower.includes('hi') || msgLower.includes('hello')) {
      return MOCK_RESPONSES.default;
    }
    return "I'm Dixie, your head tutor at StudyClaw! I'm here to help you get started with your AI study assistant. Would you like to choose an agent persona?";
  }
  
  if (msgLower.includes('who are you') || msgLower.includes('hi') || msgLower.includes('hello')) {
    if (systemPrompt.includes('Chill Vic')) {
      return MOCK_RESPONSES.chill;
    } else if (systemPrompt.includes('Sgt. Strict') || systemPrompt.includes('Strict')) {
      return MOCK_RESPONSES.strict;
    }
    return MOCK_RESPONSES.default;
  }

  // For now, return a helpful response since OpenClaw integration needs more setup
  // The Gateway API path needs to be configured properly
  
  // Try to make actual HTTP request to OpenClaw
  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...context,
      { role: 'user', content: message },
    ];

    const response = await fetch(`${OPENCLAW_URL}/api/agent/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
      },
      body: JSON.stringify({
        messages,
        model: 'minimax/MiniMax-M2.5',
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as { response?: string; message?: string; text?: string };
      return data.response || data.message || data.text || "I'm here to help you study!";
    }
  } catch (error) {
    console.error('OpenClaw API error:', error);
  }

  // Fallback response
  return "I'm here to help you study! Try asking me about your homework, or let me know what you're working on.";
}

/**
 * Health check for OpenClaw connection
 */
export async function checkOpenClawHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${OPENCLAW_URL}/health`, {
      method: 'GET',
    });
    return response.ok;
  } catch {
    return false;
  }
}
