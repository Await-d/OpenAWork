/**
 * 服务端推送（SSE）连接的生命周期管理器。
 *
 * 动机：多个 SSE 路由（如 `/mcp/events`）在 connect 时注册若干**模块级**订阅
 * （事件总线 listener）并起一个 heartbeat 定时器，断开时必须全部拆除。早期实现
 * 只在 socket 写失败时把 `clientClosed` 置位、却仍依赖 TCP `'close'` 事件来真正
 * 拆订阅。半开 / broken-pipe 的 socket 可能写抛错却**永不**触发 `'close'`——于是
 * 订阅永久滞留在模块级 Set、heartbeat 成僵尸定时器，此后每次 publish 都会扇出到
 * 死订阅，属于进程级泄漏。
 *
 * 本管理器把「幂等拆除」收敛为单一 `close()`：无论由 TCP close、写失败还是上层
 * 主动调用触发，都只执行一次全部 teardown。`write()` 在底层 raw 写抛错时会**主动**
 * 触发 `close()`，而不是仅置位等待一个可能永不到来的事件。
 */
export interface SseClientChannelOptions {
  /** 底层原始写（通常是 `reply.raw.write(...)`）；可能在 socket 半开时抛错。 */
  rawWrite: (chunk: string) => void;
  /** 连接结束时的收尾（通常是 `reply.raw.end()`）；自身抛错会被吞掉。 */
  rawEnd?: () => void;
}

export interface SseClientChannel {
  /** 是否已关闭。 */
  readonly closed: boolean;
  /** 注册一个断开时要执行的拆除回调（unsubscribe thunk / clearInterval 等）。 */
  addTeardown: (teardown: () => void) => void;
  /** 写一条已序列化好的 SSE 负载；写失败会主动触发 close()。 */
  write: (chunk: string) => void;
  /** 幂等关闭：执行全部 teardown + rawEnd，仅生效一次。 */
  close: () => void;
}

export function createSseClientChannel(options: SseClientChannelOptions): SseClientChannel {
  const { rawWrite, rawEnd } = options;
  const teardowns: Array<() => void> = [];
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    // 倒序执行，语义上更接近「后注册的先拆」，且与注册顺序解耦。
    for (let i = teardowns.length - 1; i >= 0; i -= 1) {
      const teardown = teardowns[i];
      if (!teardown) continue;
      try {
        teardown();
      } catch {
        // 单个 teardown 失败不得阻断其余拆除——否则又会泄漏剩余订阅。
      }
    }
    teardowns.length = 0;
    if (rawEnd) {
      try {
        rawEnd();
      } catch {
        // already closed
      }
    }
  };

  const write = (chunk: string): void => {
    if (closed) return;
    try {
      rawWrite(chunk);
    } catch {
      // 半开 socket：立即拆除，而不是等一个可能永不触发的 'close'。
      close();
    }
  };

  const addTeardown = (teardown: () => void): void => {
    if (closed) {
      // 已经关闭后才注册的 teardown 立刻执行，避免静默泄漏。
      try {
        teardown();
      } catch {
        // ignore
      }
      return;
    }
    teardowns.push(teardown);
  };

  return {
    get closed(): boolean {
      return closed;
    },
    addTeardown,
    write,
    close,
  };
}
