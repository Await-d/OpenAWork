import { vi } from 'vitest';

// 默认网关配置；需要验证远端变化/失败的测试可覆盖工厂或 read。
vi.mock('@openAwork/web-client', async (original) => ({
  ...(await original<typeof import('@openAwork/web-client')>()),
  createMessageLimitsClient: () => ({
    read: vi.fn(async () => ({
      maxChars: 32768,
      minChars: 1024,
      hardMaxChars: 200000,
      defaultMaxChars: 32768,
      canEdit: false,
    })),
  }),
}));

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length(): number {
      return values.size;
    },
    clear(): void {
      values.clear();
    },
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    key(index: number): string | null {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      values.delete(key);
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
  };
}

vi.stubGlobal('localStorage', createStorage());
vi.stubGlobal('sessionStorage', createStorage());

/**
 * jsdom 未实现 `window.isSecureContext`，而 `copyTextToClipboard` 用它决定走
 * Clipboard API 还是 `execCommand` 兜底。测试跑在 localhost，按安全上下文处理：
 * 各测试自行 mock `navigator.clipboard` 即可命中 Clipboard 分支。
 */
if (typeof window !== 'undefined' && !window.isSecureContext) {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
}
