// @vitest-environment jsdom
/**
 * 错误摘要构建与发送的覆盖。
 *
 * 重点是「只保留问题」这条边界：warn / 成功请求 / 进行中的请求都不该出现在
 * 摘要里；以及去重、条数上限、消息截断这些防止上下文爆炸的约束。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConsoleEntry, NetworkExchange } from './browser-console-types.js';
import { COMPOSER_INSERT_EVENT } from './browser-clipboard.js';
import {
  buildErrorDigest,
  countErrorDigestProblems,
  sendErrorDigestToComposer,
} from './error-digest.js';

const FIXED_TIMESTAMP = 1_700_000_000_000;

function makeEntry(
  overrides: Partial<ConsoleEntry> & Pick<ConsoleEntry, 'level' | 'message'>,
): ConsoleEntry {
  return {
    id: overrides.id ?? 'e1',
    timestamp: overrides.timestamp ?? FIXED_TIMESTAMP,
    ...overrides,
  };
}

function makeNetwork(
  overrides: Partial<NetworkExchange> & Pick<NetworkExchange, 'url'>,
): NetworkExchange {
  return {
    networkId: overrides.networkId ?? 'n1',
    source: 'fetch',
    method: 'GET',
    ...overrides,
  };
}

function withComposerListener(run: () => void): Array<{ text: string; mode: string }> {
  const details: Array<{ text: string; mode: string }> = [];
  const handler = (event: Event): void => {
    details.push((event as CustomEvent).detail as { text: string; mode: string });
  };
  window.addEventListener(COMPOSER_INSERT_EVENT, handler);
  try {
    run();
  } finally {
    window.removeEventListener(COMPOSER_INSERT_EVENT, handler);
  }
  return details;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildErrorDigest', () => {
  it('只保留 error、网络失败与 4xx/5xx', () => {
    const digest = buildErrorDigest([
      makeEntry({ id: '1', level: 'log', message: '普通日志' }),
      makeEntry({ id: '2', level: 'warn', message: '一个警告' }),
      makeEntry({ id: '3', level: 'error', message: 'Uncaught TypeError: boom' }),
      makeEntry({
        id: '4',
        level: 'network',
        message: '⟵ 200 成功请求',
        network: makeNetwork({ url: 'https://api.example/ok', status: 200 }),
      }),
      makeEntry({
        id: '5',
        level: 'network',
        message: '⟵ 404 未找到',
        network: makeNetwork({ url: 'https://api.example/missing', status: 404 }),
      }),
      makeEntry({
        id: '6',
        level: 'network',
        message: '✗ 请求失败',
        network: makeNetwork({ url: 'https://api.example/x', errorMessage: 'CORS blocked' }),
      }),
    ]);

    expect(digest).toContain('Uncaught TypeError: boom');
    expect(digest).toContain('⟵ 404 未找到');
    expect(digest).toContain('✗ 请求失败');
    expect(digest).toContain('问题数量：3');
    expect(digest).not.toContain('普通日志');
    expect(digest).not.toContain('一个警告');
    expect(digest).not.toContain('⟵ 200 成功请求');
  });

  it('网络条目 message 为空时用结构化字段兜底', () => {
    const digest = buildErrorDigest([
      makeEntry({
        id: 'n-status',
        level: 'network',
        message: '   ',
        network: makeNetwork({ url: 'https://api.example/y', status: 500 }),
      }),
      makeEntry({
        id: 'n-error',
        level: 'network',
        message: '',
        network: makeNetwork({
          url: 'https://api.example/z',
          errorMessage: 'CORS blocked',
        }),
      }),
    ]);

    expect(digest).toContain('GET https://api.example/y · 状态 500');
    expect(digest).toContain('GET https://api.example/z · CORS blocked');
    expect(digest).toContain('问题数量：2');
  });

  it('带上 url / title 头部，未提供时省略对应行', () => {
    const withHeader = buildErrorDigest([makeEntry({ level: 'error', message: 'boom' })], {
      url: 'https://app.example/chat',
      title: '控制台',
    });

    expect(withHeader).toContain('- 页面标题：控制台');
    expect(withHeader).toContain('- 页面地址：https://app.example/chat');

    const withoutHeader = buildErrorDigest([makeEntry({ level: 'error', message: 'boom' })]);
    expect(withoutHeader).not.toContain('页面标题');
    expect(withoutHeader).not.toContain('页面地址');
  });

  it('相同消息只保留一条', () => {
    const digest = buildErrorDigest([
      makeEntry({ id: '1', level: 'error', message: '重复报错' }),
      makeEntry({ id: '2', level: 'error', message: '重复报错', timestamp: FIXED_TIMESTAMP + 10 }),
    ]);

    expect(digest).toContain('问题数量：1');
    expect(digest.split('重复报错').length - 1).toBe(1);
  });

  it('按 maxMessageChars 截断消息', () => {
    const digest = buildErrorDigest([makeEntry({ level: 'error', message: 'x'.repeat(5000) })], {
      maxMessageChars: 100,
    });

    expect(digest).toContain(`${'x'.repeat(99)}…`);
    expect(digest).not.toContain('x'.repeat(100));
  });

  it('按 maxEntries 截断问题条数', () => {
    const digest = buildErrorDigest(
      [
        makeEntry({ id: '1', level: 'error', message: 'alpha-issue' }),
        makeEntry({ id: '2', level: 'error', message: 'bravo-issue' }),
        makeEntry({ id: '3', level: 'error', message: 'charlie-issue' }),
      ],
      { maxEntries: 2 },
    );

    expect(digest).toContain('问题数量：2');
    expect(digest).toContain('alpha-issue');
    expect(digest).toContain('bravo-issue');
    expect(digest).not.toContain('charlie-issue');
  });

  it('没有任何问题时返回空字符串', () => {
    expect(buildErrorDigest([])).toBe('');
    expect(buildErrorDigest([makeEntry({ level: 'info', message: '一切正常' })])).toBe('');
  });
});

describe('countErrorDigestProblems', () => {
  it('没有任何问题时返回 0', () => {
    expect(countErrorDigestProblems([])).toBe(0);
    expect(
      countErrorDigestProblems([
        makeEntry({ id: '1', level: 'log', message: '普通日志' }),
        makeEntry({ id: '2', level: 'warn', message: '一个警告' }),
        makeEntry({
          id: '3',
          level: 'network',
          message: '⟵ 200 成功请求',
          network: makeNetwork({ url: 'https://api.example/ok', status: 200 }),
        }),
      ]),
    ).toBe(0);
  });

  it('统计 error 日志与失败/4xx-5xx 网络条目，忽略普通日志与成功响应', () => {
    expect(
      countErrorDigestProblems([
        makeEntry({ id: '1', level: 'log', message: '普通日志' }),
        makeEntry({ id: '2', level: 'warn', message: '一个警告' }),
        makeEntry({ id: '3', level: 'error', message: 'Uncaught TypeError: boom' }),
        makeEntry({
          id: '4',
          level: 'network',
          message: '⟵ 200 成功请求',
          network: makeNetwork({ url: 'https://api.example/ok', status: 200 }),
        }),
        makeEntry({
          id: '5',
          level: 'network',
          message: '⟵ 404 未找到',
          network: makeNetwork({ url: 'https://api.example/missing', status: 404 }),
        }),
        makeEntry({
          id: '6',
          level: 'network',
          message: '✗ 请求失败',
          network: makeNetwork({ url: 'https://api.example/x', errorMessage: 'CORS blocked' }),
        }),
      ]),
    ).toBe(3);
  });

  it('相同消息去重后只计一条', () => {
    expect(
      countErrorDigestProblems([
        makeEntry({ id: '1', level: 'error', message: '重复报错' }),
        makeEntry({
          id: '2',
          level: 'error',
          message: '重复报错',
          timestamp: FIXED_TIMESTAMP + 10,
        }),
      ]),
    ).toBe(1);
  });

  it('遵守 maxEntries 上限', () => {
    expect(
      countErrorDigestProblems(
        [
          makeEntry({ id: '1', level: 'error', message: 'alpha-issue' }),
          makeEntry({ id: '2', level: 'error', message: 'bravo-issue' }),
          makeEntry({ id: '3', level: 'error', message: 'charlie-issue' }),
        ],
        { maxEntries: 2 },
      ),
    ).toBe(2);
  });
});

describe('sendErrorDigestToComposer', () => {
  it('派发摘要事件并返回问题条数', () => {
    const details = withComposerListener(() =>
      sendErrorDigestToComposer([
        makeEntry({ level: 'error', message: 'Uncaught TypeError: boom' }),
        makeEntry({
          level: 'network',
          message: '⟵ 503',
          network: makeNetwork({ url: 'https://api.example/down', status: 503 }),
        }),
      ]),
    );

    expect(details.length).toBe(1);
    expect(details[0]?.mode).toBe('append');
    expect(details[0]?.text).toContain('Uncaught TypeError: boom');
    expect(details[0]?.text).toContain('问题数量：2');
  });

  it('没有问题时不派发事件并返回 0', () => {
    const handler = vi.fn();
    window.addEventListener(COMPOSER_INSERT_EVENT, handler);
    try {
      const count = sendErrorDigestToComposer([makeEntry({ level: 'log', message: '普通日志' })]);

      expect(count).toBe(0);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(COMPOSER_INSERT_EVENT, handler);
    }
  });

  it('返回的条数与摘要中列出的问题数一致', () => {
    const entries = [
      makeEntry({ id: '1', level: 'error', message: 'a' }),
      makeEntry({ id: '2', level: 'error', message: 'b' }),
      makeEntry({ id: '3', level: 'log', message: 'noise' }),
    ];

    const details = withComposerListener(() => {
      expect(sendErrorDigestToComposer(entries)).toBe(2);
    });

    expect(details[0]?.text).toContain('问题数量：2');
  });
});
