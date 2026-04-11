// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderPage() {
  const { default: TeamPage } = await import('./TeamPage.js');
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/team']}>
        <TeamPage />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

describe('TeamPage office reference detail', () => {
  it('renders the left template rail and visible template groups', async () => {
    await renderPage();

    expect(container?.textContent).toContain('运行中');
    expect(container?.textContent).toContain('历史记录');
    expect(container?.textContent).toContain('模板');
    expect(container?.textContent).toContain('开发团队');
    expect(container?.textContent).toContain('研究团队');
    expect(container?.textContent).toContain('短视频学习助手开...');
    expect(container?.textContent).toContain('轻量进销存官网搭...');
  });

  it('renders the top office controls and role chips', async () => {
    await renderPage();

    expect(container?.textContent).toContain('← 返回普通模式');
    expect(container?.textContent).toContain('▶ 恢复');
    expect(container?.textContent).toContain('团队负责人');
    expect(container?.textContent).toContain('研究员A');
    expect(container?.textContent).toContain('研究员B');
    expect(container?.textContent).toContain('批评者');
  });
});
