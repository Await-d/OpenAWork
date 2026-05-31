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
import { substateLabelAny } from '../../data/substates.js';
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
  /** 同类事件被合并的条数（≥2 时在标题后显示「×N」）。 */
  count: number;
}

/** team-event 类型 → 中文标签（推送通知条用，避免直接暴露 `xxx.changed` 原始串）。 */
const EVENT_TYPE_LABEL: Record<string, string> = {
  'handoff.created': '已创建交接',
  'handoff.claimed': '已认领',
  'handoff.started': '开始执行',
  'handoff.completed': '已完成',
  'handoff.failed': '执行失败',
  'handoff.cancelled': '已取消',
  'handoff.reclaimed': '重新认领',
  'session.heartbeat': '心跳',
  'session.substate.changed': '阶段更新',
  'session.inbound.submitted': '收到新输入',
  'session.init.changed': '初始化进度',
  'scheduler.task-paused': '任务已暂停',
  'scheduler.task-resumed': '任务已恢复',
  'scheduler.all-paused': '全部暂停',
  'scheduler.all-resumed': '全部恢复',
  'artifact.needs-clarification': '需要澄清',
  'artifact.constitution-conflict': '宪法冲突',
};

/** 角色层 → 中文短标签（与 TeamRunStateBanner.LAYER_LABEL 对齐）。 */
const PUSH_LAYER_LABEL: Record<string, string> = {
  user: '用户',
  reception: '接待',
  pm1: '规划',
  pm2: '管控',
  executor: '执行',
  tester: '测试',
  reviewer: '评审',
};

function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABEL[type] ?? type;
}

function layerLabel(layer: string | undefined): string | null {
  if (!layer) return null;
  return PUSH_LAYER_LABEL[layer] ?? layer;
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

const PUSH_STRIP_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  // 与接待卡片（RECEPTION_CARD_STYLE maxWidth 560，居中）对齐：限制宽度 + 居中，
  // 避免推送条全宽铺满而接待卡片居中导致的左右错位。
  width: '100%',
  maxWidth: 560,
  margin: '8px auto 4px',
  padding: '10px 16px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 70%, var(--bg-base))',
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
  const pushMessages = useMemo<PushMessage[]>(() => coalesceEventsToPush(events), [events]);
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
    <div style={STATE_PANEL_STYLE}>
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
          background: 'color-mix(in srgb, var(--success) 5%, var(--bg-overlay))',
          color: 'var(--fg-default)',
          fontSize: 11,
        }}
      >
        <span aria-hidden="true">{meta.icon}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {message.body}
          {message.count > 1 ? (
            <span style={{ marginLeft: 6, color: 'var(--fg-muted)', fontWeight: 700 }}>
              ×{message.count}
            </span>
          ) : null}
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
        {message.count > 1 ? (
          <span
            style={{
              padding: '0 6px',
              borderRadius: 999,
              background: `color-mix(in srgb, ${meta.color} 18%, transparent)`,
              color: 'var(--fg-default)',
              fontSize: 10,
              fontWeight: 800,
              fontVariantNumeric: 'tabular-nums',
            }}
            title={`同类事件 ${message.count} 次`}
          >
            ×{message.count}
          </span>
        ) : null}
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

/**
 * 把原始 team-event 列表折叠成「人话」推送条目：
 *   1. 把语义重复的相邻事件合并（同 type + layer + body），用 ×N 计数，避免出现
 *      多条几乎一样的 `session.substate.changed` 堆叠在一起的视觉噪声。
 *   2. 事件类型映射为中文标签；substate.changed 进一步展开为具体阶段（如「草拟规格」）。
 *   3. 最终只保留最近 3 组。
 *
 * 注意：先合并再截断，保证「最近 3 组不同事件」而不是「最近 3 条原始事件」，
 * 信息密度更高。
 */
function coalesceEventsToPush(events: HandoffEvent[]): PushMessage[] {
  const groups: PushMessage[] = [];
  for (let i = 0; i < events.length; i++) {
    const message = mapEventToPushMessage(events[i]!, i);
    const last = groups[groups.length - 1];
    // 合并键：类型 + 层级 + body 完全一致视为同一类，仅累加计数并刷新时间戳。
    if (last && last.title === message.title && last.body === message.body) {
      last.count += 1;
      last.timestamp = message.timestamp;
      continue;
    }
    groups.push(message);
  }
  return groups.slice(-3);
}

function mapEventToPushMessage(event: HandoffEvent, index: number): PushMessage {
  const kind: PushMessageKind = event.type.includes('failed')
    ? 'blocking'
    : event.type.includes('completed')
      ? 'silent'
      : 'informational';

  const layer = layerLabel(event.layer);
  // substate.changed 携带具体阶段，展开成「接待层 · 草拟规格」这种可读文案；
  // 其它事件用「层级 · 事件中文名」。
  const substate =
    event.type === 'session.substate.changed'
      ? substateLabelAny(
          typeof event.payload?.['substate'] === 'string'
            ? (event.payload['substate'] as string)
            : null,
        )
      : null;

  const headline = substate ?? eventTypeLabel(event.type);
  const body = [layer, headline].filter(Boolean).join(' · ');

  return {
    body,
    // 合并后同组只保留首条 id；为避免 key 冲突带上 index。
    id: `event-${event.type}-${event.timestamp}-${index}`,
    kind,
    count: 1,
    timestamp: new Date(event.timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    title: kind === 'blocking' ? '需要你确认' : kind === 'silent' ? '已完成' : '进度更新',
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
