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

async function clickMainTab(label: string) {
  const button = Array.from(container?.querySelectorAll('[role="tab"]') ?? []).find((candidate) =>
    candidate.textContent?.includes(label),
  ) as HTMLButtonElement | undefined;

  expect(button).toBeTruthy();

  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}

async function clickButton(label: string) {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find((candidate) =>
    candidate.textContent?.includes(label),
  ) as HTMLButtonElement | undefined;

  expect(button).toBeTruthy();

  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.innerWidth = 1680;
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

describe('TeamPage reference layout', () => {
  it('renders the mock SpectrAI-style shell sections', async () => {
    await renderPage();

    expect(container?.textContent).toContain('OpenAWork / Team Runtime');
    expect(container?.textContent).toContain('团队运行工作台');
    expect(container?.textContent).toContain('工作台导航');
    expect(container?.textContent).toContain('Main panel');
    expect(container?.textContent).toContain('Detail rail');
    expect(container?.textContent).toContain('ClaudeOps Sprint Sync');
    expect(container?.textContent).toContain('30 天 Token 趋势');
    expect(container?.textContent).toContain('会话 Token 分布');
    expect(container?.textContent).toContain('工作区：/repo/claudeops');
  });

  it('switches main workspace tabs to different mock panels', async () => {
    await renderPage();

    await clickMainTab('会话');
    expect(container?.textContent).toContain('子任务追踪');
    expect(container?.textContent).toContain('Claude Code · desk_code/claudeops');

    await clickMainTab('文件');
    expect(container?.textContent).toContain('文件资源管理器');
    expect(container?.textContent).toContain('会话改动列表');
    expect(container?.textContent).toContain('代码预览');

    await clickMainTab('看板');
    expect(container?.textContent).toContain('待办');
    expect(container?.textContent).toContain('进行中');
    expect(container?.textContent).toContain('已完成');
  });

  it('updates the selected shared run from the left sidebar mock list', async () => {
    await renderPage();
    await clickButton('/repo/openawork');
    await clickButton('Agent Tree Audit');

    expect(container?.textContent).toContain('当前会话');
    expect(container?.textContent).toContain('Agent Tree Audit');
    expect(container?.textContent).toContain('review@spectrai.local');
  });

  it('shows pane controls for the mock workbench shell', async () => {
    await renderPage();

    expect(
      container?.querySelector('button[aria-label="折叠导航侧栏"]') as HTMLButtonElement | null,
    ).toBeTruthy();
    expect(
      container?.querySelector('button[aria-label="折叠细节轨"]') as HTMLButtonElement | null,
    ).toBeTruthy();
    expect(
      container?.querySelector('button[aria-label="重置工作台布局"]') as HTMLButtonElement | null,
    ).toBeTruthy();
  });
});
