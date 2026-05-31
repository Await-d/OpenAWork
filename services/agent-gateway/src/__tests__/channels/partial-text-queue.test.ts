import { describe, expect, it, vi } from 'vitest';
import { createPartialTextQueue } from '../../channels/partial-text-queue.js';

describe('createPartialTextQueue', () => {
  it('按入队顺序串行执行部分更新', async () => {
    const seen: string[] = [];
    const queue = createPartialTextQueue({
      onPartialText: async (text) => {
        // 故意让先入队的更新更慢，验证串行（而非并发）保序。
        await new Promise((resolve) => setTimeout(resolve, text === 'a' ? 20 : 0));
        seen.push(text);
      },
    });

    queue.push('a');
    queue.push('ab');
    queue.push('abc');
    await queue.flush();

    expect(seen).toEqual(['a', 'ab', 'abc']);
  });

  it('忽略空白文本，不调用 onPartialText', async () => {
    const onPartialText = vi.fn(async () => undefined);
    const queue = createPartialTextQueue({ onPartialText });

    queue.push('');
    queue.push('   ');
    await queue.flush();

    expect(onPartialText).not.toHaveBeenCalled();
  });

  it('最后一次部分更新失败时 flush() 仍 resolve（不回退已完成运行）', async () => {
    const onError = vi.fn();
    const queue = createPartialTextQueue({
      onPartialText: async (text) => {
        if (text === 'final') {
          throw new Error('channel rate limited');
        }
      },
      onError,
    });

    queue.push('partial');
    queue.push('final');

    // 关键不变量：即便最后一次推送 reject，flush 也绝不 reject。
    await expect(queue.flush()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    const firstCall = onError.mock.calls[0];
    expect(firstCall?.[0]).toBeInstanceOf(Error);
  });

  it('中间链节失败不影响后续部分更新继续执行', async () => {
    const seen: string[] = [];
    const onError = vi.fn();
    const queue = createPartialTextQueue({
      onPartialText: async (text) => {
        if (text === 'b') {
          throw new Error('transient');
        }
        seen.push(text);
      },
      onError,
    });

    queue.push('a');
    queue.push('b');
    queue.push('c');
    await queue.flush();

    expect(seen).toEqual(['a', 'c']);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('未提供 onPartialText 时 push 是无操作，flush 立即 resolve', async () => {
    const queue = createPartialTextQueue({});
    queue.push('anything');
    await expect(queue.flush()).resolves.toBeUndefined();
  });
});
