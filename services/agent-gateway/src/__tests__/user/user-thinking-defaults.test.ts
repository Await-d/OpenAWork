import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteGet: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: mocks.sqliteGet,
}));

import { resolveUserDefaultThinkingForChat } from '../../user/user-thinking-defaults.js';

describe('resolveUserDefaultThinkingForChat', () => {
  beforeEach(() => {
    mocks.sqliteGet.mockReset();
  });

  it('默认思考开启时返回启用的档位（通道 / 定时任务的兜底来源）', () => {
    mocks.sqliteGet.mockReturnValue({
      value: JSON.stringify({
        chat: { enabled: true, effort: 'high' },
        fast: { enabled: false, effort: 'medium' },
      }),
    });

    expect(resolveUserDefaultThinkingForChat('user-1')).toEqual({
      thinkingEnabled: true,
      reasoningEffort: 'high',
    });
    expect(mocks.sqliteGet).toHaveBeenCalledWith(expect.stringContaining('user_settings'), [
      'user-1',
      'default_thinking',
    ]);
  });

  it('只读 chat 档，不读 fast 档', () => {
    mocks.sqliteGet.mockReturnValue({
      value: JSON.stringify({
        chat: { enabled: false, effort: 'low' },
        fast: { enabled: true, effort: 'max' },
      }),
    });

    expect(resolveUserDefaultThinkingForChat('user-1')).toEqual({ thinkingEnabled: false });
  });

  it('默认思考关闭时显式返回 thinkingEnabled=false（与 Web 正常轮口径一致）', () => {
    mocks.sqliteGet.mockReturnValue({
      value: JSON.stringify({
        chat: { enabled: false, effort: 'medium' },
        fast: { enabled: false, effort: 'medium' },
      }),
    });

    expect(resolveUserDefaultThinkingForChat('user-1')).toEqual({ thinkingEnabled: false });
  });

  it('没有存储行时按默认关闭处理（等价设置页展示的缺省值）', () => {
    mocks.sqliteGet.mockReturnValue(undefined);

    expect(resolveUserDefaultThinkingForChat('user-1')).toEqual({ thinkingEnabled: false });
  });

  it('存储值损坏时按默认关闭处理，不抛错也不伪造档位', () => {
    mocks.sqliteGet.mockReturnValue({ value: '{not-json' });

    expect(resolveUserDefaultThinkingForChat('user-1')).toEqual({ thinkingEnabled: false });

    mocks.sqliteGet.mockReturnValue({ value: JSON.stringify({ chat: 1 }) });

    expect(resolveUserDefaultThinkingForChat('user-1')).toEqual({ thinkingEnabled: false });
  });

  it('数据库读取抛错时退化为不兜底（不把一次异常解释成「用户关了思考」）', () => {
    mocks.sqliteGet.mockImplementation(() => {
      throw new Error('db unavailable');
    });

    expect(resolveUserDefaultThinkingForChat('user-1')).toEqual({});
  });
});
