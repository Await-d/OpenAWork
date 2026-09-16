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

  /** 卸载：清定时器并做一次尽力而为的收尾发送。 */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.flush();
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
      if (!this.disposed && !this.retryBlocked && this.pending.length > 0) {
        this.scheduleFlush();
      }
    }
  }
}
