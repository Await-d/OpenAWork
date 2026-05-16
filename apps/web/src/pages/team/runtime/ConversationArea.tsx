/**
 * 260516-team-page-v2 · T-03（视觉优化版）
 *
 * 永驻对话区（从 ConversationTab 提升为主区域）。
 *
 * Phase V2 MVP：先做最小可工作版本——展示对话流 + 输入框 + 推送消息徽章。
 * 完整的 ConversationTab 业务逻辑（消息列表 / 编辑器 / 流式渲染）在后续
 * 迭代中迁移过来。
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTeamNotificationStore, type HandoffEvent } from '../../../stores/team-events.js';
import { useTeamRuntimeReferenceViewData } from './team-runtime-reference-data.js';
import { CONV_TYPE_META } from './team-runtime-shared.js';
import type { AgentTeamsConversationCard } from './team-runtime-types.js';
import { SuggestionBar } from './SuggestionBar.js';

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
  background: 'var(--bg)',
};

const MESSAGES_AREA_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: 'var(--team-space-5) var(--team-space-6)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--team-space-3)',
};

const INPUT_AREA_STYLE: CSSProperties = {
  display: 'flex',
  gap: 'var(--team-space-2)',
  padding: 'var(--team-space-4)',
  borderTop: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 90%, var(--bg))',
};

const TEXTAREA_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 'var(--team-control-height-md)',
  maxHeight: 'var(--team-input-max-height)',
  padding: 'var(--team-space-2) var(--team-space-3)',
  borderRadius: 'var(--team-radius-md)',
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'color-mix(in srgb, var(--bg-2) 80%, var(--bg))',
  color: 'var(--text)',
  resize: 'vertical',
  fontFamily: 'inherit',
  fontSize: 'var(--team-font-sm)',
  lineHeight: 'var(--team-line-height-comfortable)',
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
  border: '1px dashed color-mix(in srgb, var(--border) 72%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 70%, var(--bg))',
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

const MOCK_PUSH_MESSAGES: PushMessage[] = [
  {
    actions: ['GitHub', 'Google', '两个都要'],
    body: 'PM1 在规划 OAuth 时需要澄清：OAuth 提供商用 GitHub 还是 Google？',
    id: 'mock-blocking',
    kind: 'blocking',
    timestamp: '14:35',
    title: '需要你确认',
  },
  {
    actions: ['查看 plan', '查看任务列表'],
    body: 'OAuth 任务：plan 已完成，开始派发给开发团队。',
    id: 'mock-informational',
    kind: 'informational',
    timestamp: '14:37',
    title: '进度更新',
  },
  {
    body: '测试员已接收最新任务队列，等待开发分支推送。',
    id: 'mock-silent',
    kind: 'silent',
    timestamp: '14:38',
    title: '静默同步',
  },
];

export interface ConversationAreaProps {
  fallbackContent?: ReactNode;
  onRetryConnection?: () => void;
  onSelectSuggestion?: (text: string) => void | Promise<void>;
  onSubmitMessage?: (text: string) => void | Promise<void>;
  topBar?: ReactNode;
  messagesOverride?: ReactNode;
  /**
   * 隐藏 ConversationArea 自带的 textarea + 发送按钮。
   * Phase 2a：team 端通过 messagesOverride 注入 SessionConversationView 时
   * （自带 UnifiedComposer），需要隐藏 ConversationArea 的简易 textarea
   * 避免双输入框冲突。
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
  hideInput,
}: ConversationAreaProps) {
  const { conversationCards, error, loading } = useTeamRuntimeReferenceViewData();
  const events = useTeamNotificationStore((s) => s.events);
  const [draft, setDraft] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);
  const conversationHistory = conversationCards.filter((card) => card.id !== 'empty-conversation');
  const pushMessages = useMemo(
    () => [...events.slice(-3).map(mapEventToPushMessage), ...MOCK_PUSH_MESSAGES],
    [events],
  );
  const suggestionTargetCardId = conversationHistory.find(isBReplyCard)?.id ?? null;
  const empty = conversationHistory.length === 0;
  const inputDisabled = loading || Boolean(error) || !onSubmitMessage;
  const handleSuggestion = onSelectSuggestion ?? onSubmitMessage;

  // 滚动到底部
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [conversationHistory.length, error, events.length, loading, pushMessages.length]);

  const handleSubmit = async () => {
    if (!draft.trim() || inputDisabled || !onSubmitMessage) return;
    await onSubmitMessage(draft.trim());
    setDraft('');
  };

  return (
    <section style={CONTAINER_STYLE} aria-label="对话区">
      {topBar}
      {messagesOverride !== undefined ? (
        <div style={MESSAGES_AREA_STYLE}>{messagesOverride}</div>
      ) : (
        <div ref={messagesRef} style={MESSAGES_AREA_STYLE}>
          {loading ? <LoadingState /> : null}
          {!loading && error ? (
            <ErrorState error={error} onRetryConnection={onRetryConnection} />
          ) : null}
          {!loading && !error && empty ? (
            <EmptyState onSelectSuggestion={handleSuggestion} />
          ) : null}
          {!loading && !error && !empty
            ? conversationHistory.map((card) => (
                <ConversationCard
                  key={card.id}
                  card={card}
                  showSuggestionBar={card.id === suggestionTargetCardId}
                  onSelectSuggestion={handleSuggestion}
                />
              ))
            : null}

          {!loading && !error
            ? pushMessages.map((message) => <PushMessageCard key={message.id} message={message} />)
            : null}

          {!loading && !error && !empty ? fallbackContent : null}
        </div>
      )}

      {hideInput ? null : (
        <div style={INPUT_AREA_STYLE}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={inputDisabled}
            placeholder={error ? '离线中，无法发送' : '向团队提交意图，回车发送…'}
            style={TEXTAREA_STYLE}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
          />
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!draft.trim() || inputDisabled}
            style={{
              padding: '0 var(--team-space-5)',
              borderRadius: 'var(--team-radius-md)',
              border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
              background:
                draft.trim() && !inputDisabled
                  ? 'color-mix(in srgb, var(--accent) 18%, var(--surface))'
                  : 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
              color: 'var(--text)',
              cursor: draft.trim() && !inputDisabled ? 'pointer' : 'not-allowed',
              fontWeight: 700,
              fontSize: 'var(--team-font-sm)',
              opacity: draft.trim() && !inputDisabled ? 1 : 0.6,
              transition: 'all 150ms ease',
              flexShrink: 0,
            }}
          >
            发送
          </button>
        </div>
      )}
    </section>
  );
}

function LoadingState() {
  return (
    <div style={STATE_PANEL_STYLE} role="status" aria-live="polite">
      <span style={SPINNER_STYLE} aria-hidden="true" />
      <span style={{ fontSize: 'var(--team-font-sm)', color: 'var(--text-2)', fontWeight: 700 }}>
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
        <strong style={{ fontSize: 'var(--team-font-lg)', color: 'var(--text)' }}>
          🤖 欢迎使用 AI 开发团队
        </strong>
        <span style={{ color: 'var(--text-2)', lineHeight: 'var(--team-line-height-relaxed)' }}>
          你的团队已就绪：💬助手 · 📋规划师 · 🎯主管 · ⚡开发者 · 🧪测试员 · 🔍审查员
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
              background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
              color: 'var(--text)',
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
        background: 'color-mix(in srgb, var(--danger) 7%, var(--surface))',
      }}
      role="alert"
    >
      <div style={{ display: 'grid', gap: 'var(--team-space-2)' }}>
        <strong style={{ fontSize: 'var(--team-font-md)', color: 'var(--text)' }}>
          ⚠️ 网络连接已断开
        </strong>
        <span style={{ color: 'var(--text-2)' }}>当前离线 — 可查看历史记录，无法执行新任务</span>
        <span style={{ color: 'var(--text-3)', fontSize: 'var(--team-font-xxs)' }}>{error}</span>
      </div>
      <button
        type="button"
        onClick={onRetryConnection}
        style={{
          minHeight: 'var(--team-control-height-sm)',
          padding: '0 var(--team-space-4)',
          borderRadius: 'var(--team-radius-pill)',
          border: '1px solid color-mix(in srgb, var(--danger) 44%, transparent)',
          background: 'color-mix(in srgb, var(--danger) 12%, var(--surface))',
          color: 'var(--text)',
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

function ConversationCard({
  card,
  onSelectSuggestion,
  showSuggestionBar,
}: {
  card: AgentTeamsConversationCard;
  onSelectSuggestion?: (text: string) => void | Promise<void>;
  showSuggestionBar: boolean;
}) {
  const meta = CONV_TYPE_META[card.type];
  return (
    <article
      style={{
        display: 'grid',
        gap: 'var(--team-space-2)',
        padding: 'var(--team-space-4)',
        borderRadius: 'var(--team-radius-lg)',
        border: `1px solid color-mix(in srgb, ${meta.color} 22%, var(--border))`,
        background: `color-mix(in srgb, ${meta.color} 5%, var(--surface))`,
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--team-space-2)' }}>
        <span
          style={{
            width: 'var(--team-control-height-sm)',
            height: 'var(--team-control-height-sm)',
            borderRadius: 'var(--team-radius-md)',
            display: 'grid',
            placeItems: 'center',
            background: `color-mix(in srgb, ${card.roleAccent} 18%, var(--surface))`,
            color: card.roleAccent,
            fontSize: 'var(--team-font-xs)',
            fontWeight: 800,
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          {card.role.slice(0, 1)}
        </span>
        <div style={{ display: 'grid', gap: 'var(--team-space-1)', minWidth: 0, flex: 1 }}>
          <strong style={{ fontSize: 'var(--team-font-sm)', color: 'var(--text)' }}>
            {card.title}
          </strong>
          <span style={{ fontSize: 'var(--team-font-xxs)', color: 'var(--text-3)' }}>
            {card.role} · {card.meta} · {card.timestamp}
          </span>
        </div>
        <span
          style={{
            borderRadius: 'var(--team-radius-pill)',
            padding: 'var(--team-space-1) var(--team-space-2)',
            background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
            color: meta.color,
            fontSize: 'var(--team-font-xxs)',
            fontWeight: 800,
          }}
        >
          {meta.label}
        </span>
      </div>
      <p
        style={{ margin: 0, color: 'var(--text-2)', lineHeight: 'var(--team-line-height-relaxed)' }}
      >
        {card.body}
      </p>
      {showSuggestionBar && onSelectSuggestion ? (
        <SuggestionBar onSelectSuggestion={onSelectSuggestion} />
      ) : null}
    </article>
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
          gap: 'var(--team-space-2)',
          padding: 'var(--team-space-2) var(--team-space-3)',
          borderRadius: 'var(--team-radius-md)',
          border: '1px solid color-mix(in srgb, var(--success) 24%, transparent)',
          borderLeft: 'var(--team-push-strip-width) solid var(--success)',
          background: 'color-mix(in srgb, var(--success) 5%, var(--surface))',
          color: 'var(--text-2)',
        }}
      >
        <span aria-hidden="true">{meta.icon}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {message.body}
        </span>
        <time style={{ fontSize: 'var(--team-font-xxs)', color: 'var(--text-3)' }}>
          {message.timestamp}
        </time>
      </article>
    );
  }

  return (
    <article
      style={{
        display: 'grid',
        gap: 'var(--team-space-2)',
        padding: 'var(--team-space-4)',
        borderRadius: 'var(--team-radius-lg)',
        border: `1px solid color-mix(in srgb, ${meta.color} 28%, transparent)`,
        borderLeft: `var(--team-push-strip-width) solid ${meta.color}`,
        background: `color-mix(in srgb, ${meta.color} 7%, var(--surface))`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--team-space-2)' }}>
        <strong style={{ color: 'var(--text)', fontSize: 'var(--team-font-sm)' }}>
          {meta.icon} {message.title}
        </strong>
        <time
          style={{ marginLeft: 'auto', fontSize: 'var(--team-font-xxs)', color: 'var(--text-3)' }}
        >
          {message.timestamp}
        </time>
      </div>
      <span style={{ color: 'var(--text-2)', lineHeight: 'var(--team-line-height-comfortable)' }}>
        {message.body}
      </span>
      {message.actions ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--team-space-2)' }}>
          {message.actions.map((action) => (
            <button
              key={action}
              type="button"
              style={{
                minHeight: 'var(--team-control-height-sm)',
                padding: '0 var(--team-space-3)',
                borderRadius: 'var(--team-radius-pill)',
                border: `1px solid color-mix(in srgb, ${meta.color} 34%, transparent)`,
                background: `color-mix(in srgb, ${meta.color} 9%, var(--surface))`,
                color: 'var(--text)',
                fontSize: 'var(--team-font-xs)',
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

function isBReplyCard(card: AgentTeamsConversationCard): boolean {
  return card.type !== 'question';
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
