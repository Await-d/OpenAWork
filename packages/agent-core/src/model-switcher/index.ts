import type { CatwalkRegistry } from '../catwalk/index.js';

export interface ModelSwitchRecord {
  sessionId: string;
  fromProviderId: string;
  fromModelId: string;
  toProviderId: string;
  toModelId: string;
  switchedAt: number;
  reason?: string;
}

export interface ContextTransferStatus {
  tokenCount: number;
  estimatedCostUSD: number;
  compatible: boolean;
  warning?: string;
}

export interface ModelSwitchManager {
  switchModel(
    sessionId: string,
    toProviderId: string,
    toModelId: string,
    reason?: string,
  ): ModelSwitchRecord;
  getCurrentModel(sessionId: string): { providerId: string; modelId: string } | null;
  getHistory(sessionId: string): ModelSwitchRecord[];
  clearSession(sessionId: string): void;
  isCompatible(fromModelId: string, toModelId: string): boolean;
  estimateContextTransfer(
    sessionId: string,
    toModelId: string,
    tokenCount: number,
    inputPricePerMillion: number,
  ): ContextTransferStatus;
}

interface SessionState {
  current: { providerId: string; modelId: string };
  history: ModelSwitchRecord[];
}

export class ModelSwitchManagerImpl implements ModelSwitchManager {
  private sessions = new Map<string, SessionState>();

  constructor(private readonly catwalkRegistry?: CatwalkRegistry) {}

  switchModel(
    sessionId: string,
    toProviderId: string,
    toModelId: string,
    reason?: string,
  ): ModelSwitchRecord {
    const s: SessionState = this.sessions.get(sessionId) ?? {
      current: { providerId: '', modelId: '' },
      history: [],
    };
    const record: ModelSwitchRecord = {
      sessionId,
      fromProviderId: s.current.providerId,
      fromModelId: s.current.modelId,
      toProviderId,
      toModelId,
      switchedAt: Date.now(),
      reason,
    };
    s.history.push(record);
    s.current = { providerId: toProviderId, modelId: toModelId };
    this.sessions.set(sessionId, s);
    return record;
  }

  getCurrentModel(sessionId: string): { providerId: string; modelId: string } | null {
    return this.sessions.get(sessionId)?.current ?? null;
  }

  getHistory(sessionId: string): ModelSwitchRecord[] {
    return [...(this.sessions.get(sessionId)?.history ?? [])];
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  isCompatible(fromModelId: string, toModelId: string): boolean {
    void fromModelId;
    void toModelId;
    return true;
  }

  estimateContextTransfer(
    sessionId: string,
    toModelId: string,
    tokenCount: number,
    inputPricePerMillion: number,
  ): ContextTransferStatus {
    void sessionId;

    const estimatedCostUSD = (tokenCount * inputPricePerMillion) / 1_000_000;
    const contextWindow = this.catwalkRegistry?.getById(toModelId)?.contextWindow ?? 128000;
    const compatible = tokenCount <= contextWindow;

    return {
      tokenCount,
      estimatedCostUSD,
      compatible,
      warning: compatible ? undefined : 'Context exceeds target model window',
    };
  }
}
