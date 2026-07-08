/**
 * 260516-team-page-v2 · ConversationArea（chat-conversation-reuse-plan v1.3 步骤 1+2 改造）
 *
 * 永驻对话区。**当前阶段**：默认把"用户 ↔ b 的陪聊"作为团队主对话流，
 * 通过 `<TeamConversationView/>` 复用 chat 端的消息渲染 + UnifiedComposer。
 *
 * 渲染优先级：
 *   1. `messagesOverride` 不为 undefined → 直接铺；外层负责 layout
 *      （TeamPageV2 的"对话 tab"用此路径切到 `<TeamConversationView/>` ）
 *   2. `receptionSessionId` 存在 → 内置渲染 `<TeamConversationView/>`，
 *      推送消息 / suggestion bar 通过 afterMessages slot 注入
 *   3. 都没有 → 回到「等待会话」空态（loading / error / 引导文案）
 *
 * 关键变更（vs 原 V1 mock 视图）：
 *   - 删除内置 `ConversationCard[]` 渲染：复用 chat 端的 ChatMessageGroupList
 *   - 删除内置 textarea：复用 UnifiedComposer（在 TeamConversationView 内部）
 *   - 推送消息卡片 (`PushMessageCard`) 改为通过 SessionConversationView 的
 *     afterMessages slot 渲染，不再侵入主消息流
 *   - SuggestionBar 仅在没有任何会话时显示（idle empty state）
 *
 * 关联文档：
 *   - `docs/chat-conversation-reuse-plan.md` Phase 2a / 步骤 1+2
 */

import type { CSSProperties, ReactNode } from 'react';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { TeamConversationView } from '../../../conversation/TeamConversationView.js';
import { TeamDynamicStrip } from './TeamDynamicStrip.js';
import { ErrorState, LoadingState } from './ConversationAreaStates.js';
import { TeamWelcomeScreen } from './TeamWelcomeScreen.js';
import { useTeamDynamicEntries } from './use-team-dynamic-entries.js';

type TeamConversationStyle = CSSProperties & Record<`--team-${string}`, string>;
type ConversationAreaPresentation = 'session-first' | 'workspace-first';

const CONTAINER_STYLE: TeamConversationStyle = {
  '--team-space-1': '4px',
  '--team-space-2': '6px',
  '--team-space-3': '10px',
  '--team-space-4': '12px',
  '--team-space-5': '16px',
  '--team-space-6': '20px',
  '--team-space-8': '28px',
  '--team-radius-sm': '6px',
  '--team-radius-md': '8px',
  '--team-radius-lg': '12px',
  '--team-radius-xl': '16px',
  '--team-radius-pill': '999px',
  '--team-font-xxs': '10px',
  '--team-font-xs': '12px',
  '--team-font-sm': '13px',
  '--team-font-md': '16px',
  '--team-font-lg': '20px',
  '--team-control-height-sm': '28px',
  '--team-control-height-md': '40px',
  '--team-spinner-size': '24px',
  '--team-spinner-border': '2px',
  '--team-spin-duration': '800ms',
  '--team-push-strip-width': '4px',
  '--team-input-max-height': '200px',
  '--team-state-min-height': 'min(42vh, 360px)',
  '--team-line-height-relaxed': '1.7',
  '--team-line-height-comfortable': '1.65',
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  // 去掉 background: 'var(--bg-base)' — 让父级 LEFT_AREA_STYLE 的 background 透出，
  // 避免双层 bg 叠加导致颜色偏差。
};

export interface ConversationAreaProps {
  canCreateSession?: boolean;
  canCreateWorkspace?: boolean;
  fallbackContent?: ReactNode;
  onCreateWorkspace?: () => void;
  onNewSession?: () => void;
  onRetryConnection?: () => void;
  onSelectSuggestion?: (text: string) => void | Promise<void>;
  onSubmitMessage?: (text: string) => void | Promise<void>;
  topBar?: ReactNode;
  messagesOverride?: ReactNode;
  sidePanel?: ReactNode;
  workspaceLabel?: string | null;
  /**
   * 团队主对话所归属的 reception/b session id。
   * 当 `messagesOverride` 未传入时：
   *   - 此值非空 → 内嵌 `<TeamConversationView/>` 渲染主对话流
   *   - 为空 → 落回 idle/loading/error 状态面板（不再渲染旧的 ConversationCard mock）
   *
   * 与「对话 tab」选中具体子 session 是两个独立路径，互不影响。
   */
  receptionSessionId?: string | null;
  /**
   * 是否启用内嵌 TeamConversationView 的 composer 输入（L1.3 inbound 反向通道 feature flag）。
   * 默认 false（与 D2 决策对齐：team 默认只读，输入交给 b 路由）。
   */
  receptionComposerEnabled?: boolean;
  /**
   * 隐藏 ConversationArea 自带的 textarea + 发送按钮（已废弃）。
   *
   * 原 V1 路径下 ConversationArea 内置一个简易 textarea；现在统一由内部的
   * `<TeamConversationView/>` 提供 UnifiedComposer，本字段保留只为向下兼容老调用方。
   * 新调用方无需传入此 prop。
   */
  hideInput?: boolean;
}

export function ConversationArea({
  canCreateSession,
  canCreateWorkspace,
  fallbackContent,
  onCreateWorkspace,
  onNewSession,
  onRetryConnection,
  onSelectSuggestion,
  onSubmitMessage,
  topBar,
  messagesOverride,
  sidePanel,
  receptionSessionId,
  receptionComposerEnabled = false,
  workspaceLabel,
}: ConversationAreaProps) {
  const { error, loading } = useTeamRuntimeReferenceViewData();
  const dynamicEntries = useTeamDynamicEntries(receptionSessionId ?? null);
  const handleSuggestion = onSelectSuggestion ?? onSubmitMessage;

  // ─── Path 1: 外部注入消息内容（如 conversation tab 选中具体子 session）───
  if (messagesOverride !== undefined) {
    return (
      <section className="team-conversation-area" style={CONTAINER_STYLE} aria-label="对话区">
        {topBar}
        <ConversationAreaBody sidePanel={sidePanel}>{messagesOverride}</ConversationAreaBody>
      </section>
    );
  }

  // ─── Path 2: reception session 存在 → 复用 chat 渲染 ───
  if (receptionSessionId) {
    return (
      <section className="team-conversation-area" style={CONTAINER_STYLE} aria-label="对话区">
        {topBar}
        <ConversationAreaBody sidePanel={sidePanel}>
          <TeamConversationView
            key={receptionSessionId}
            sessionId={receptionSessionId}
            composerEnabled={receptionComposerEnabled}
            afterMessages={
              <>
                {fallbackContent}
                <TeamDynamicStrip entries={dynamicEntries} />
              </>
            }
          />
        </ConversationAreaBody>
      </section>
    );
  }

  // ─── Path 3: 没有 session → 状态/引导面板 ───
  return (
    <section className="team-conversation-area" style={CONTAINER_STYLE} aria-label="对话区">
      {topBar}
      <ConversationAreaBody sidePanel={sidePanel} presentation="workspace-first">
        <div className="team-welcome-screen-host">
          {loading ? <LoadingState /> : null}
          {!loading && error ? (
            <ErrorState error={error} onRetryConnection={onRetryConnection} />
          ) : null}
          {!loading && !error ? (
            <TeamWelcomeScreen
              canCreateSession={canCreateSession}
              canCreateWorkspace={canCreateWorkspace}
              workspaceLabel={workspaceLabel}
              onCreateWorkspace={onCreateWorkspace}
              onNewSession={onNewSession}
              onSelectSuggestion={handleSuggestion}
            />
          ) : null}
          {fallbackContent}
        </div>
      </ConversationAreaBody>
    </section>
  );
}

function ConversationAreaBody({
  children,
  presentation = 'session-first',
  sidePanel,
}: {
  readonly children: ReactNode;
  readonly presentation?: ConversationAreaPresentation;
  readonly sidePanel?: ReactNode;
}) {
  if (!sidePanel) {
    return (
      <div
        className="team-conversation-area__body"
        style={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}
      >
        {children}
      </div>
    );
  }

  const className =
    presentation === 'workspace-first'
      ? 'team-conversation-area__workbench team-conversation-area__workbench--workspace-first'
      : 'team-conversation-area__workbench';

  return (
    <div className={className}>
      <div className="team-conversation-area__session">{children}</div>
      <aside className="team-conversation-area__side-panel" aria-label="团队工作台侧栏">
        {sidePanel}
      </aside>
    </div>
  );
}
