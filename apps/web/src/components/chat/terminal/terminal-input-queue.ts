/**
 * 终端输入合并队列（T-03 核心）。
 *
 * 为什么需要：`term.onData` 是逐字符触发的，每个按键都 POST 一次
 * `/stdin` 会让网关在快速输入 / 粘贴时承受几十倍的无谓请求。
 *
 * 两条硬约束：
 *  - **合并窗口 16ms**：窗口内到达的输入拼成一段后一次性发出；
 *  - **保序**：同一时刻只允许一个在飞请求，期间到达的数据排队等待，
 *    否则后发的请求可能先落地，导致字符顺序错乱（shell 里就是乱码命令）。
 *
 * 失败处理：不静默吞掉。失败的这段会被**放回队首**（不丢字符），
 * 通过 `onError` 上报，并暂停自动重试 —— 等用户下一次输入或显式
 * `flush()` 再试，避免后端持续 5xx 时形成请求风暴。
 *
 * 纯逻辑、无 React 依赖，便于单测。
 */

/** 输入合并窗口（毫秒）。 */
export const TERMINAL_INPUT_MERGE_MS = 16;

export interface TerminalInputQueueOptions {
  /** 实际写入通道（组件里是 POST /stdin）。reject 视为失败。 */
  write: (data: string) => Promise<void>;
  /** 失败上报：错误 + 出错的那段数据（调用方决定如何提示用户）。 */
  onError: (error: Error, data: string) => void;
  /** 合并窗口，默认 `TERMINAL_INPUT_MERGE_MS`；单测可缩短。 */
  mergeWindowMs?: number;
}

export class TerminalInputQueue {
  private pending = '';
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private retryBlocked = false;
  /** dispose 时仍有在飞写入：等它落地后再补发一次（不丢尾批）。 */
  private drainAfterInflight = false;

  constructor(private readonly options: TerminalInputQueueOptions) {}

  /** 当前尚未发出的字符数（测试与调试用）。 */
  get pendingLength(): number {
    return this.pending.length;
  }

  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  push(data: string): void {
    if (this.disposed || data.length === 0) {
      return;
    }
    this.pending += data;
    // 新的输入意味着用户还在敲：清掉「失败后暂停重试」的闸门。
    this.retryBlocked = false;
    this.scheduleFlush();
  }

  /** 立即发送缓冲；用于卸载 / 切换终端前不丢刚敲的字符。 */
  flush(): void {
    if (this.disposed) {
      return;
    }
    this.retryBlocked = false;
    this.clearTimer();
    void this.dispatch();
  }

  /**
   * 卸载：清定时器并做一次尽力而为的收尾发送。
   *
   * 若此刻正有一个写入在飞（用户在上一次 flush 尚未落地时又敲了字），不能并发
   * 第二个写入；改为标记收尾，等在飞落地后在 `dispatch` 的 finally 里补发一次，
   * 否则这批字符会随组件卸载被静默丢掉（表现为「刚敲的回车没生效」）。
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    if (this.inFlight) {
      this.drainAfterInflight = true;
    } else {
      this.flush();
    }
    this.disposed = true;
  }

  private scheduleFlush(): void {
    if (this.timer !== null || this.inFlight || this.disposed) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.dispatch();
    }, this.options.mergeWindowMs ?? TERMINAL_INPUT_MERGE_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async dispatch(): Promise<void> {
    if (this.inFlight || this.pending.length === 0 || this.disposed) {
      return;
    }
    const data = this.pending;
    this.pending = '';
    this.inFlight = true;
    try {
      await this.options.write(data);
    } catch (error) {
      this.pending = data + this.pending;
      this.retryBlocked = true;
      this.options.onError(error instanceof Error ? error : new Error(String(error)), data);
    } finally {
      this.inFlight = false;
      if (this.disposed) {
        // 卸载时的尾批补发：dispose 已在等在飞落地，这里绕过 `disposed` 闸门发一次。
        if (this.drainAfterInflight) {
          this.drainAfterInflight = false;
          void this.finalDrain();
        }
        return;
      }
      if (!this.retryBlocked && this.pending.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  /**
   * 收尾写入：组件已卸载但仍有残留字符时的最后一次尽力而为发送
   * （POST 不依赖组件存活）。失败只上报、不再重试。
   */
  private async finalDrain(): Promise<void> {
    if (this.inFlight || this.pending.length === 0) {
      return;
    }
    const data = this.pending;
    this.pending = '';
    this.inFlight = true;
    try {
      await this.options.write(data);
    } catch (error) {
      this.pending = data + this.pending;
      this.options.onError(error instanceof Error ? error : new Error(String(error)), data);
    } finally {
      this.inFlight = false;
    }
  }
}
