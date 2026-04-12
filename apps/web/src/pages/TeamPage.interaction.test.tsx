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

    expect(container?.textContent).toContain('会话');
    expect(container?.textContent).toContain('模板');
    expect(container?.textContent).toContain('OpenAWork');
    expect(container?.textContent).toContain('windsurf_openai_api');
    expect(container?.textContent).toContain('未绑定工作区');
    expect(container?.textContent).toContain('运行中');
    expect(container?.textContent).toContain('研究团队');
    expect(container?.textContent).toContain('短视频学习助手开...');
    expect(container?.textContent).toContain('轻量讲解有官网搭...');
  });

  it('renders the top office controls and role chips', async () => {
    await renderPage();

    expect(container?.textContent).toContain('运行状态由共享会话驱动');
    expect(container?.textContent).toContain('团队负责人');
    expect(container?.textContent).toContain('研究员A');
    expect(container?.textContent).toContain('研究员B');
    expect(container?.textContent).toContain('批评者');
    expect(container?.textContent).toContain('Leader');
    expect(container?.textContent).toContain('弹出');
  });

  it('renders deeper office scene labels and stacked agent notes', async () => {
    await renderPage();

    expect(container?.textContent).toContain('POWER_BAR');
    expect(container?.textContent).toContain('等待他的批准');
    expect(container?.textContent).toContain('场景控制');
    expect(container?.textContent).toContain('场景信息');
    expect(container?.textContent).toContain('在线角色3/3');
  });
});
