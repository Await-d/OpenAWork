import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type OAuthStatus =
  | 'idle'
  | 'pending_browser'
  | 'pending_callback'
  | 'exchanging'
  | 'connected'
  | 'error';

export type Platform = 'mobile' | 'desktop' | 'sandbox';

export interface MCPOAuthStartResult {
  authUrl: string;
  state: string;
}

export interface MCPOAuthCallbackParams {
  serverId: string;
  code: string;
  state: string;
}

export interface MCPOAuthSession {
  serverId: string;
  status: OAuthStatus;
  errorMessage?: string;
  toolCount?: number;
}

export interface OAuthCallbackHandler {
  openAuthUrl(url: string): Promise<void>;
  waitForCallback(state: string, timeoutMs: number): Promise<string>;
  dispose(): void;
}

export interface MCPAuthService {
  start(serverId: string): Promise<MCPOAuthStartResult>;
  callback(params: MCPOAuthCallbackParams): Promise<void>;
  pollStatus(serverId: string): Promise<MCPOAuthSession>;
}

const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const MOBILE_CALLBACK_PREFIX = 'myapp://mcp/oauth/callback';

export class DesktopLocalhostCallbackHandler implements OAuthCallbackHandler {
  private server: http.Server | null = null;
  private port = 0;

  async openAuthUrl(url: string): Promise<void> {
    const { exec } = await import('child_process');
    const open =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${open} "${url}"`);
  }

  waitForCallback(expectedState: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
        if (reqUrl.pathname !== '/mcp/oauth/callback') {
          res.writeHead(404);
          res.end();
          return;
        }
        const code = reqUrl.searchParams.get('code');
        const state = reqUrl.searchParams.get('state');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>Authorization complete. You may close this tab.</body></html>');
        this.dispose();
        if (state !== expectedState) {
          reject(new Error('OAuth state mismatch'));
          return;
        }
        if (!code) {
          reject(new Error('No authorization code in callback'));
          return;
        }
        resolve(code);
      });
      this.server.listen(0, '127.0.0.1', () => {
        this.port = (this.server!.address() as AddressInfo).port;
      });
      setTimeout(() => {
        this.dispose();
        reject(new Error('OAuth callback timed out'));
      }, timeoutMs);
    });
  }

  getCallbackUrl(): string {
    return `http://127.0.0.1:${this.port}/mcp/oauth/callback`;
  }

  dispose(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

export class MobileDeepLinkCallbackHandler implements OAuthCallbackHandler {
  private resolvers = new Map<string, (code: string) => void>();
  private rejecters = new Map<string, (err: Error) => void>();

  async openAuthUrl(url: string): Promise<void> {
    throw new Error(
      `MobileDeepLinkCallbackHandler.openAuthUrl must be wired to Expo Linking.openURL via the Tauri IPC bridge before use. Received url: ${url}`,
    );
  }

  waitForCallback(expectedState: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      this.resolvers.set(expectedState, resolve);
      this.rejecters.set(expectedState, reject);
      setTimeout(() => {
        this.rejecters.get(expectedState)?.(new Error('OAuth deep link timed out'));
        this.resolvers.delete(expectedState);
        this.rejecters.delete(expectedState);
      }, timeoutMs);
    });
  }

  handleDeepLink(rawUrl: string): void {
    if (
      !rawUrl.startsWith(MOBILE_CALLBACK_PREFIX.slice(0, MOBILE_CALLBACK_PREFIX.lastIndexOf('/')))
    )
      return;
    const url = new URL(rawUrl);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!state) return;
    if (!code) {
      this.rejecters.get(state)?.(new Error('No authorization code in deep link'));
    } else {
      this.resolvers.get(state)?.(code);
    }
    this.resolvers.delete(state);
    this.rejecters.delete(state);
  }

  dispose(): void {
    this.resolvers.clear();
    this.rejecters.clear();
  }
}

export class MCPOAuthFlow {
  private sessions = new Map<string, MCPOAuthSession>();

  constructor(
    private readonly authService: MCPAuthService,
    private readonly platform: Platform,
  ) {}

  async connect(serverId: string, handler: OAuthCallbackHandler): Promise<MCPOAuthSession> {
    this.sessions.set(serverId, { serverId, status: 'pending_browser' });
    try {
      const { authUrl, state } = await this.authService.start(serverId);
      this.setStatus(serverId, 'pending_callback');
      await handler.openAuthUrl(authUrl);
      const code = await handler.waitForCallback(state, OAUTH_TIMEOUT_MS);
      this.setStatus(serverId, 'exchanging');
      await this.authService.callback({ serverId, code, state });
      const session = await this.authService.pollStatus(serverId);
      this.sessions.set(serverId, session);
      return session;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const failed: MCPOAuthSession = { serverId, status: 'error', errorMessage };
      this.sessions.set(serverId, failed);
      handler.dispose();
      return failed;
    }
  }

  async pollStatus(serverId: string): Promise<MCPOAuthSession> {
    const live = await this.authService.pollStatus(serverId);
    this.sessions.set(serverId, live);
    return live;
  }

  getSession(serverId: string): MCPOAuthSession | undefined {
    return this.sessions.get(serverId);
  }

  buildHandler(): OAuthCallbackHandler {
    if (this.platform === 'desktop') return new DesktopLocalhostCallbackHandler();
    if (this.platform === 'mobile') return new MobileDeepLinkCallbackHandler();
    throw new Error('sandbox platform requires manual fallback');
  }

  private setStatus(serverId: string, status: OAuthStatus): void {
    const prev = this.sessions.get(serverId);
    this.sessions.set(serverId, { ...(prev ?? { serverId }), status });
  }
}
