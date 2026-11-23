import { describe, expect, it } from 'vitest';
import { isToolInputPending } from './pending-tool-input.js';

/**
 * 判定口径（见 `pending-tool-input.ts` 的注释）：
 *   1. 只要有结算信号（output / isError / 非 running 状态）就不是 pending；
 *   2. 未收全只有两种形状：`{}` 与 `{ raw: '<非空文本>' }`；
 *   3. 任何真正的对象入参一律不拦（可能是合法但语义待补，交给卡片处理）。
 */
describe('isToolInputPending', () => {
  it('工具名刚到、参数一个字节都没到（空对象）→ 占位', () => {
    expect(isToolInputPending({ input: {}, status: 'running' })).toBe(true);
    expect(isToolInputPending({ input: {} })).toBe(true);
  });

  it('JSON 没收全（协议层 raw 兜底）→ 占位', () => {
    expect(
      isToolInputPending({
        input: { raw: '{"patchText":"*** Begin Patch\\n*** Update File: /a.md' },
        status: 'running',
      }),
    ).toBe(true);
  });

  it('参数已收全（真正的对象）→ 正常渲染', () => {
    expect(
      isToolInputPending({
        input: { filePath: '/a.md', oldString: 'x', newString: 'y' },
        status: 'running',
      }),
    ).toBe(false);
  });

  it.each(['completed', 'failed', 'paused'] as const)(
    'status 已是 %s（终态 / 待审批）→ 不占位',
    (status) => {
      expect(isToolInputPending({ input: { raw: '{"a":' }, status })).toBe(false);
      expect(isToolInputPending({ input: {}, status })).toBe(false);
    },
  );

  it('tool_result 已到（output 存在）→ 不占位，哪怕入参仍是 raw 兜底', () => {
    expect(
      isToolInputPending({ input: { raw: '{"a":' }, output: { ok: true }, status: 'running' }),
    ).toBe(false);
  });

  it('已标记错误 → 不占位', () => {
    expect(isToolInputPending({ input: { raw: '{"a":' }, isError: true })).toBe(false);
  });

  it('raw 值不是非空字符串 → 不是流式兜底，交给卡片渲染', () => {
    expect(isToolInputPending({ input: { raw: '   ' }, status: 'running' })).toBe(false);
    expect(isToolInputPending({ input: { raw: 1 }, status: 'running' })).toBe(false);
  });

  it('多键入参（即便含 raw）→ 不是兜底形状', () => {
    expect(
      isToolInputPending({ input: { raw: '{"a":', filePath: '/a.md' }, status: 'running' }),
    ).toBe(false);
  });
});
