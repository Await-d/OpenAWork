import type { RunEvent } from '@openAwork/shared';

/**
 * `/recovery` run event 的**前缀缓冲**（增量续读的客户端侧）。
 *
 * 为什么需要它：chat 页在「远端运行中」（本标签页没接管流）时按
 * `REMOTE_STREAM_RECOVERY_POLL_MS`（1s）轮询 `/recovery`，而
 * `recoverActiveAssistantStream` / `buildChatRightPanelStateFromRunEvents` 是累加
 * reduce，依赖完整序列 —— 活跃 scope 的行数随这一轮 run 的时长只增不减（每个 delta
 * chunk 一行，retention 永不清理在飞 scope），于是每拍都要把「本轮已产生的全部 delta」
 * 读出来、逐行解析、再整包回传：单拍成本 O(本轮事件数)，这正是接口在对话期间卡住的
 * 直接原因。
 *
 * 有了前缀缓冲：冷启动（以及换了 run 之后）取一次全量，其后每拍只取 `seq > cursor`
 * 的增量，由 `settleRunEventBuffer` 把「已持有前缀 + 增量」拼回完整序列交给下游 ——
 * 对下游完全无感，而单拍成本降到 O(这一拍新增事件数)。
 */
export interface RunEventPrefixBuffer {
  /** 该 scope（一轮 run）的身份，与服务端 `activeStream.clientRequestId` 对齐。 */
  clientRequestId: string;
  /** 已交付到的最大 seq，下次请求作为 `runEventAfterSeq`。 */
  cursor: number;
  /** 已持有的完整前缀（按 seq 升序）。 */
  events: RunEvent[];
  sessionId: string;
}

/**
 * 决定本次请求是否携带增量游标。
 *
 * 没有缓冲 / 换了会话 / 缓冲里没有事件（说明它本来就是空的，此时增量语义等于残缺前缀）
 * 一律回 undefined = 全量请求。
 */
export function planRunEventRequest(input: {
  buffer: RunEventPrefixBuffer | null;
  sessionId: string;
}): number | undefined {
  const { buffer, sessionId } = input;
  if (!buffer || buffer.sessionId !== sessionId || buffer.events.length === 0) {
    return undefined;
  }

  return buffer.cursor;
}

export interface RunEventIncrementalSettlement {
  /** 新的前缀缓冲（null = 当前无可用前缀）。 */
  buffer: RunEventPrefixBuffer | null;
  /** 交给下游消费的完整序列。 */
  events: RunEvent[];
  /**
   * true = 本地前缀与本次响应已不是同一轮 run（换了 run / scope 被清掉重建），本次响应
   * 不可拼接：调用方必须立刻重发一次**不带游标**的全量请求，并在拿到结果前不要消费
   * 这一拍的增量。
   */
  needsFullReload: boolean;
}

/**
 * 把一次 `/recovery` 响应并入前缀缓冲，并给出下游应消费的完整序列。
 *
 * 纯函数：不读全局状态、不发请求，便于把「何时该重载」这类边界单独钉死。
 */
export function settleRunEventBuffer(input: {
  activeStream: { clientRequestId: string; lastSeq: number } | null;
  buffer: RunEventPrefixBuffer | null;
  requestedAfterSeq: number | undefined;
  runEventCursor: number | null | undefined;
  runEvents: RunEvent[] | undefined;
  sessionId: string;
}): RunEventIncrementalSettlement {
  const received = Array.isArray(input.runEvents) ? input.runEvents : [];
  const activeStream = input.activeStream;
  const buffer = input.buffer;
  if (!activeStream) {
    // 没有在跑的 run：前缀作废（下一轮 run 是新的 scope，seq 从头开始），
    // 响应本身（turnLimit 语义下为空数组）原样往下传。
    return { buffer: null, events: received, needsFullReload: false };
  }

  if (typeof input.requestedAfterSeq !== 'number') {
    const reusableBuffer =
      buffer !== null &&
      buffer.sessionId === input.sessionId &&
      buffer.clientRequestId === activeStream.clientRequestId &&
      buffer.cursor > activeStream.lastSeq;
    if (reusableBuffer) {
      // 并发下会出现「更旧的一次全量读」晚于更新的交付落地（同一 hook 上两拍重叠）：
      // 它一旦覆盖前缀就把游标倒退回去，下一拍会重复交付同一段增量。保留更靠前的那份。
      return { buffer, events: buffer.events, needsFullReload: false };
    }

    // 全量请求：本次响应直接成为新前缀。
    // cursor 取服务端高水位：它与本次交付集是同一 tick 内的两次同步读（中间没有 await，
    // 写入方插不进来），因此等于交付集的最大 seq —— 下一拍从它之后续读不会漏也不会重。
    return {
      buffer: {
        clientRequestId: activeStream.clientRequestId,
        cursor: activeStream.lastSeq,
        events: received,
        sessionId: input.sessionId,
      },
      events: received,
      needsFullReload: false,
    };
  }

  const scopeChanged =
    !buffer ||
    buffer.sessionId !== input.sessionId ||
    buffer.clientRequestId !== activeStream.clientRequestId;
  // 高水位回退 = 该 scope 的行被清掉重建（失败重试清理 / 裁剪），游标之后的行已不是原来
  // 那一批；继续按游标增量会永远漏掉重建后的头部事件。
  const cursorRewound = buffer !== null && activeStream.lastSeq < buffer.cursor;
  if (scopeChanged || cursorRewound) {
    return { buffer: null, events: received, needsFullReload: true };
  }

  // 增量窗口必须与**请求发出时**的缓冲对齐：缓冲在等待期间被别的交付推进过（同一 hook
  // 上并发了两拍），本响应覆盖的区间与缓冲之间既可能重叠也可能有缝，而客户端只有最大
  // seq、无法逐条去重；宁可多一次全量重载，也不把带重复或缺口的序列交给累加 reduce。
  if (buffer.cursor !== input.requestedAfterSeq) {
    return { buffer: null, events: received, needsFullReload: true };
  }

  // 响应必须严格等于它声明的窗口 `(请求游标, runEventCursor]`：空数组配非空游标、或非空
  // 数组配「不大于请求游标」的游标，都说明这份数据与缓冲拼不上（服务端契约被破坏，或中途
  // 换了实现），同样宁可重载。
  const windowMisaligned =
    received.length === 0
      ? typeof input.runEventCursor === 'number'
      : !(
          typeof input.runEventCursor === 'number' && input.runEventCursor > input.requestedAfterSeq
        );
  if (windowMisaligned) {
    return { buffer: null, events: received, needsFullReload: true };
  }

  // `runEventCursor` 为 null = 本次没有新事件，保持原游标（回退成 0 会重复交付）。
  const cursor =
    typeof input.runEventCursor === 'number' && input.runEventCursor >= buffer.cursor
      ? input.runEventCursor
      : buffer.cursor;
  // 没有新事件时复用旧数组引用，让下游的 preserveEqualValue 能整段跳过重渲染。
  const events = received.length === 0 ? buffer.events : [...buffer.events, ...received];

  return {
    buffer: { ...buffer, cursor, events },
    events,
    needsFullReload: false,
  };
}
