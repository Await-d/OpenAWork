import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSkillText } from '../../skill/skill-tools.js';

const OriginalFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.fetch = OriginalFetch;
});

describe('fetchSkillText timeout', () => {
  it('远端 manifest 挂起时在 15s 后 abort 抛错', async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })) as typeof fetch;

    const promise = fetchSkillText('https://cdn.test/skill.md');
    const settled = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15_000);
    await settled;
  });

  it('正常 200 响应返回文本', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response('# skill body', { status: 200 }))) as typeof fetch;
    await expect(fetchSkillText('https://cdn.test/skill.md')).resolves.toBe('# skill body');
  });

  it('非 2xx 响应抛出带状态码的错误', async () => {
    globalThis.fetch = (() => Promise.resolve(new Response('nope', { status: 404 }))) as typeof fetch;
    await expect(fetchSkillText('https://cdn.test/skill.md')).rejects.toThrow('HTTP 404');
  });
});
