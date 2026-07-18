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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@openAwork/shared-ui', () => ({
  BrandLogo: ({ size = 22 }: { readonly size?: number }) => (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 32 32">
      <path d="M 16,3 C 26,3 29,12 16,16" />
      <path d="M 16,3 C 26,3 29,12 16,16" transform="rotate(120 16 16)" />
      <path d="M 16,3 C 26,3 29,12 16,16" transform="rotate(240 16 16)" />
      <circle cx="16" cy="16" r="2.8" />
    </svg>
  ),
}));

vi.mock('../../../../../stores/team/team-events.js', async () => {
  const actual = await vi.importActual('../../../../../stores/team/team-events.js');
  return {
    ...actual,
    useTeamNotificationStore: (selector: (state: { events: unknown[] }) => unknown) =>
      selector({
        events: [
          {
            type: 'session.inbound.submitted',
            sessionId: 'b-session-003',
            timestamp: Date.parse('2026-06-06T10:00:00.000Z'),
            payload: {
              blocking: true,
              reason: 'needs_clarification',
              fromSessionId: 'pm1-current',
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
          {
            type: 'session.inbound.submitted',
            sessionId: 'other-workspace-root',
            timestamp: Date.parse('2026-06-06T10:01:00.000Z'),
            payload: {
              blocking: false,
              reason: 'needs_clarification',
              fromSessionId: 'pm1-other',
              context: '这个是其它工作区的团队动态，不应混进来',
              questions: [{ id: 'clarify-other', question: '其它会话问题' }],
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

vi.mock('../../data/team-runtime-reference-data.js', () => ({
  useTeamRuntimeReferenceViewData: () => ({
    error: null,
    loading: false,
    sessions: [
      { id: 'b-session-001', parentSessionId: null },
      { id: 'b-session-002', parentSessionId: null },
      { id: 'b-session-003', parentSessionId: null },
      { id: 'b-session-004', parentSessionId: null },
      { id: 'pm1-current', parentSessionId: 'b-session-003' },
      { id: 'pm1-session-1', parentSessionId: 'b-session-004' },
      { id: 'other-workspace-root', parentSessionId: null },
      { id: 'pm1-other', parentSessionId: 'other-workspace-root' },
    ],
  }),
}));

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

const getReadyEmptyTitle = () =>
  screen.getByText((_, element) => element?.textContent === '团队工作空间已就绪');

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
    expect(getReadyEmptyTitle()).toBeTruthy();
  });

  it('receptionSessionId 为空时展示团队欢迎页，并可触发快捷建议入口', () => {
    const onSelectSuggestion = vi.fn();

    render(<ConversationArea receptionSessionId={null} onSelectSuggestion={onSelectSuggestion} />);

    expect(getReadyEmptyTitle()).toBeTruthy();

    const suggestionButton = screen.getByRole('button', {
      name: '基于当前仓库制定一个交付计划',
    });
    fireEvent.click(suggestionButton);

    expect(onSelectSuggestion).toHaveBeenCalledOnce();
    expect(onSelectSuggestion).toHaveBeenCalledWith('基于当前仓库制定一个交付计划');
  });

  it('receptionSessionId 为空时展示团队欢迎页，并可触发快捷创建工作区入口', () => {
    const onCreateWorkspace = vi.fn();

    render(
      <ConversationArea
        receptionSessionId={null}
        canCreateWorkspace
        workspaceLabel="当前仓库"
        onCreateWorkspace={onCreateWorkspace}
      />,
    );

    const createWorkspaceButton = screen.getByRole('button', { name: '新建并切换工作区' });
    fireEvent.click(createWorkspaceButton);

    expect(onCreateWorkspace).toHaveBeenCalledOnce();
  });

  it('没有 team 会话但存在工作台侧栏时，使用 workspace-first 布局避免空对话区抢占首屏', () => {
    render(
      <ConversationArea
        receptionSessionId={null}
        sidePanel={<div data-testid="team-workbench-side-panel">工作台内容</div>}
      />,
    );

    const workbench = screen.getByLabelText('团队工作台侧栏').parentElement;
    expect(
      workbench?.classList.contains('team-conversation-area__workbench--workspace-first'),
    ).toBe(true);
    expect(screen.getByTestId('team-workbench-side-panel')).toBeTruthy();
    expect(getReadyEmptyTitle()).toBeTruthy();
  });

  it('存在 team 会话时保留 session-first 双栏布局', () => {
    render(
      <ConversationArea
        receptionSessionId="b-session-001"
        sidePanel={<div data-testid="team-workbench-side-panel">工作台内容</div>}
      />,
    );

    const workbench = screen.getByLabelText('团队工作台侧栏').parentElement;
    expect(
      workbench?.classList.contains('team-conversation-area__workbench--workspace-first'),
    ).toBe(false);
    expect(screen.getByTestId('team-session-view-mock')).toBeTruthy();
    expect(screen.getByTestId('team-workbench-side-panel')).toBeTruthy();
  });

  it('receptionSessionId 为空字符串 → 与 null 等价，走引导面板', () => {
    render(<ConversationArea receptionSessionId="" />);
    expect(screen.queryByTestId('team-session-view-mock')).toBeNull();
    expect(getReadyEmptyTitle()).toBeTruthy();
  });

  it('团队动态里的 suggestedActions 渲染为只读标签而不是可点击按钮', () => {
    render(<ConversationArea receptionSessionId="b-session-003" />);

    expect(screen.getByTestId('team-session-view-after-messages')).toBeTruthy();
    expect(screen.getByText('团队动态')).toBeTruthy();
    expect(screen.getByText('GitHub')).toBeTruthy();
    expect(screen.getByText('Google')).toBeTruthy();
    expect(screen.queryByText('这个是其它工作区的团队动态，不应混进来')).toBeNull();
    expect(screen.queryByRole('button', { name: 'GitHub' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Google' })).toBeNull();
  });

  it('团队动态会按当前 team 会话作用域过滤，不混入其它工作区会话', () => {
    render(<ConversationArea receptionSessionId="b-session-003" />);

    expect(screen.getByText('PM1 需要你先补充仓库与部署约束')).toBeTruthy();
    expect(screen.queryByText('这个是其它工作区的团队动态，不应混进来')).toBeNull();
    expect(screen.queryByText('其它会话问题')).toBeNull();
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
              {
                id: 'clarify-runtime-other',
                sessionId: 'pm1-other',
                fromSessionId: 'pm1-other',
                question: '其它工作区问题',
                context: '其它工作区不应混入当前团队动态',
                createdAt: Date.parse('2026-06-06T10:06:00.000Z'),
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
    expect(screen.queryByText('其它工作区不应混入当前团队动态')).toBeNull();
    expect(screen.queryByText('其它工作区问题')).toBeNull();
    expect(screen.queryByRole('button', { name: '回答澄清问题' })).toBeNull();
  });
});
