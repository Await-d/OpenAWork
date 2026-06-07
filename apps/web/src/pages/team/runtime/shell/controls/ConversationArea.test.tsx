// @vitest-environment jsdom
/**
 * 260517 · ConversationArea 三态路由 Smoke 测试
 *
 * 验收 chat-conversation-reuse-plan v1.4 §9.1 的关键契约：
 *
 *   1. messagesOverride 注入 → 直接 pass-through，**不**渲染 TeamConversationView，
 *      也**不**渲染 idle/loading 面板。
 *   2. messagesOverride 缺省 + receptionSessionId 存在 → 内嵌 TeamConversationView
 *      （以测试 mock 形式断言其 sessionId 入参与 composerEnabled flag 透传）。
 *   3. messagesOverride 缺省 + receptionSessionId 为空 → 走 idle/loading/error
 *      引导面板，不渲染 TeamConversationView。
 *
 * TeamConversationView 自身的 Chat 渲染走 useSessionConversationState，已有专门测试，
 * 此处只测 ConversationArea 的"路由分支"。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('../../../../../stores/team/team-events.js', async () => {
  const actual = await vi.importActual('../../../../../stores/team/team-events.js');
  return {
    ...actual,
    useTeamNotificationStore: (selector: (state: { events: unknown[] }) => unknown) =>
      selector({
        events: [
          {
            type: 'session.inbound.submitted',
            timestamp: Date.parse('2026-06-06T10:00:00.000Z'),
            payload: {
              blocking: true,
              reason: 'needs_clarification',
              context: 'PM1 需要你先补充仓库与部署约束',
              questions: [
                { id: 'clarify-1', question: '仓库地址是什么？' },
                { id: 'clarify-2', question: '部署到哪里？' },
              ],
              suggestedActions: [
                { label: 'GitHub', action: 'select' },
                { label: 'Google', action: 'select' },
              ],
            },
          },
        ],
      }),
    useClarificationStore: (selector: (state: { items: unknown[] }) => unknown) =>
      selector({
        items: [],
      }),
  };
});

// 测试期把 TeamConversationView 替换成最小桩，便于断言 sessionId / composerEnabled 透传
vi.mock('../../../conversation/TeamConversationView.js', () => ({
  TeamConversationView: ({
    sessionId,
    composerEnabled,
    afterMessages,
  }: {
    sessionId: string;
    composerEnabled?: boolean;
    afterMessages?: ReactNode;
  }) => (
    <div
      data-testid="team-session-view-mock"
      data-session-id={sessionId}
      data-composer-enabled={composerEnabled ? 'true' : 'false'}
    >
      <div>mock-team-session</div>
      <div data-testid="team-session-view-after-messages">{afterMessages}</div>
    </div>
  ),
}));

// 没有真实数据 provider 时 useTeamRuntimeReferenceViewData 会回落到 EMPTY_VIEW_DATA
// （loading=false, error=null, ...）—— 不需要在测试里再 stub。

import { ConversationArea } from './ConversationArea.js';

beforeEach(() => {
  // useTeamNotificationStore 是 zustand store，重置 events 防止跨用例污染
  // （store 模块缓存在测试运行期内，无法 importOriginal 重置）
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ConversationArea — 三态路由', () => {
  it('messagesOverride 注入时直接 pass-through，不渲染 TeamConversationView', () => {
    render(
      <ConversationArea
        messagesOverride={<div data-testid="injected-content">injected</div>}
        receptionSessionId="should-be-ignored"
      />,
    );

    expect(screen.getByTestId('injected-content')).toBeTruthy();
    expect(screen.queryByTestId('team-session-view-mock')).toBeNull();
  });

  it('receptionSessionId 存在 + messagesOverride 缺省 → 内嵌 TeamConversationView', () => {
    render(<ConversationArea receptionSessionId="b-session-001" />);

    const mock = screen.getByTestId('team-session-view-mock');
    expect(mock.getAttribute('data-session-id')).toBe('b-session-001');
    expect(mock.getAttribute('data-composer-enabled')).toBe('false');
  });

  it('receptionComposerEnabled=true 时透传到 TeamConversationView', () => {
    render(<ConversationArea receptionSessionId="b-session-002" receptionComposerEnabled />);

    const mock = screen.getByTestId('team-session-view-mock');
    expect(mock.getAttribute('data-composer-enabled')).toBe('true');
  });

  it('receptionSessionId 为空 + messagesOverride 缺省 → 走 idle 引导面板', () => {
    render(<ConversationArea receptionSessionId={null} />);

    expect(screen.queryByTestId('team-session-view-mock')).toBeNull();
    // EmptyState 的标题文案
    expect(screen.getByText('🤖 欢迎使用 AI 开发团队')).toBeTruthy();
  });

  it('receptionSessionId 为空字符串 → 与 null 等价，走引导面板', () => {
    render(<ConversationArea receptionSessionId="" />);
    expect(screen.queryByTestId('team-session-view-mock')).toBeNull();
    expect(screen.getByText('🤖 欢迎使用 AI 开发团队')).toBeTruthy();
  });

  it('团队动态里的 suggestedActions 渲染为只读标签而不是可点击按钮', () => {
    render(<ConversationArea receptionSessionId="b-session-003" />);

    expect(screen.getByTestId('team-session-view-after-messages')).toBeTruthy();
    expect(screen.getByText('团队动态')).toBeTruthy();
    expect(screen.getByText('GitHub')).toBeTruthy();
    expect(screen.getByText('Google')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'GitHub' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Google' })).toBeNull();
  });

  it('刷新恢复时即使通知流没有 needs_clarification 事件，也会从 pending clarifications 合成团队动态卡片', async () => {
    vi.doMock('../../../../../stores/team/team-events.js', async () => {
      const actual = await vi.importActual('../../../../../stores/team/team-events.js');
      return {
        ...actual,
        useTeamNotificationStore: (selector: (state: { events: unknown[] }) => unknown) =>
          selector({
            events: [],
          }),
        useClarificationStore: (selector: (state: { items: unknown[] }) => unknown) =>
          selector({
            items: [
              {
                id: 'clarify-runtime-1',
                sessionId: 'pm1-session-1',
                fromSessionId: 'pm1-session-1',
                question: '仓库地址是什么？',
                context: '等待你补充 Git 仓库',
                createdAt: Date.parse('2026-06-06T10:05:00.000Z'),
                status: 'pending',
              },
            ],
          }),
      };
    });

    const { ConversationArea: ReimportedConversationArea } = await import('./ConversationArea.js');
    render(<ReimportedConversationArea receptionSessionId="b-session-004" />);

    expect(screen.getByText('团队动态')).toBeTruthy();
    expect(screen.getByText('回答澄清问题')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '回答澄清问题' })).toBeNull();
  });
});
