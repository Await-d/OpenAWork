export class MCPDisconnectError extends Error {
  readonly serverId: string;
  readonly attempt: number;

  constructor(serverId: string, attempt: number, cause?: unknown) {
    super(`MCP server '${serverId}' disconnected (attempt ${attempt})`);
    this.name = 'MCPDisconnectError';
    this.serverId = serverId;
    this.attempt = attempt;
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

export class MCPTimeoutError extends Error {
  readonly serverId: string;
  readonly timeoutMs: number;

  constructor(serverId: string, timeoutMs: number) {
    super(`MCP server '${serverId}' timed out after ${timeoutMs}ms`);
    this.name = 'MCPTimeoutError';
    this.serverId = serverId;
    this.timeoutMs = timeoutMs;
  }
}

export class MCPMalformedResponseError extends Error {
  readonly serverId: string;
  readonly raw: unknown;

  constructor(serverId: string, raw: unknown) {
    super(`MCP server '${serverId}' returned a malformed response`);
    this.name = 'MCPMalformedResponseError';
    this.serverId = serverId;
    this.raw = raw;
  }
}

const MAX_RECONNECT_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

function backoffMs(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MCPErrorHandler {
  async handleDisconnect(serverId: string, reconnect: () => Promise<void>): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      try {
        if (attempt > 1) {
          await sleep(backoffMs(attempt - 1));
        }
        await reconnect();
        return;
      } catch (err) {
        lastError = err;
      }
    }

    throw new MCPDisconnectError(serverId, MAX_RECONNECT_ATTEMPTS, lastError);
  }

  handleTimeout(serverId: string, timeoutMs: number): never {
    throw new MCPTimeoutError(serverId, timeoutMs);
  }

  handleMalformedResponse(serverId: string, raw: unknown): never {
    throw new MCPMalformedResponseError(serverId, raw);
  }
}
