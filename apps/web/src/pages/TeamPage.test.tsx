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

async function clickTab(label: string) {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find(
    (candidate) => candidate.textContent?.trim() === label,
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

describe('TeamPage office reference layout', () => {
  it('renders the official Agent Teams office shell', async () => {
    await renderPage();

    expect(container?.textContent).toContain('SpectrAI');
    expect(container?.textContent).toContain('AGENT TEAMS');
    expect(container?.textContent).toContain('研究团队-2026-03-31');
    expect(container?.textContent).toContain('已暂停');
    expect(container?.textContent).toContain('4 成员');
    expect(container?.textContent).toContain('4 在线');
    expect(container?.textContent).toContain('团队工作空间');
    expect(container?.textContent).toContain('活跃 3 / 共 135');
    expect(container?.textContent).toContain('运行 16m 41s');
    expect(container?.textContent).toContain('＋ 新建团队模板');
  });

  it('renders the office tab by default with the pixel office scene labels', async () => {
    await renderPage();

    expect(container?.textContent).toContain('滚轮缩放 · 拖拽平移 60%');
    expect(container?.textContent).toContain('[L] 团队负责人');
    expect(container?.textContent).toContain('研究员A');
    expect(container?.textContent).toContain('批评者');
    expect(container?.textContent).toContain('办公室安全提示');
  });

  it('switches top tabs to the other placeholder panels', async () => {
    await renderPage();

    await clickTab('对话');
    expect(container?.textContent).toContain('团队对话流');

    await clickTab('任务');
    expect(container?.textContent).toContain('任务队列');

    await clickTab('消息');
    expect(container?.textContent).toContain('团队消息总线');

    await clickTab('状态总览');
    expect(container?.textContent).toContain('状态总览');

    await clickTab('评审');
    expect(container?.textContent).toContain('评审队列');
  });
});
