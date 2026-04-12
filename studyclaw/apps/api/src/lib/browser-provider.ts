import { BrowserConfig } from './browser-config';

export type BrowserSessionInfo = {
  remoteUrl: string;
  launchUrl: string;
  embedUrl?: string;
  status: 'active' | 'ended';
};

export interface BrowserAccessProvider {
  name: string;
  supportsEmbed: boolean;
  buildSession(userId: string, sessionId: string, config: BrowserConfig): Promise<BrowserSessionInfo>;
}

export class NoVncBrowserProvider implements BrowserAccessProvider {
  public readonly name = 'novnc';
  public readonly supportsEmbed = true;

  async buildSession(userId: string, sessionId: string, config: BrowserConfig): Promise<BrowserSessionInfo> {
    const query = `?user=${encodeURIComponent(userId)}&session=${encodeURIComponent(sessionId)}`;
    const remoteUrl = `${config.baseUrl}${query}`;
    const embedUrl = config.embedAllowed ? remoteUrl : undefined;
    const launchUrl = `${config.baseUrl}${sessionId ? `?session=${encodeURIComponent(sessionId)}` : ''}`;

    return {
      remoteUrl,
      launchUrl,
      embedUrl,
      status: 'active',
    };
  }
}

export class OpenClawBrowserProvider implements BrowserAccessProvider {
  public readonly name = 'openclaw';
  public readonly supportsEmbed = true;

  async buildSession(userId: string, sessionId: string, config: BrowserConfig): Promise<BrowserSessionInfo> {
    // TODO: replace with actual OpenClaw browser URL builder when available.
    const remoteUrl = `${config.baseUrl}/${sessionId}`;
    return {
      remoteUrl,
      launchUrl: remoteUrl,
      embedUrl: remoteUrl,
      status: 'active',
    };
  }
}

export function buildBrowserProvider(config: BrowserConfig): BrowserAccessProvider {
  if (config.provider === 'openclaw') {
    return new OpenClawBrowserProvider();
  }
  return new NoVncBrowserProvider();
}
