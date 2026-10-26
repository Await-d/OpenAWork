// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useDisplayPreferencesStore } from '../../../../stores/settings/display-preferences.js';
import { DesktopToolCard } from './desktop-tool-card.js';

beforeEach(() => {
  useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });
});

afterEach(() => {
  cleanup();
  useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });
});

function expandCard(container: HTMLElement): void {
  const header = container.querySelector('.tool-call-block-header');
  if (!header) throw new Error('未渲染卡片头');
  fireEvent.click(header);
}

describe('DesktopToolCard', () => {
  it('折叠态标题标明通道，摘要给出动作 + 目标', () => {
    const { container } = render(
      <DesktopToolCard
        toolName="desktop_control"
        input={{ action: 'click', x: 120, y: 80 }}
        output={JSON.stringify({ ok: true })}
        status="completed"
      />,
    );

    expect(screen.getByText('桌面控制')).toBeTruthy();
    expect(screen.getByText('点击 · (120, 80)')).toBeTruthy();
    // 默认折叠：不渲染展开体。
    expect(container.querySelector('.tool-call-block-body')).toBeNull();
  });

  it('浏览器自动化的读取类动作使用「浏览器自动化」标题', () => {
    render(
      <DesktopToolCard
        toolName="desktop_automation"
        input={{ action: 'status' }}
        output={JSON.stringify({ enabled: true, started: false })}
        status="completed"
      />,
    );

    expect(screen.getByText('浏览器自动化')).toBeTruthy();
    expect(screen.getByText('读取运行状态')).toBeTruthy();
  });

  it('确认型动作展开后只给动作上下文，不再渲染 {ok:true} 字段表', () => {
    const { container } = render(
      <DesktopToolCard
        toolName="desktop_automation"
        input={{ action: 'goto', url: 'https://example.com' }}
        output={JSON.stringify({ ok: true })}
        status="completed"
      />,
    );

    expandCard(container);

    expect(container.querySelector('.tool-call-block-body')).not.toBeNull();
    expect(container.textContent).toContain('打开网页');
    expect(container.textContent).toContain('https://example.com');
    expect(container.querySelector('.structured-output')).toBeNull();
  });

  it('读取类动作展开后展示专用视图（状态行）', () => {
    const { container } = render(
      <DesktopToolCard
        toolName="desktop_automation"
        input={{ action: 'status' }}
        output={JSON.stringify({ enabled: true, started: true })}
        status="completed"
      />,
    );

    expandCard(container);

    expect(container.textContent).toContain('已启动');
    expect(container.textContent).toContain('enabled=true');
  });

  it('认不出形状的读取类输出回退通用渲染', () => {
    const { container } = render(
      <DesktopToolCard
        toolName="desktop_automation"
        input={{ action: 'find' }}
        output={JSON.stringify({ unexpected: 'shape' })}
        status="completed"
      />,
    );

    expandCard(container);

    expect(container.querySelector('.structured-output')).not.toBeNull();
    expect(container.textContent).toContain('unexpected');
  });

  it('失败时显示失败原因横幅', () => {
    const { container } = render(
      <DesktopToolCard
        toolName="desktop_control"
        input={{ action: 'click', x: 1, y: 2 }}
        output={JSON.stringify({ ok: false, error: 'bridge unavailable' })}
        status="completed"
        isError
      />,
    );

    expandCard(container);

    expect(screen.getByRole('alert').textContent).toContain('bridge unavailable');
  });
});
