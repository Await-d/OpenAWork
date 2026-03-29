export interface StreamCheckpoint {
  sessionId: string;
  partialContent: string;
  tokenCount: number;
  savedAt: number;
  canResume: boolean;
}

export interface StreamRecoveryManager {
  checkpoint(sessionId: string, content: string): void;
  recover(sessionId: string): Promise<StreamCheckpoint | null>;
  clear(sessionId: string): void;
}

const CHECKPOINT_EVERY_N_TOKENS = 50;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function createStreamRecoveryManager(): StreamRecoveryManager {
  const checkpoints = new Map<string, StreamCheckpoint>();
  const tokenCounters = new Map<string, number>();

  return {
    checkpoint(sessionId: string, content: string): void {
      const tokens = estimateTokens(content);
      const prev = tokenCounters.get(sessionId) ?? 0;

      const milestone = Math.floor(tokens / CHECKPOINT_EVERY_N_TOKENS);
      const prevMilestone = Math.floor(prev / CHECKPOINT_EVERY_N_TOKENS);

      if (milestone > prevMilestone || tokens === 0) {
        checkpoints.set(sessionId, {
          sessionId,
          partialContent: content,
          tokenCount: tokens,
          savedAt: Date.now(),
          canResume: true,
        });
        tokenCounters.set(sessionId, tokens);
      }
    },

    async recover(sessionId: string): Promise<StreamCheckpoint | null> {
      return checkpoints.get(sessionId) ?? null;
    },

    clear(sessionId: string): void {
      checkpoints.delete(sessionId);
      tokenCounters.delete(sessionId);
    },
  };
}
