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

import { useMemo, type CSSProperties, type ReactNode } from 'react';
import {
  useTeamNotificationStore,
  type HandoffEvent,
} from '../../../../../stores/team/team-events.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { SuggestionBar } from './SuggestionBar.js';
import { TeamConversationView } from '../../../conversation/TeamConversationView.js';

type TeamConversationStyle = CSSProperties & Record<`--team-${string}`, string>;

type PushMessageKind = 'blocking' | 'informational' | 'silent';

interface PushMessage {
  actions?: string[];
  body: string;
  id: string;
  kind: PushMessageKind;
  timestamp: string;
  title: string;
}

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
  display: 'grid',
  placeItems: 'center',
  gap: 'var(--team-space-4)',
  flex: 1,
  minHeight: 'var(--team-state-min-height)',
  padding: 'var(--team-space-8)',
  textAlign: 'center',
  borderRadius: 'var(--team-radius-xl)',
  border: '1px dashed color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 70%, var(--bg-base)',
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

const PUSH_STRIP_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px 16px',
  borderTop: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 70%, var(--bg-base)',
  flexShrink: 0,
  maxHeight: 240,
  overflowY: 'auto',
};

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
  const events = useTeamNotificationStore((s) => s.events);
  const pushMessages = useMemo<PushMessage[]>(
    () => events.slice(-3).map(mapEventToPushMessage),
    [events],
  );
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
            sessionId={receptionSessionId}
            composerEnabled={receptionComposerEnabled}
            afterMessages={
              <>
                {fallbackContent}
                <PushMessageStrip messages={pushMessages} />
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
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
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
    <div style={STATE_PANEL_STYLE}>
      <div style={{ display: 'grid', gap: 'var(--team-space-3)' }}>
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
            onClick={() => void onSelectSuggestion?.(action)}
            style={{
              minHeight: 'var(--team-control-height-sm)',
              padding: '0 var(--team-space-3)',
              borderRadius: 'var(--team-radius-pill)',
              border: '1px solid color-mix(in srgb, var(--accent) 34%, transparent)',
              background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay)',
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
        background: 'color-mix(in srgb, var(--danger) 7%, var(--bg-overlay)',
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
          background: 'color-mix(in srgb, var(--danger) 12%, var(--bg-overlay)',
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

/**
 * 团队推送消息条带 · 通过 SessionConversationView.afterMessages slot 注入。
 *
 * 仅展示最近 3 条 team-events，不参与 LLM 主消息流。
 * 阻塞型卡片显示 actions（如「GitHub / Google / 两个都要」），
 * 静默型卡片单行显示。
 */
function PushMessageStrip({ messages }: { messages: PushMessage[] }) {
  if (messages.length === 0) return null;
  return (
    <div style={PUSH_STRIP_STYLE} aria-label="团队推送通知">
      {messages.map((message) => (
        <PushMessageCard key={message.id} message={message} />
      ))}
    </div>
  );
}

function PushMessageCard({ message }: { message: PushMessage }) {
  const meta = getPushMessageMeta(message.kind);

  if (message.kind === 'silent') {
    return (
      <article
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr) auto',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid color-mix(in srgb, var(--success) 24%, transparent)',
          borderLeft: '3px solid var(--success)',
          background: 'color-mix(in srgb, var(--success) 5%, var(--bg-overlay)',
          color: 'var(--fg-default)',
          fontSize: 11,
        }}
      >
        <span aria-hidden="true">{meta.icon}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {message.body}
        </span>
        <time style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{message.timestamp}</time>
      </article>
    );
  }

  return (
    <article
      style={{
        display: 'grid',
        gap: 6,
        padding: '8px 12px',
        borderRadius: 10,
        border: `1px solid color-mix(in srgb, ${meta.color} 28%, transparent)`,
        borderLeft: `3px solid ${meta.color}`,
        background: `color-mix(in srgb, ${meta.color} 7%, var(--bg-overlay))`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <strong style={{ color: 'var(--fg-strong)', fontSize: 12 }}>
          {meta.icon} {message.title}
        </strong>
        <time style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--fg-muted)' }}>
          {message.timestamp}
        </time>
      </div>
      <span style={{ color: 'var(--fg-default)', lineHeight: 1.55, fontSize: 12 }}>
        {message.body}
      </span>
      {message.actions ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {message.actions.map((action) => (
            <button
              key={action}
              type="button"
              style={{
                minHeight: 24,
                padding: '0 10px',
                borderRadius: 999,
                border: `1px solid color-mix(in srgb, ${meta.color} 34%, transparent)`,
                background: `color-mix(in srgb, ${meta.color} 9%, var(--bg-overlay))`,
                color: 'var(--fg-strong)',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {action}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function mapEventToPushMessage(event: HandoffEvent, index: number): PushMessage {
  const kind: PushMessageKind = event.type.includes('failed')
    ? 'blocking'
    : event.type.includes('completed')
      ? 'silent'
      : 'informational';
  const taskLabel = event.taskId ? `任务 ${event.taskId.slice(0, 8)}` : '团队任务';
  const layerLabel = event.layer ? `层级 ${event.layer}` : '团队运行';
  return {
    body: `${layerLabel} · ${taskLabel} · ${event.type}`,
    id: `event-${event.type}-${event.timestamp}-${index}`,
    kind,
    timestamp: new Date(event.timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    title: kind === 'blocking' ? '需要你确认' : kind === 'silent' ? '静默同步' : '进度更新',
  };
}

function getPushMessageMeta(kind: PushMessageKind): { color: string; icon: string } {
  if (kind === 'blocking') {
    return { color: 'var(--danger)', icon: '🔴' };
  }
  if (kind === 'informational') {
    return { color: 'var(--warning)', icon: '🟡' };
  }
  return { color: 'var(--success)', icon: '🟢' };
}
