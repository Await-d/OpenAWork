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

async function clickDetailRailTab(label: string) {
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

describe('TeamPage mock detail rail interactions', () => {
  it('switches detail rail panels in the mock workbench shell', async () => {
    await renderPage();

    await clickDetailRailTab('Buddy');
    expect(container?.textContent).toContain('Buddy / Hubby runtime');

    await clickDetailRailTab('角色绑定');
    expect(container?.textContent).toContain('执行角色绑定');
    expect(container?.textContent).toContain('Planner Prime');

    await clickDetailRailTab('交互代理');
    expect(
      container?.querySelector('textarea[aria-label="interaction-agent 输入区"]'),
    ).toBeTruthy();
  });

  it('submits the mock interaction agent draft and shows feedback', async () => {
    await renderPage();
    await clickDetailRailTab('交互代理');

    const textarea = container?.querySelector(
      'textarea[aria-label="interaction-agent 输入区"]',
    ) as HTMLTextAreaElement | null;
    const submitButton = Array.from(container?.querySelectorAll('button') ?? []).find((candidate) =>
      candidate.textContent?.includes('交由 interaction-agent'),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, '先完成参考页布局');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container?.textContent).toContain(
      '已将 mock 指令“先完成参考页布局”投递到交互代理预览。',
    );
    expect(textarea?.value ?? '').toBe('');
  });
});
