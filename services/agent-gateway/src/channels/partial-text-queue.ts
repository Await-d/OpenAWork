/**
 * 渠道流式「部分更新」串行队列。
 *
 * 背景：auto-reply 在流式回复时会把累积文本通过 `onPartialText` 持续推给渠道
 * （如 Telegram 的 editMessageText）。这些更新是**装饰性的中间态**——最终完整
 * 回复另有保证（已落库 / 末尾 finish）。渠道侧限流、瞬时网络抖动导致单次部分
 * 更新失败是常态。
 *
 * 关键不变量：部分更新失败**绝不能**回退一次已经成功完成的 agent 运行。早期实现
 * 把 `.catch` 放在 `.then` 之前，只能吞掉「上一链节」的错误；若最后一次推送自身
 * reject，末尾 `await queue` 仍会抛出，把成功运行误判成失败并给用户发 Error 文案。
 * 这里把错误隔离包在每个链节「自身」的 `onPartialText` 外，保证返回的 promise 恒为
 * fulfilled，`await flush()` 永不 reject。
 */
export interface PartialTextQueue {
  /** 串行排入一次部分更新（非空文本才入队）。同步返回，不阻塞调用方。 */
  push: (text: string) => void;
  /** 等待已入队的所有部分更新结算；恒 resolve（失败已在内部吞掉并告警）。 */
  flush: () => Promise<void>;
}

export function createPartialTextQueue(input: {
  onPartialText?: (text: string) => Promise<void> | void;
  onError?: (error: unknown) => void;
}): PartialTextQueue {
  const { onPartialText, onError } = input;
  let queue: Promise<void> = Promise.resolve();

  const push = (text: string): void => {
    if (!onPartialText || text.trim().length === 0) {
      return;
    }
    queue = queue.then(async () => {
      try {
        await onPartialText(text);
      } catch (error) {
        onError?.(error);
      }
    });
  };

  const flush = (): Promise<void> => queue;

  return { push, flush };
}
