// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../stores/auth.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
let failNextInteractionCompletion = false;
let failNextInteractionProcessing = false;
let teamMessages: Array<{
  content: string;
  id: string;
  memberId: string;
  timestamp: number;
  type: 'update' | 'question' | 'result' | 'error';
}> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  useAuthStore.setState({ accessToken: 'token-123', gatewayUrl: 'http://localhost:3000' });
  failNextInteractionCompletion = false;
  failNextInteractionProcessing = false;
  teamMessages = [
    {
      id: 'msg-1',
      memberId: 'member-1',
      content: '我先认领协作页面。',
      type: 'update',
      timestamp: Date.parse('2026-04-04T00:00:00.000Z'),
    },
  ];

  fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, 'http://localhost:3000');
    const method = init?.method ?? 'GET';

    if (url.pathname.endsWith('/team/runtime') && method === 'GET') {
      return {
        ok: true,
        json: async () => ({
          auditLogs: [],
          members: [
            {
              id: 'member-1',
              name: '林雾',
              email: 'linwu@openawork.local',
              role: 'owner',
              avatarUrl: null,
              status: 'working',
              createdAt: '2026-04-04T00:00:00.000Z',
            },
          ],
          messages: teamMessages,
          runtimeTaskGroups: [],
          sessionShares: [],
          sessions: [],
          sharedSessions: [],
          tasks: [],
        }),
      } as Response;
    }

    if (url.pathname.endsWith('/agents') && method === 'GET') {
      return {
        ok: true,
        json: async () => ({
          agents: [
            {
              id: 'agent-planner-1',
              label: 'Planner Prime',
              description: '负责规划拆解',
              aliases: [],
              canonicalRole: { coreRole: 'planner', preset: 'architect', confidence: 'medium' },
              model: 'gpt-5.4',
              variant: null,
              fallbackModels: [],
              systemPrompt: null,
              note: null,
              origin: 'builtin',
              source: 'system',
              enabled: true,
              removable: false,
              resettable: true,
              hasOverrides: false,
              createdAt: '2026-04-04T00:00:00.000Z',
              updatedAt: '2026-04-04T00:00:00.000Z',
            },
          ],
        }),
      } as Response;
    }

    if (url.pathname.endsWith('/capabilities') && method === 'GET') {
      return {
        ok: true,
        json: async () => ({
          capabilities: [
            {
              id: 'cap-1',
              kind: 'tool',
              label: '任务拆解',
              description: '适合拆解复杂任务',
              source: 'system',
              enabled: true,
              callable: true,
              canonicalRole: { coreRole: 'planner', preset: 'architect', confidence: 'medium' },
            },
          ],
        }),
      } as Response;
    }

    if (url.pathname.endsWith('/team/messages') && method === 'POST') {
      const payload = JSON.parse(String(init?.body ?? '{}')) as {
        content?: string;
        senderId?: string;
        type?: 'update' | 'question' | 'result' | 'error';
      };

      if (
        failNextInteractionProcessing &&
        payload.content === '【interaction-agent/处理中】已接收该请求，正在整理下一步动作。'
      ) {
        failNextInteractionProcessing = false;
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'processing write failed' }),
        } as Response;
      }

      if (
        failNextInteractionCompletion &&
        payload.content ===
          '【interaction-agent/完成】已完成初步改写：请围绕“请先梳理当前阻塞并给出下一步建议”继续拆解团队任务。'
      ) {
        failNextInteractionCompletion = false;
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'completion write failed' }),
        } as Response;
      }

      const nextMessage = {
        id: `msg-${teamMessages.length + 1}`,
        memberId: payload.senderId ?? '',
        content: payload.content ?? '',
        type: payload.type ?? 'update',
        timestamp: Date.now(),
      };
      teamMessages = [...teamMessages, nextMessage];
      return {
        ok: true,
        json: async () => nextMessage,
      } as Response;
    }

    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderPage(initialEntry = '/team') {
  const { default: TeamPage } = await import('./TeamPage.js');
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <TeamPage />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('TeamPage interaction agent flow', () => {
  it('keeps interaction-agent draft isolated from the timeline composer', async () => {
    await renderPage();

    const interactionTextarea = container?.querySelector(
      'textarea[aria-label="interaction-agent 输入区"]',
    ) as HTMLTextAreaElement | null;
    expect(interactionTextarea).toBeTruthy();

    await act(async () => {
      if (interactionTextarea) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(interactionTextarea, '让 interaction-agent 先改写这条需求');
        interactionTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await Promise.resolve();
    });

    const messageTextarea = container?.querySelector(
      'textarea[name="team-message-content"]',
    ) as HTMLTextAreaElement | null;
    expect(messageTextarea?.value ?? '').toBe('');
  });

  it('submits the interaction-agent draft into the team timeline', async () => {
    await renderPage();

    const interactionTextarea = container?.querySelector(
      'textarea[aria-label="interaction-agent 输入区"]',
    ) as HTMLTextAreaElement | null;
    const submitButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('交由 interaction-agent'),
    ) as HTMLButtonElement | undefined;

    expect(interactionTextarea).toBeTruthy();
    expect(submitButton).toBeTruthy();

    await act(async () => {
      if (interactionTextarea) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(interactionTextarea, '请先梳理当前阻塞并给出下一步建议');
        interactionTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await Promise.resolve();
    });

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('消息时间线');
    expect(container?.textContent).toContain('interaction-agent');
    expect(container?.textContent).toContain('发起');
    expect(container?.textContent).toContain('处理中');
    expect(container?.textContent).toContain('完成');
    expect(container?.textContent).toContain('请先梳理当前阻塞并给出下一步建议');
    expect(container?.textContent).toContain('已接收该请求，正在整理下一步动作。');
    expect(container?.textContent).toContain(
      '已完成初步改写：请围绕“请先梳理当前阻塞并给出下一步建议”继续拆解团队任务。',
    );
    expect(container?.textContent).toContain('question');
    expect(container?.textContent).toContain('结果');
    expect(interactionTextarea?.value ?? '').toBe('');
  });

  it('keeps the interaction-agent draft when the processing status write fails', async () => {
    failNextInteractionProcessing = true;
    await renderPage();

    const interactionTextarea = container?.querySelector(
      'textarea[aria-label="interaction-agent 输入区"]',
    ) as HTMLTextAreaElement | null;
    const submitButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('交由 interaction-agent'),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      if (interactionTextarea) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(interactionTextarea, '请帮我继续补充失败路径');
        interactionTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await Promise.resolve();
    });

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(interactionTextarea?.value ?? '').toBe('请帮我继续补充失败路径');
    expect(container?.textContent).not.toContain('已接收该请求，正在整理下一步动作。');
    expect(container?.textContent).toContain('Failed to create team message: 500');
  });

  it('keeps the interaction-agent draft when the completion write fails', async () => {
    failNextInteractionCompletion = true;
    await renderPage();

    const interactionTextarea = container?.querySelector(
      'textarea[aria-label="interaction-agent 输入区"]',
    ) as HTMLTextAreaElement | null;
    const submitButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('交由 interaction-agent'),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      if (interactionTextarea) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(interactionTextarea, '请先梳理当前阻塞并给出下一步建议');
        interactionTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await Promise.resolve();
    });

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(interactionTextarea?.value ?? '').toBe('请先梳理当前阻塞并给出下一步建议');
    expect(container?.textContent).not.toContain(
      '已完成初步改写：请围绕“请先梳理当前阻塞并给出下一步建议”继续拆解团队任务。',
    );
    expect(container?.textContent).toContain('Failed to create team message: 500');
  });
});
