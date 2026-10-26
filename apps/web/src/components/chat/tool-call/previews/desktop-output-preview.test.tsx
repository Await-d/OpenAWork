// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { parseDesktopOutput } from '../shared/desktop-output-view.js';
import { DesktopOutputPreview } from './desktop-output-preview.js';

afterEach(cleanup);

describe('DesktopOutputPreview — 状态', () => {
  it('已启动用成功态文案', () => {
    render(
      <DesktopOutputPreview
        node={parseDesktopOutput('status', { enabled: true, started: true })}
      />,
    );

    expect(screen.getByText('已启动')).toBeTruthy();
    expect(screen.getByText('enabled=true · started=true')).toBeTruthy();
  });

  it('未启用优先于未启动', () => {
    render(
      <DesktopOutputPreview
        node={parseDesktopOutput('status', { enabled: false, started: false })}
      />,
    );

    expect(screen.getByText('浏览器自动化未启用')).toBeTruthy();
  });
});

describe('DesktopOutputPreview — 控制台', () => {
  it('逐条渲染消息与页面错误', () => {
    const node = parseDesktopOutput('console', {
      messages: [
        { level: 'log', text: 'ready' },
        { level: 'warn', text: 'slow' },
      ],
      errors: [{ message: 'Uncaught TypeError' }],
    });

    const { container } = render(<DesktopOutputPreview node={node} />);

    expect(container.textContent).toContain('ready');
    expect(container.textContent).toContain('slow');
    expect(container.textContent).toContain('页面错误');
    expect(container.textContent).toContain('Uncaught TypeError');
  });

  it('空控制台给出空态', () => {
    render(<DesktopOutputPreview node={parseDesktopOutput('console', { messages: [] })} />);

    expect(screen.getByText('（控制台没有捕获到消息）')).toBeTruthy();
  });

  it('截断时提示较早消息已淘汰', () => {
    const { container } = render(
      <DesktopOutputPreview
        node={parseDesktopOutput('console', {
          messages: [{ level: 'log', text: 'x' }],
          truncated: true,
        })}
      />,
    );

    expect(container.textContent).toContain('已按上限截断');
  });
});

describe('DesktopOutputPreview — 网络', () => {
  it('按行展示方法 / 状态 / 地址 / 耗时', () => {
    const { container } = render(
      <DesktopOutputPreview
        node={parseDesktopOutput('network_list', {
          requests: [
            { id: 'r1', method: 'POST', url: 'https://a.test/api', status: 201, durationMs: 12.6 },
          ],
        })}
      />,
    );

    expect(container.textContent).toContain('POST');
    expect(container.textContent).toContain('201');
    expect(container.textContent).toContain('https://a.test/api');
    expect(container.textContent).toContain('13ms');
  });

  it('失败请求显示失败标记', () => {
    const { container } = render(
      <DesktopOutputPreview
        node={parseDesktopOutput('network_list', {
          requests: [{ id: 'r1', method: 'GET', url: 'https://a.test', failureText: 'net::ERR' }],
        })}
      />,
    );

    expect(container.textContent).toContain('失败');
  });

  it('空列表给出空态', () => {
    render(<DesktopOutputPreview node={parseDesktopOutput('network_list', { requests: [] })} />);

    expect(screen.getByText('（没有捕获到网络请求）')).toBeTruthy();
  });

  it('单条请求展示键值行', () => {
    const { container } = render(
      <DesktopOutputPreview
        node={parseDesktopOutput('network_get', {
          request: {
            id: 'r1',
            method: 'GET',
            url: 'https://a.test',
            status: 200,
            resourceType: 'xhr',
          },
        })}
      />,
    );

    expect(container.textContent).toContain('方法');
    expect(container.textContent).toContain('xhr');
  });
});

describe('DesktopOutputPreview — 元素 / iframe / 快照', () => {
  it('元素行展示 tag#id 与隐藏标记', () => {
    const { container } = render(
      <DesktopOutputPreview
        node={parseDesktopOutput('find', {
          matches: [
            { tag: 'button', id: 'save', text: '保存', visible: false },
            { tag: 'input', text: '搜索', visible: true },
          ],
        })}
      />,
    );

    expect(container.textContent).toContain('button#save');
    expect(container.textContent).toContain('隐藏');
    expect(container.textContent).toContain('input');
  });

  it('iframe 行标注主框架', () => {
    const { container } = render(
      <DesktopOutputPreview
        node={parseDesktopOutput('frames', {
          frames: [{ index: 0, name: 'main', url: 'https://a.test', isMain: true }],
        })}
      />,
    );

    expect(container.textContent).toContain('主框架');
  });

  it('快照展示标题 / 地址 / 打开页面数', () => {
    const { container } = render(
      <DesktopOutputPreview
        node={parseDesktopOutput('snapshot', {
          snapshot: { url: 'https://a.test', title: '示例页', openPages: ['https://a.test'] },
        })}
      />,
    );

    expect(container.textContent).toContain('示例页');
    expect(container.textContent).toContain('https://a.test');
    expect(container.textContent).toContain('1 个打开页面');
  });
});

describe('DesktopOutputPreview — 兜底', () => {
  it('none 不渲染任何内容（由卡片回退通用视图）', () => {
    const { container } = render(<DesktopOutputPreview node={{ kind: 'none' }} />);

    expect(container.textContent).toBe('');
  });
});
