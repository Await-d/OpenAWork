import { describe, expect, it } from 'vitest';

import { parseDesktopOutput } from './desktop-output-view.js';

describe('parseDesktopOutput — 状态', () => {
  it('解析 enabled / started', () => {
    const node = parseDesktopOutput('status', JSON.stringify({ enabled: true, started: false }));

    expect(node).toEqual({ kind: 'status', enabled: true, started: false });
  });

  it('字段全缺时退回 none（交给通用渲染）', () => {
    expect(parseDesktopOutput('status', {})).toEqual({ kind: 'none' });
  });
});

describe('parseDesktopOutput — 控制台', () => {
  it('解析消息与页面错误，并保留截断标记', () => {
    const node = parseDesktopOutput(
      'console',
      JSON.stringify({
        messages: [
          { level: 'log', text: 'ready', timestamp: 1 },
          { level: 'error', text: 'boom', timestamp: 2 },
          { level: 'log' },
        ],
        errors: [{ message: 'Uncaught TypeError', timestamp: 3 }],
        truncated: true,
      }),
    );

    expect(node.kind).toBe('console');
    if (node.kind !== 'console') throw new Error('应为 console 节点');
    expect(node.messages).toHaveLength(2);
    expect(node.messages[0]?.level).toBe('log');
    expect(node.errors).toHaveLength(1);
    expect(node.truncated).toBe(true);
  });

  it('只有 errors 时同样可用', () => {
    const node = parseDesktopOutput('console', { errors: [{ message: 'x' }] });

    expect(node.kind).toBe('console');
    if (node.kind !== 'console') throw new Error('应为 console 节点');
    expect(node.messages).toEqual([]);
    expect(node.errors[0]?.message).toBe('x');
  });

  it('两个字段都不是数组时退回 none', () => {
    expect(parseDesktopOutput('console', { messages: 'nope' })).toEqual({ kind: 'none' });
  });
});

describe('parseDesktopOutput — 网络', () => {
  it('列表解析 method / status / url / 耗时', () => {
    const node = parseDesktopOutput('network_list', {
      requests: [
        { id: 'r1', method: 'POST', url: 'https://a.test/api', status: 201, durationMs: 12.4 },
        { id: 'r2', method: 'GET', url: '', status: 200 },
      ],
      truncated: false,
    });

    expect(node.kind).toBe('network-list');
    if (node.kind !== 'network-list') throw new Error('应为 network-list 节点');
    expect(node.requests).toHaveLength(1);
    expect(node.requests[0]?.method).toBe('POST');
    expect(node.requests[0]?.durationMs).toBe(12.4);
  });

  it('单条请求解析 request 包装', () => {
    const node = parseDesktopOutput('network_get', {
      request: { id: 'r1', method: 'GET', url: 'https://a.test', failureText: 'net::ERR' },
    });

    expect(node.kind).toBe('network-request');
    if (node.kind !== 'network-request') throw new Error('应为 network-request 节点');
    expect(node.request.failureText).toBe('net::ERR');
  });

  it('缺少 requests / request 时退回 none', () => {
    expect(parseDesktopOutput('network_list', {})).toEqual({ kind: 'none' });
    expect(parseDesktopOutput('network_get', {})).toEqual({ kind: 'none' });
  });
});

describe('parseDesktopOutput — 元素 / iframe / 快照', () => {
  it('find 解析 matches（tag 缺失的条目跳过）', () => {
    const node = parseDesktopOutput('find', {
      matches: [{ tag: 'button', id: 'save', text: '保存', visible: true }, { id: 'no-tag' }],
    });

    expect(node.kind).toBe('elements');
    if (node.kind !== 'elements') throw new Error('应为 elements 节点');
    expect(node.matches).toHaveLength(1);
    expect(node.matches[0]?.id).toBe('save');
  });

  it('frames 解析主框架标记', () => {
    const node = parseDesktopOutput('frames', {
      frames: [
        { index: 0, name: 'main', url: 'https://a.test', isMain: true },
        { index: 1, name: '', url: 'https://b.test' },
      ],
    });

    expect(node.kind).toBe('frames');
    if (node.kind !== 'frames') throw new Error('应为 frames 节点');
    expect(node.frames).toHaveLength(2);
    expect(node.frames[0]?.isMain).toBe(true);
  });

  it('snapshot 解析 url / title / openPages（过滤非字符串）', () => {
    const node = parseDesktopOutput('snapshot', {
      snapshot: { url: 'https://a.test', title: 'A', openPages: ['https://a.test', 42] },
    });

    expect(node).toEqual({
      kind: 'snapshot',
      url: 'https://a.test',
      title: 'A',
      openPages: ['https://a.test'],
    });
  });
});

describe('parseDesktopOutput — 结果 / 内容 / 选择', () => {
  it('evaluate 取 result（null 也保留）', () => {
    expect(parseDesktopOutput('evaluate', { result: null })).toEqual({ kind: 'json', value: null });
    expect(parseDesktopOutput('evaluate', { result: { a: 1 } })).toEqual({
      kind: 'json',
      value: { a: 1 },
    });
  });

  it('select 取 selected 数组', () => {
    expect(parseDesktopOutput('select', { selected: ['a', 'b'] })).toEqual({
      kind: 'json',
      value: ['a', 'b'],
    });
  });

  it('content 支持 content / html 两种字段', () => {
    expect(parseDesktopOutput('content', { content: '<div />' })).toEqual({
      kind: 'text',
      text: '<div />',
    });
    expect(parseDesktopOutput('content', { html: '<p />' })).toEqual({
      kind: 'text',
      text: '<p />',
    });
  });

  it('未知动作 / 非 JSON / 非对象一律 none', () => {
    expect(parseDesktopOutput('status', 'not json')).toEqual({ kind: 'none' });
    expect(parseDesktopOutput('status', null)).toEqual({ kind: 'none' });
    expect(parseDesktopOutput('goto', { ok: true })).toEqual({ kind: 'none' });
  });
});
