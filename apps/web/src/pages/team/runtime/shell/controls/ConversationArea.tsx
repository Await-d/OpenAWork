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
import { SuggestionBar } from './SuggestionBar.js';
import { TeamConversationView } from '../../../conversation/TeamConversationView.js';
import { TeamDynamicStrip } from './TeamDynamicStrip.js';
import { useTeamDynamicEntries } from './use-team-dynamic-entries.js';

type TeamConversationStyle = CSSProperties & Record<`--team-${string}`, string>;

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

const STATE_PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--team-space-4)',
  width: '100%',
  maxWidth: 520,
  margin: '0 auto',
  // 内容自然高度即可，不再用 flex:1 撑满整个对话区导致内容漂浮在大片空白里。
  padding: 'var(--team-space-6) var(--team-space-5)',
  textAlign: 'center',
  borderRadius: 'var(--team-radius-xl)',
  border: '1px dashed color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 70%, var(--bg-base))',
};

const SPINNER_STYLE: CSSProperties = {
  width: 'var(--team-spinner-size)',
  height: 'var(--team-spinner-size)',
  borderRadius: 'var(--team-radius-pill)',
  border: 'var(--team-spinner-border) solid color-mix(in srgb, var(--accent) 20%, transparent)',
  borderTopColor: 'var(--accent)',
  animation: 'spin var(--team-spin-duration) linear infinite',
};

const EMPTY_QUICK_ACTIONS = [
  '帮我实现一个登录功能',
  '修复 issue #42',
  '给项目加上单元测试',
] as const;

export interface ConversationAreaProps {
  fallbackContent?: ReactNode;
  onRetryConnection?: () => void;
  onSelectSuggestion?: (text: string) => void | Promise<void>;
  onSubmitMessage?: (text: string) => void | Promise<void>;
  topBar?: ReactNode;
  messagesOverride?: ReactNode;
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
  fallbackContent,
  onRetryConnection,
  onSelectSuggestion,
  onSubmitMessage,
  topBar,
  messagesOverride,
  receptionSessionId,
  receptionComposerEnabled = false,
}: ConversationAreaProps) {
  const { error, loading } = useTeamRuntimeReferenceViewData();
  const dynamicEntries = useTeamDynamicEntries(receptionSessionId ?? null);
  const handleSuggestion = onSelectSuggestion ?? onSubmitMessage;

  // ─── Path 1: 外部注入消息内容（如 conversation tab 选中具体子 session）───
  if (messagesOverride !== undefined) {
    return (
      <section style={CONTAINER_STYLE} aria-label="对话区">
        {topBar}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {messagesOverride}
        </div>
      </section>
    );
  }

  // ─── Path 2: reception session 存在 → 复用 chat 渲染 ───
  if (receptionSessionId) {
    return (
      <section style={CONTAINER_STYLE} aria-label="对话区">
        {topBar}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
        </div>
      </section>
    );
  }

  // ─── Path 3: 没有 session → 状态/引导面板 ───
  return (
    <section style={CONTAINER_STYLE} aria-label="对话区">
      {topBar}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: 'clamp(16px, 4vh, 48px) 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
        }}
      >
        {loading ? <LoadingState /> : null}
        {!loading && error ? (
          <ErrorState error={error} onRetryConnection={onRetryConnection} />
        ) : null}
        {!loading && !error ? <EmptyState onSelectSuggestion={handleSuggestion} /> : null}
        {fallbackContent}
      </div>
    </section>
  );
}

function LoadingState() {
  return (
    <div style={STATE_PANEL_STYLE} role="status" aria-live="polite">
      <span style={SPINNER_STYLE} aria-hidden="true" />
      <span
        style={{ fontSize: 'var(--team-font-sm)', color: 'var(--fg-default)', fontWeight: 700 }}
      >
        正在连接团队...
      </span>
    </div>
  );
}

function EmptyState({
  onSelectSuggestion,
}: {
  onSelectSuggestion?: (text: string) => void | Promise<void>;
}) {
  return (
    <div className="team-conversation-empty-state" style={STATE_PANEL_STYLE}>
      <div style={{ display: 'grid', gap: 'var(--team-space-2)' }}>
        <strong style={{ fontSize: 'var(--team-font-lg)', color: 'var(--fg-strong)' }}>
          🤖 欢迎使用 AI 开发团队
        </strong>
        <span style={{ color: 'var(--fg-default)', lineHeight: 'var(--team-line-height-relaxed)' }}>
          你的团队已就绪：💬助手 · 📋规划师 · 🎯主管 · ⚡开发者 · 🧪测试员 · 🔍审查员
        </span>
        <span style={{ fontSize: 'var(--team-font-xxs)', color: 'var(--fg-muted)' }}>
          创建首个会话后，下方将出现统一对话区。
        </span>
      </div>
      <div
        className="team-conversation-quick-actions"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: 'var(--team-space-2)',
        }}
        aria-label="快捷建议"
      >
        {EMPTY_QUICK_ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            className="team-conversation-quick-action"
            onClick={() => void onSelectSuggestion?.(action)}
            style={{
              minHeight: 'var(--team-control-height-sm)',
              padding: '0 var(--team-space-3)',
              borderRadius: 'var(--team-radius-pill)',
              border: '1px solid color-mix(in srgb, var(--accent) 34%, transparent)',
              background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))',
              color: 'var(--fg-strong)',
              fontSize: 'var(--team-font-xs)',
              fontWeight: 700,
              cursor: onSelectSuggestion ? 'pointer' : 'not-allowed',
              opacity: onSelectSuggestion ? 1 : 0.55,
            }}
          >
            {action}
          </button>
        ))}
      </div>
      {onSelectSuggestion ? <SuggestionBar onSelectSuggestion={onSelectSuggestion} /> : null}
    </div>
  );
}

function ErrorState({
  error,
  onRetryConnection,
}: {
  error: string;
  onRetryConnection?: () => void;
}) {
  return (
    <div
      style={{
        ...STATE_PANEL_STYLE,
        borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)',
        background: 'color-mix(in srgb, var(--danger) 7%, var(--bg-overlay))',
      }}
      role="alert"
    >
      <div style={{ display: 'grid', gap: 'var(--team-space-2)' }}>
        <strong style={{ fontSize: 'var(--team-font-md)', color: 'var(--fg-strong)' }}>
          ⚠️ 网络连接已断开
        </strong>
        <span style={{ color: 'var(--fg-default)' }}>
          当前离线 — 可查看历史记录，无法执行新任务
        </span>
        <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--team-font-xxs)' }}>{error}</span>
      </div>
      <button
        type="button"
        onClick={onRetryConnection}
        style={{
          minHeight: 'var(--team-control-height-sm)',
          padding: '0 var(--team-space-4)',
          borderRadius: 'var(--team-radius-pill)',
          border: '1px solid color-mix(in srgb, var(--danger) 44%, transparent)',
          background: 'color-mix(in srgb, var(--danger) 12%, var(--bg-overlay))',
          color: 'var(--fg-strong)',
          fontSize: 'var(--team-font-xs)',
          fontWeight: 800,
          cursor: onRetryConnection ? 'pointer' : 'not-allowed',
          opacity: onRetryConnection ? 1 : 0.55,
        }}
      >
        重试连接
      </button>
    </div>
  );
}
