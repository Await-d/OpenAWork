import { EventEmitter } from 'events';

export type DangerousOp = 'mergePR' | 'closePR' | 'deleteRef' | 'forcePush';

export type ConfirmDecision = 'approve' | 'deny';

export interface ConfirmationRequest {
  requestId: string;
  op: DangerousOp;
  context: Record<string, unknown>;
  channelId: string;
  createdAt: number;
  timeoutMs: number;
}

export interface ConfirmationResult {
  requestId: string;
  decision: ConfirmDecision;
  decidedAt: number;
  timedOut: boolean;
}

export interface ConfirmationEmitter {
  emitConfirmationRequest(req: ConfirmationRequest): void;
}

const DANGEROUS_OPS: readonly DangerousOp[] = ['mergePR', 'closePR', 'deleteRef', 'forcePush'];

export function isDangerousOp(op: string): op is DangerousOp {
  return (DANGEROUS_OPS as string[]).includes(op);
}

type PendingResolve = (result: ConfirmationResult) => void;

export class DangerousOpConfirmManager {
  private readonly emitter: ConfirmationEmitter;
  private readonly defaultTimeoutMs: number;
  private readonly pending: Map<string, PendingResolve> = new Map();
  private readonly internalBus: EventEmitter = new EventEmitter();

  constructor(emitter: ConfirmationEmitter, defaultTimeoutMs = 60_000) {
    this.emitter = emitter;
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  requestConfirmation(
    op: DangerousOp,
    context: Record<string, unknown>,
    channelId: string,
    timeoutMs?: number,
  ): Promise<ConfirmationResult> {
    const requestId = `${op}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const resolvedTimeoutMs = timeoutMs ?? this.defaultTimeoutMs;

    const req: ConfirmationRequest = {
      requestId,
      op,
      context,
      channelId,
      createdAt: Date.now(),
      timeoutMs: resolvedTimeoutMs,
    };

    return new Promise<ConfirmationResult>((resolve) => {
      this.pending.set(requestId, resolve);

      const timer = setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          resolve({
            requestId,
            decision: 'deny',
            decidedAt: Date.now(),
            timedOut: true,
          });
        }
      }, resolvedTimeoutMs);

      this.internalBus.once(`decided:${requestId}`, () => {
        clearTimeout(timer);
      });

      this.emitter.emitConfirmationRequest(req);
    });
  }

  handleChannelCommand(rawText: string, requestId: string): boolean {
    const normalized = rawText.trim().toLowerCase();
    let decision: ConfirmDecision | null = null;

    if (normalized === '/approve' || normalized === 'approve') {
      decision = 'approve';
    } else if (normalized === '/deny' || normalized === 'deny') {
      decision = 'deny';
    }

    if (!decision) return false;

    const resolve = this.pending.get(requestId);
    if (!resolve) return false;

    this.pending.delete(requestId);
    this.internalBus.emit(`decided:${requestId}`);

    resolve({
      requestId,
      decision,
      decidedAt: Date.now(),
      timedOut: false,
    });

    return true;
  }

  hasPending(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  pendingCount(): number {
    return this.pending.size;
  }
}
