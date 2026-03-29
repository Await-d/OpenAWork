import type { MCPAuthService, MCPOAuthCallbackParams, MCPOAuthSession } from './mcp-oauth.js';

export type FallbackState = 'idle' | 'awaiting_code' | 'exchanging' | 'connected' | 'error';

export interface FallbackSession {
  serverId: string;
  state: FallbackState;
  errorMessage?: string;
  toolCount?: number;
}

export interface PasteCodeInput {
  serverId: string;
  authorizationCode: string;
  oauthState: string;
}

export class MCPOAuthFallback {
  private sessions = new Map<string, FallbackSession>();

  constructor(private readonly authService: MCPAuthService) {}

  async beginFlow(serverId: string): Promise<{ authUrl: string; oauthState: string }> {
    const { authUrl, state } = await this.authService.start(serverId);
    this.sessions.set(serverId, { serverId, state: 'awaiting_code' });
    return { authUrl, oauthState: state };
  }

  async submitCode(input: PasteCodeInput): Promise<FallbackSession> {
    const existing = this.sessions.get(input.serverId);
    if (!existing || existing.state !== 'awaiting_code') {
      throw new Error(`No active fallback flow for serverId: ${input.serverId}`);
    }
    this.setFallbackState(input.serverId, 'exchanging');
    try {
      const params: MCPOAuthCallbackParams = {
        serverId: input.serverId,
        code: input.authorizationCode,
        state: input.oauthState,
      };
      await this.authService.callback(params);
      const liveSession: MCPOAuthSession = await this.authService.pollStatus(input.serverId);
      const result: FallbackSession = {
        serverId: input.serverId,
        state: liveSession.status === 'connected' ? 'connected' : 'error',
        errorMessage: liveSession.errorMessage,
        toolCount: liveSession.toolCount,
      };
      this.sessions.set(input.serverId, result);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const failed: FallbackSession = { serverId: input.serverId, state: 'error', errorMessage };
      this.sessions.set(input.serverId, failed);
      return failed;
    }
  }

  getSession(serverId: string): FallbackSession | undefined {
    return this.sessions.get(serverId);
  }

  reset(serverId: string): void {
    this.sessions.set(serverId, { serverId, state: 'idle' });
  }

  private setFallbackState(serverId: string, state: FallbackState): void {
    const prev = this.sessions.get(serverId);
    this.sessions.set(serverId, { ...(prev ?? { serverId }), state });
  }
}
