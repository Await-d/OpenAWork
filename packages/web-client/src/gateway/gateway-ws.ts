import type { DialogueMode, InputImageContent, RunEvent } from '@openAwork/shared';

export type GatewayStreamEvent = RunEvent;

export type StreamEventHandler = (event: GatewayStreamEvent) => void;

export type StreamChunkHandler = StreamEventHandler;

/**
 * Dispatch one stream event to every registered handler while isolating
 * faults. The handlers are external subscribers (React effects, store
 * updaters); if one throws — e.g. a component that unmounted mid-stream
 * and now references a stale ref — the remaining subscribers must still
 * receive the event. A naive `for (const h of handlers) h(event)` aborts
 * the loop on the first throw, which in practice strands other listeners
 * on a non-terminal state (the `done` / `error` chunk never arrives) and
 * leaves the UI stuck in a loading spinner.
 */
export function dispatchStreamEvent(
  handlers: Iterable<StreamEventHandler>,
  event: GatewayStreamEvent,
): void {
  for (const handler of [...handlers]) {
    try {
      handler(event);
    } catch (err) {
      console.error('[gateway-stream] event handler threw, isolating', err);
    }
  }
}

export interface SendMessageOptions {
  agentId?: string;
  clientRequestId?: string;
  dialogueMode?: DialogueMode;
  inputParts?: InputImageContent[];
  model?: string;
  temperature?: number;
  yoloMode?: boolean;
}

/**
 * Upper bound on payloads buffered while the socket is not yet OPEN. The
 * buffer exists so sends fired during CONNECTING aren't lost, but if the
 * gateway is down the socket never opens and a chatty caller (rapid retries,
 * automated resends) would otherwise grow this array without limit — an
 * unbounded client-side memory leak. When the cap is exceeded we drop the
 * oldest queued payload (FIFO eviction): the most recent intent is the one
 * worth keeping, and the stale head was already superseded.
 */
const MAX_PENDING_PAYLOADS = 64;

export class GatewayWebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: Set<StreamEventHandler> = new Set();
  private pendingPayloads: string[] = [];
  private gatewayUrl: string;
  private token: string;
  /** Set by disconnect() so a caller-initiated close never emits an error. */
  private manualClose = false;
  /**
   * True once a terminal chunk (`done` / `error`, including the synthetic
   * close error) has been dispatched for the current connection. Guards the
   * onclose handler so it emits its synthetic error at most once and never
   * after a clean terminal chunk already settled the consumers.
   */
  private terminalDispatched = false;

  constructor(gatewayUrl: string, token: string) {
    this.gatewayUrl = gatewayUrl;
    this.token = token;
  }

  connect(sessionId: string): void {
    // Reset per-connection terminal-state tracking so the onclose handler can
    // emit its synthetic error exactly once for this fresh socket.
    this.manualClose = false;
    this.terminalDispatched = false;

    const protocol = this.gatewayUrl.startsWith('https') ? 'wss' : 'ws';
    const base = this.gatewayUrl.replace(/^https?/, protocol);
    const params = new URLSearchParams({ token: this.token });
    // Capture the socket locally so the handlers ignore events from a socket
    // that a later connect() has already superseded.
    const ws = new WebSocket(`${base}/sessions/${sessionId}/stream?${params.toString()}`);
    this.ws = ws;

    ws.onopen = () => {
      // Flush every payload queued while the socket was still CONNECTING.
      // A single-slot buffer would silently drop all but the last message
      // when the caller fires several sends back-to-back before `open`.
      if (this.pendingPayloads.length > 0) {
        const queued = this.pendingPayloads;
        this.pendingPayloads = [];
        for (const payload of queued) {
          ws.send(payload);
        }
      }
    };

    ws.onmessage = (ev) => {
      let chunk: GatewayStreamEvent;
      try {
        chunk = JSON.parse(ev.data as string) as GatewayStreamEvent;
      } catch {
        this.emitTerminal({
          type: 'error',
          code: 'WS_INVALID_PAYLOAD',
          message: 'WebSocket 数据解析失败。',
        });
        ws.close();
        return;
      }
      dispatchStreamEvent(this.handlers, chunk);
      if (chunk.type === 'done' || chunk.type === 'error') {
        this.terminalDispatched = true;
      }
    };

    ws.onerror = () => {
      this.emitTerminal({
        type: 'error',
        code: 'WS_ERROR',
        message: 'WebSocket 连接异常。',
      });
    };

    ws.onclose = () => {
      // Ignore the close of a socket a newer connect() already replaced.
      if (this.ws !== ws) return;
      // The browser fires onclose for EVERY close — a clean shutdown after a
      // terminal `done`/`error` chunk, a caller-initiated disconnect(), and a
      // silent server-initiated drop alike. Only the last case (gateway
      // restart, proxy idle-drop, 1001 going-away) arrives with no prior
      // terminal chunk; without a synthetic terminal event here the consumers
      // stay stranded on a non-terminal state and the chat UI spinner hangs
      // forever. Emit exactly once, and never for a clean/terminal/manual close.
      if (this.manualClose || this.terminalDispatched) return;
      this.emitTerminal({
        type: 'error',
        code: 'WS_CLOSED',
        message: 'WebSocket 连接已关闭。',
      });
    };
  }

  /** Dispatch a terminal chunk and mark the connection settled (dedupes onclose). */
  private emitTerminal(chunk: GatewayStreamEvent): void {
    this.terminalDispatched = true;
    dispatchStreamEvent(this.handlers, chunk);
  }

  send(message: string, options: SendMessageOptions = {}): void {
    const clientRequestId = options.clientRequestId ?? crypto.randomUUID();
    const agentId = options.agentId?.trim() || undefined;
    const payload = JSON.stringify({
      ...(agentId ? { agentId } : {}),
      clientRequestId,
      ...(options.dialogueMode ? { dialogueMode: options.dialogueMode } : {}),
      ...(options.inputParts ? { inputParts: options.inputParts } : {}),
      message,
      model: options.model ?? 'default',
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.yoloMode !== undefined ? { yoloMode: options.yoloMode } : {}),
    });

    if (!this.ws) return;
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
      return;
    }
    this.pendingPayloads.push(payload);
    // Evict oldest entries if the socket stayed un-OPEN long enough to
    // overflow the buffer (gateway down / never connected).
    while (this.pendingPayloads.length > MAX_PENDING_PAYLOADS) {
      this.pendingPayloads.shift();
    }
  }

  onChunk(handler: StreamEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  disconnect(): void {
    // Mark before closing so the onclose handler treats this as an intentional
    // shutdown and does not emit a synthetic WS_CLOSED error.
    this.manualClose = true;
    this.ws?.close();
    this.ws = null;
    this.pendingPayloads = [];
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }
}
