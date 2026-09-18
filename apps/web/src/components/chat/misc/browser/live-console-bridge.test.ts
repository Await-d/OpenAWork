// @vitest-environment jsdom
/**
 * 实时（CDP）事件 → 控制台模型的映射覆盖。
 *
 * 钉住三件容易悄悄坏掉的事：级别归一（CDP 会给出 `warning` 这类别名）、网络三段
 * 归并（后到的响应不能把先到的请求头/请求体冲掉），以及拾取结果 → composer
 * markdown 的形状。
 */

import { describe, expect, it } from 'vitest';
import type { BrowserLiveNetworkPayload, BrowserLiveNodePayload } from '@openAwork/shared';
import {
  consolePayloadToEntry,
  errorPayloadToEntry,
  mapLiveConsoleLevel,
  networkPayloadToExchange,
  nodePayloadToMarkdown,
  upsertNetworkEntry,
} from './live-console-bridge.js';
import type {
  ConsoleEntry,
  ConsoleSourceMappedStackFrame,
  ConsoleStackFrame,
  NetworkExchange,
} from './browser-console-types.js';

const NOW = 1_700_000_000_000;

function networkPayload(
  overrides: Partial<BrowserLiveNetworkPayload> = {},
): BrowserLiveNetworkPayload {
  return {
    phase: 'request',
    requestId: 'req-1',
    method: 'POST',
    url: 'http://localhost:5173/api/login',
    requestHeadersSanitized: { 'content-type': 'application/json' },
    ...overrides,
  };
}

describe('mapLiveConsoleLevel', () => {
  it('把 CDP 的级别别名归一到面板级别', () => {
    expect(mapLiveConsoleLevel('info')).toBe('info');
    expect(mapLiveConsoleLevel('warn')).toBe('warn');
    expect(mapLiveConsoleLevel('warning')).toBe('warn');
    expect(mapLiveConsoleLevel('error')).toBe('error');
    expect(mapLiveConsoleLevel('debug')).toBe('debug');
    expect(mapLiveConsoleLevel('trace')).toBe('debug');
  });

  it('未知级别按 log 处理', () => {
    expect(mapLiveConsoleLevel('assert')).toBe('log');
    expect(mapLiveConsoleLevel(undefined)).toBe('log');
  });
});

describe('consolePayloadToEntry', () => {
  it('用传入的计数器生成 id，并保留载荷时间戳', () => {
    expect(
      consolePayloadToEntry({ level: 'warning', text: '已废弃', timestamp: NOW - 5 }, 7, NOW),
    ).toEqual({
      id: 'live-console-7',
      level: 'warn',
      message: '已废弃',
      timestamp: NOW - 5,
    });
  });

  it('时间戳非法时回落到当前时间', () => {
    const entry = consolePayloadToEntry({ level: 'log', text: 'x', timestamp: Number.NaN }, 8, NOW);

    expect(entry.timestamp).toBe(NOW);
  });
});

describe('consolePayloadToEntry 调用栈', () => {
  const RAW_STACK: ConsoleStackFrame[] = [
    { url: 'http://localhost:5173/assets/bundle.js', line: 0, column: 8, functionName: 'boom' },
  ];
  const MAPPED_STACK: ConsoleSourceMappedStackFrame[] = [
    {
      url: 'http://localhost:5173/assets/bundle.js',
      line: 0,
      column: 8,
      functionName: 'boom',
      source: 'console.error',
      sourceLine: 0,
      sourceColumn: 8,
      sourceName: 'original.ts',
      mapped: true,
    },
  ];

  it('保留 wire 上的 stack 与 sourceMappedStack', () => {
    const entry = consolePayloadToEntry(
      {
        level: 'error',
        text: 'mapped-boom',
        timestamp: NOW,
        stack: RAW_STACK,
        sourceMappedStack: MAPPED_STACK,
      },
      9,
      NOW,
    );

    expect(entry.stack).toEqual(RAW_STACK);
    expect(entry.sourceMappedStack).toEqual(MAPPED_STACK);
  });

  it('缺省 / 空数组时不产生栈字段', () => {
    const bare = consolePayloadToEntry({ level: 'log', text: 'x', timestamp: NOW }, 10, NOW);
    expect('stack' in bare).toBe(false);
    expect('sourceMappedStack' in bare).toBe(false);

    const empty = consolePayloadToEntry(
      { level: 'log', text: 'x', timestamp: NOW, stack: [], sourceMappedStack: [] },
      11,
      NOW,
    );
    expect('stack' in empty).toBe(false);
    expect('sourceMappedStack' in empty).toBe(false);
  });
});

describe('errorPayloadToEntry', () => {
  it('保留异常文案与调用栈', () => {
    const entry = errorPayloadToEntry(
      {
        code: 'page_error',
        message: 'boom',
        stack: [{ url: 'http://localhost:5173/app.js', line: 3, column: 1 }],
      },
      3,
      NOW,
    );

    expect(entry).toMatchObject({
      id: 'live-error-3',
      level: 'error',
      message: 'page_error: boom',
      timestamp: NOW,
    });
    expect(entry.stack).toEqual([{ url: 'http://localhost:5173/app.js', line: 3, column: 1 }]);
  });

  it('载荷缺省时回落到兜底 code，不产生栈字段', () => {
    const entry = errorPayloadToEntry(undefined, 4, NOW);

    expect(entry).toMatchObject({
      id: 'live-error-4',
      level: 'error',
      message: 'browser_live_error',
    });
    expect('stack' in entry).toBe(false);
  });
});

describe('networkPayloadToExchange', () => {
  it('request 阶段带请求头并标记 pending', () => {
    expect(networkPayloadToExchange(networkPayload())).toMatchObject({
      networkId: 'req-1',
      method: 'POST',
      url: 'http://localhost:5173/api/login',
      requestHeaders: { 'content-type': 'application/json' },
      pending: true,
    });
  });

  it('response 阶段带状态/耗时/响应头，不再 pending', () => {
    const response = networkPayloadToExchange(
      networkPayload({
        phase: 'response',
        status: 200,
        statusText: 'OK',
        durationMs: 12,
        responseHeadersSanitized: { 'x-trace': 'abc' },
      }),
    );

    expect(response.pending).toBeUndefined();
    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    expect(response.durationMs).toBe(12);
    expect(response.responseHeaders).toEqual({ 'x-trace': 'abc' });
  });

  it('failed 阶段带 errorText，不再 pending', () => {
    const failed = networkPayloadToExchange(
      networkPayload({ phase: 'failed', errorText: 'net::ERR_FAILED', durationMs: 30 }),
    );

    expect(failed.pending).toBeUndefined();
    expect(failed.errorMessage).toBe('net::ERR_FAILED');
  });
});

describe('upsertNetworkEntry', () => {
  it('同一 requestId 的三段上报归并成一行，响应到达后请求头仍在', () => {
    let entries: ConsoleEntry[] = upsertNetworkEntry(
      [],
      networkPayloadToExchange(networkPayload()),
      {
        now: NOW,
      },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe('network');
    expect(entries[0]?.message).toBe('⟶ POST http://localhost:5173/api/login');
    expect(entries[0]?.network?.pending).toBe(true);

    entries = upsertNetworkEntry(
      entries,
      networkPayloadToExchange(
        networkPayload({
          phase: 'response',
          status: 200,
          statusText: 'OK',
          durationMs: 12,
          responseHeadersSanitized: { 'x-trace': 'abc' },
        }),
      ),
      { now: NOW + 10 },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.network?.requestHeaders).toEqual({ 'content-type': 'application/json' });
    expect(entries[0]?.network?.responseHeaders).toEqual({ 'x-trace': 'abc' });
    expect(entries[0]?.network?.pending).toBeUndefined();
    expect(entries[0]?.message).toBe('⟵ 200 POST http://localhost:5173/api/login · 12ms');

    entries = upsertNetworkEntry(
      entries,
      networkPayloadToExchange(
        networkPayload({ phase: 'failed', errorText: 'net::ERR_FAILED', durationMs: 30 }),
      ),
      { now: NOW + 20 },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.network?.requestHeaders).toEqual({ 'content-type': 'application/json' });
    expect(entries[0]?.network?.errorMessage).toBe('net::ERR_FAILED');
    expect(entries[0]?.message).toBe(
      '✗ POST http://localhost:5173/api/login · 30ms · net::ERR_FAILED',
    );
  });

  it('响应阶段到达时不会丢掉先到的请求体（与 iframe 路径共享同一套归并语义）', () => {
    const requestWithBody: NetworkExchange = {
      networkId: 'req-body',
      source: 'fetch',
      method: 'POST',
      url: 'http://localhost:5173/api/submit',
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: '{"k":1}',
      pending: true,
    };

    let entries = upsertNetworkEntry([], requestWithBody, { now: NOW });
    entries = upsertNetworkEntry(
      entries,
      networkPayloadToExchange({
        phase: 'response',
        requestId: 'req-body',
        method: 'POST',
        url: 'http://localhost:5173/api/submit',
        status: 201,
        durationMs: 5,
      }),
      { now: NOW + 1 },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.network?.requestBody).toBe('{"k":1}');
    expect(entries[0]?.network?.status).toBe(201);
  });

  it('新建网络行时按 limit 丢弃最旧条目', () => {
    const base: ConsoleEntry[] = [
      { id: 'a', level: 'log', message: 'a', timestamp: NOW },
      { id: 'b', level: 'log', message: 'b', timestamp: NOW },
    ];

    const entries = upsertNetworkEntry(
      base,
      networkPayloadToExchange(networkPayload({ requestId: 'req-2' })),
      { now: NOW, limit: 1 },
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]?.id).toBe('b');
    expect(entries[1]?.network?.networkId).toBe('req-2');
  });
});

describe('nodePayloadToMarkdown', () => {
  const node: BrowserLiveNodePayload = {
    selector: '#app > button.submit',
    nodeName: 'BUTTON',
    attributes: { id: 'go', class: 'btn primary' },
    text: '提交',
    computedStyles: { display: 'flex', 'font-size': '14px', border: 'none', color: 'rgb(1, 2, 3)' },
  };

  it('输出选择器 / 标签 / 文本 / 属性 / 关键样式', () => {
    const markdown = nodePayloadToMarkdown(node);

    expect(markdown).toContain('### 元素拾取 `#app > button.submit`');
    expect(markdown).toContain('- 标签：`BUTTON`');
    expect(markdown).toContain('- 文本：提交');
    expect(markdown).toContain('`id` = `go`');
    expect(markdown).toContain('`class` = `btn primary`');
    expect(markdown).toContain('`display: flex`');
    expect(markdown).toContain('`color: rgb(1, 2, 3)`');
  });

  it('跳过无信息量的样式值（none / normal）', () => {
    expect(nodePayloadToMarkdown(node)).not.toContain('border');
  });

  it('压平换行、转义反引号并截断超长文本', () => {
    const markdown = nodePayloadToMarkdown({
      selector: 'div\n.x',
      nodeName: 'DIV',
      attributes: { title: 'a`b' },
      text: 'x'.repeat(500),
      computedStyles: {},
    });

    expect(markdown).toContain('`div .x`');
    expect(markdown).toContain("`title` = `a'b`");
    expect(markdown).toContain('x'.repeat(200));
    expect(markdown).not.toContain('x'.repeat(300));
  });

  it('400 条计算样式也只输出白名单键，绝不倾倒原始 map', () => {
    const computedStyles: Record<string, string> = {};
    for (let i = 0; i < 400; i += 1) {
      computedStyles[`--noise-${i}`] = `value-${i}`;
    }
    Object.assign(computedStyles, {
      display: 'grid',
      'font-family': 'Inter',
      'box-shadow': '0 0 0 1px red',
      filter: 'blur(2px)',
      color: 'rgb(9, 9, 9)',
    });

    const markdown = nodePayloadToMarkdown({
      selector: '#app',
      nodeName: 'DIV',
      attributes: {},
      text: '',
      computedStyles,
    });

    expect(markdown).toContain('`display: grid`');
    expect(markdown).toContain('`color: rgb(9, 9, 9)`');
    expect(markdown).not.toContain('font-family');
    expect(markdown).not.toContain('box-shadow');
    expect(markdown).not.toContain('filter');
    expect(markdown).not.toContain('--noise-0');
    expect(markdown).not.toContain('--noise-399');
    expect(markdown.split('\n').filter((line) => line.startsWith('  - `'))).toHaveLength(2);
  });

  it('超长属性值与样式值会被截断，不会把原文整段带出', () => {
    const long = 'a'.repeat(500);
    const markdown = nodePayloadToMarkdown({
      selector: '#app',
      nodeName: 'DIV',
      attributes: { class: long },
      text: '',
      computedStyles: { margin: long },
    });

    expect(markdown).toContain('a'.repeat(100));
    expect(markdown).not.toContain('a'.repeat(200));
    expect(markdown).toContain('…');
  });

  it('属性只保留白名单键，噪声属性不进入上下文', () => {
    const markdown = nodePayloadToMarkdown({
      selector: '#submit',
      nodeName: 'BUTTON',
      attributes: {
        'data-testid': 'submit-btn',
        id: 'submit',
        role: 'button',
        'aria-label': '提交表单',
        name: 'submit',
        type: 'button',
        class: 'btn primary',
        onclick: 'doEvil()',
        style: 'color: red',
        'aria-hidden': 'true',
        'data-analytics': 'track',
      },
      text: '',
      computedStyles: {},
    });

    expect(markdown).toContain('`data-testid` = `submit-btn`');
    expect(markdown).toContain('`aria-label` = `提交表单`');
    expect(markdown).toContain('`type` = `button`');
    expect(markdown).toContain('`class` = `btn primary`');
    expect(markdown).not.toContain('onclick');
    expect(markdown).not.toContain('doEvil');
    expect(markdown).not.toContain('aria-hidden');
    expect(markdown).not.toContain('data-analytics');
    expect(markdown).not.toContain('`style` =');
  });

  it('selectorStrategy 存在时输出选择器来源，缺失时不输出该行', () => {
    expect(nodePayloadToMarkdown({ ...node, selectorStrategy: 'data-testid' })).toContain(
      '- 选择器来源：`data-testid`',
    );

    const withoutStrategy = nodePayloadToMarkdown({
      selector: '#app',
      nodeName: 'DIV',
      attributes: {},
      text: '',
      computedStyles: {},
    });
    expect(withoutStrategy).not.toContain('选择器来源');
  });

  it('selectorUnique === false 时显式给出不唯一警告', () => {
    expect(nodePayloadToMarkdown({ ...node, selectorUnique: false })).toContain('不唯一');
    expect(nodePayloadToMarkdown({ ...node, selectorUnique: true })).not.toContain('不唯一');
    expect(nodePayloadToMarkdown(node)).not.toContain('不唯一');
  });

  it('总块长度受上限约束，超限时给出截断说明', () => {
    const long = 'x'.repeat(500);
    const attributes: Record<string, string> = {};
    for (const key of [
      'data-testid',
      'id',
      'role',
      'aria-label',
      'name',
      'type',
      'class',
      'title',
    ]) {
      attributes[key] = long;
    }
    const computedStyles: Record<string, string> = {};
    for (const key of [
      'display',
      'position',
      'width',
      'height',
      'color',
      'background-color',
      'font-size',
      'font-weight',
      'margin',
      'padding',
      'border-radius',
      'z-index',
      'opacity',
      'visibility',
      'overflow',
    ]) {
      computedStyles[key] = long;
    }

    const markdown = nodePayloadToMarkdown({
      selector: `#${long}`,
      nodeName: 'DIV',
      attributes,
      text: long,
      computedStyles,
    });

    expect(markdown.length).toBeLessThan(1700);
    expect(markdown).toContain('已截断');
  });

  it('输出稳定可 diff：不含时间戳，同一载荷两次结果一致', () => {
    const first = nodePayloadToMarkdown(node);
    const second = nodePayloadToMarkdown(node);
    const longForm = nodePayloadToMarkdown({
      ...node,
      selectorStrategy: 'css-path',
      selectorUnique: false,
      text: 'y'.repeat(500),
    });

    expect(second).toBe(first);
    expect(longForm).toBe(
      nodePayloadToMarkdown({
        ...node,
        selectorStrategy: 'css-path',
        selectorUnique: false,
        text: 'y'.repeat(500),
      }),
    );
    expect(first).not.toMatch(/(^|\D)\d{13}(\D|$)/);
    expect(longForm).not.toMatch(/(^|\D)\d{13}(\D|$)/);
  });
});
