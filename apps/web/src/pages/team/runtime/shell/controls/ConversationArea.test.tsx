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

// 测试期把 TeamConversationView 替换成最小桩，便于断言 sessionId / composerEnabled 透传
vi.mock('../../../conversation/TeamConversationView.js', () => ({
  TeamConversationView: ({
    sessionId,
    composerEnabled,
  }: {
    sessionId: string;
    composerEnabled?: boolean;
  }) => (
    <div
      data-testid="team-session-view-mock"
      data-session-id={sessionId}
      data-composer-enabled={composerEnabled ? 'true' : 'false'}
    >
      mock-team-session
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
});
