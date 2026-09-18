/**
 * 260517-team-phase-c · [NEEDS CLARIFICATION] 待澄清面板
 *
 * c 层（PM1）解析 spec 时遇到的不明确点会通过 team-events
 * `artifact.needs-clarification` 事件推送到前端，前端显示一个待办列表
 * 让用户回答；回答内容通过 team-inbound 的 `clarification_answer` 类型
 * 写回 PM1 的 inbound 通道，让 PM1 在下一轮规划时消费。
 *
 * 用户视角：
 *   - 进入「任务 / 任务流」或「任务 / 评审」tab 时，顶部如果有待回答的
 *     CLARIFICATION 会优先展示醒目卡片（橙色边框）
 *   - 每条卡片：question + 上下文片段 + 结构化选项按钮（推荐项置首并带徽标）；
 *     无选项的旧题回退输入框；卡片底部始终有「忽略」
 *   - 已回答的会保留在已答区，可折叠
 *
 * 可阻断性：
 *   - 当 pending 数量 > 0 时，调用方可选择把 c 层向导锁住（不让进 plan）
 *     这里只渲染 UI，由父组件决定是否拦截
 */

import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  useClarificationStore,
  type ClarificationItem,
  type ClarificationOption,
} from '../../../../../stores/team/team-events.js';
import {
  countActionablePendingClarifications,
  resolveSupersededClarificationIds,
} from '../../../../../stores/team/clarification-identity.js';
import { useAuthStore } from '../../../../../stores/auth/auth.js';
import { createTeamInboundClient } from '@openAwork/web-client';
import { tryFormatJson } from '../../../../../utils/format-json.js';

const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--warning) 36%, transparent)',
  background: 'color-mix(in srgb, var(--warning) 6%, var(--bg-overlay))',
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const TITLE_STYLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: 'var(--warning)',
  letterSpacing: '0.005em',
};

const HINT_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
};

const ROUND_CHIP_STYLE: CSSProperties = {
  alignSelf: 'flex-start',
  margin: '2px 0 0',
  padding: '2px 8px',
  borderRadius: 999,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  color: 'var(--fg-muted)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.04em',
};

const SUPERSEDED_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px dashed color-mix(in srgb, var(--border-default) 45%, transparent)',
  color: 'var(--fg-muted)',
  fontSize: 11.5,
  lineHeight: 1.5,
};

const SUPERSEDED_BADGE_STYLE: CSSProperties = {
  flexShrink: 0,
  padding: '1px 6px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
  color: 'var(--warning)',
  fontSize: 10,
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

const SUPERSEDED_QUESTION_STYLE: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const CARD_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'var(--card-bg, var(--bg-overlay))',
};

const QUESTION_STYLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  lineHeight: 1.5,
};

const CONTEXT_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  fontFamily: 'var(--mono-font, ui-monospace, "SFMono-Regular", monospace)',
  background: 'color-mix(in srgb, var(--fg-muted) 8%, transparent)',
  padding: '6px 10px',
  borderRadius: 6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const TEXTAREA_STYLE: CSSProperties = {
  width: '100%',
  minHeight: 60,
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  fontSize: 12,
  resize: 'vertical',
  fontFamily: 'inherit',
};

const ACTIONS_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const ERROR_TEXT_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--danger)',
  lineHeight: 1.5,
};

const PRIMARY_BTN_STYLE: CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--bg-base)',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
};

const SECONDARY_BTN_STYLE: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const ANSWERED_LIST_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px 12px',
  borderRadius: 8,
  background: 'color-mix(in srgb, var(--success) 5%, var(--bg-overlay))',
  border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)',
};

const OPTION_STYLES = `
.clarification-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.clarification-option {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-default);
  background: var(--bg-overlay);
  color: var(--fg-strong);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
  text-align: left;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    transform 120ms ease;
}
.clarification-option:hover:not(:disabled) {
  background: var(--bg-surface);
  border-color: var(--border-emphasis);
}
.clarification-option:active:not(:disabled) {
  transform: scale(0.985);
}
.clarification-option:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-subtle);
}
.clarification-option:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.clarification-option--recommended {
  border-color: var(--contrast-border);
  background: color-mix(in srgb, var(--contrast) 7%, var(--bg-overlay));
}
.clarification-option--recommended:hover:not(:disabled) {
  border-color: var(--contrast);
  background: color-mix(in srgb, var(--contrast) 13%, var(--bg-overlay));
}
.clarification-option__label {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  overflow-wrap: anywhere;
}
.clarification-option__badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 9999px;
  border: 1px solid var(--contrast-border);
  background: var(--contrast-muted);
  color: var(--contrast);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.5;
  white-space: nowrap;
}
.clarification-option__desc {
  font-size: 11px;
  font-weight: 400;
  color: var(--fg-muted);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.clarification-free-input-toggle {
  align-self: flex-start;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--fg-muted);
  font-size: 11px;
  font-weight: 600;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
}
.clarification-free-input-toggle:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--border-subtle);
  color: var(--fg-default);
}
.clarification-free-input-toggle:active:not(:disabled) {
  transform: scale(0.98);
}
.clarification-free-input-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-subtle);
}
.clarification-free-input-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
@media (prefers-reduced-motion: reduce) {
  .clarification-option,
  .clarification-free-input-toggle {
    transition: none;
  }
  .clarification-option:active:not(:disabled),
  .clarification-free-input-toggle:active:not(:disabled) {
    transform: none;
  }
}
`;

function orderOptionsWithRecommendedFirst(
  options: readonly ClarificationOption[],
): ClarificationOption[] {
  const recommendedIndex = options.findIndex((option) => option.recommended === true);
  if (recommendedIndex <= 0) {
    return [...options];
  }
  const recommended = options[recommendedIndex];
  if (!recommended) {
    return [...options];
  }
  return [recommended, ...options.filter((_, index) => index !== recommendedIndex)];
}

interface ClarificationsPanelProps {
  /**
   * 限定显示哪个 session 的 clarifications。null 表示显示全部。
   * 通常传入当前选中的 team session id。
   */
  filterSessionId?: string | null;
  /**
   * 当用户提交澄清回答失败时的可选回调。
   * 默认行为：在 console 输出错误，并保留 store 中的 pending 状态不动。
   */
  onError?: (error: unknown, item: ClarificationItem) => void;
  /**
   * 渲染附加内容（如显示在标题区右侧的角标）。
   */
  headerExtra?: ReactNode;
}

export function ClarificationsPanel({
  filterSessionId = null,
  onError,
  headerExtra,
}: ClarificationsPanelProps) {
  const { gatewayUrl, accessToken } = useAuthStore();
  const items = useClarificationStore((s) => s.items);
  const markAnswered = useClarificationStore((s) => s.markAnswered);
  const dismiss = useClarificationStore((s) => s.dismiss);

  const filtered = useMemo(() => {
    if (!filterSessionId) return items;
    return items.filter((item) => item.sessionId === filterSessionId);
  }, [items, filterSessionId]);

  const pending = filtered.filter((item) => item.status === 'pending');
  const answered = filtered.filter((item) => item.status === 'answered');
  const supersededIds = resolveSupersededClarificationIds(filtered);
  const actionablePendingCount = countActionablePendingClarifications(filtered);

  const pendingGroupMap = new Map<
    string,
    { key: string; label: string | null; items: ClarificationItem[] }
  >();
  for (const item of pending) {
    const round = item.round;
    const key = typeof round === 'number' ? `round-${round}` : 'round-none';
    const existing = pendingGroupMap.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    pendingGroupMap.set(key, {
      key,
      label: typeof round === 'number' ? `第 ${round + 1} 轮澄清` : null,
      items: [item],
    });
  }
  const pendingGroups = [...pendingGroupMap.values()];
  const hasPendingOptions = pending.some(
    (item) => !supersededIds.has(item.id) && (item.options?.length ?? 0) > 0,
  );

  if (filtered.length === 0) return null;

  const handleAnswer = async (item: ClarificationItem, answer: string): Promise<string | null> => {
    if (!gatewayUrl || !accessToken || !item.fromSessionId) {
      const error = new Error('未登录或缺少 PM1 session');
      console.warn('[ClarificationsPanel] missing gateway / token / fromSessionId');
      onError?.(error, item);
      return error.message;
    }
    const client = createTeamInboundClient(gatewayUrl);
    try {
      await client.submit(accessToken, item.fromSessionId, {
        messageType: 'clarification_answer',
        payload: {
          questionId: item.id,
          answer,
          answeredBy: 'user',
          answeredAt: Date.now(),
        },
      });
      markAnswered(item.id, answer);
      return null;
    } catch (err) {
      console.error('[ClarificationsPanel] inbound submit failed', err);
      onError?.(err, item);
      return err instanceof Error ? err.message : '提交回答失败，请稍后重试。';
    }
  };

  const handleDismiss = async (item: ClarificationItem): Promise<string | null> => {
    if (!gatewayUrl || !accessToken || !item.fromSessionId) {
      const error = new Error('未登录或缺少 PM1 session');
      console.warn('[ClarificationsPanel] missing gateway / token / fromSessionId');
      onError?.(error, item);
      return error.message;
    }
    const client = createTeamInboundClient(gatewayUrl);
    try {
      await client.dismissClarification(accessToken, item.fromSessionId, item.id);
      dismiss(item.id);
      return null;
    } catch (err) {
      console.error('[ClarificationsPanel] clarification dismiss failed', err);
      onError?.(err, item);
      return err instanceof Error ? err.message : '忽略失败，请稍后重试。';
    }
  };

  return (
    <div style={PANEL_STYLE} data-team-clarification-anchor="true">
      {hasPendingOptions ? <style>{OPTION_STYLES}</style> : null}
      <div style={HEADER_STYLE}>
        <span aria-hidden style={{ fontSize: 18 }}>
          🟡
        </span>
        <span style={TITLE_STYLE}>需要你回答</span>
        <span style={HINT_STYLE}>
          {actionablePendingCount > 0
            ? `${actionablePendingCount} 个澄清待回答（PM1 等待你的输入）`
            : `共 ${filtered.length} 个澄清，全部已回答`}
        </span>
        <span style={{ flex: 1 }} />
        {headerExtra}
      </div>

      {pendingGroups.map((group) => (
        <Fragment key={group.key}>
          {group.label ? <div style={ROUND_CHIP_STYLE}>{group.label}</div> : null}
          {group.items.map((item) =>
            supersededIds.has(item.id) ? (
              <SupersededRow key={item.id} item={item} />
            ) : (
              <PendingCard
                key={item.id}
                item={item}
                onSubmit={(answer) => handleAnswer(item, answer)}
                onDismiss={() => handleDismiss(item)}
              />
            ),
          )}
        </Fragment>
      ))}

      {answered.length > 0 ? (
        <div style={ANSWERED_LIST_STYLE}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--fg-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            已回答 {answered.length} 条
          </span>
          {answered.map((item) => (
            <AnsweredRow key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 同一逻辑问题的旧轮次：只提示已被新一轮取代，不再渲染回答入口。
 * 旧轮次的传输 id 与 live 卡片不同，点进去只会把答案写给过期节点。
 */
function SupersededRow({ item }: { item: ClarificationItem }) {
  return (
    <div style={SUPERSEDED_ROW_STYLE} data-team-clarification-superseded="true">
      <span style={SUPERSEDED_BADGE_STYLE}>已被新一轮取代</span>
      <span style={SUPERSEDED_QUESTION_STYLE}>{item.question}</span>
    </div>
  );
}

function PendingCard({
  item,
  onSubmit,
  onDismiss,
}: {
  item: ClarificationItem;
  onSubmit: (answer: string) => Promise<string | null> | string | null;
  onDismiss: () => Promise<string | null> | string | null;
}) {
  const options = orderOptionsWithRecommendedFirst(item.options ?? []);
  const hasOptions = options.length > 0;
  const [draft, setDraft] = useState('');
  const [freeInputOpen, setFreeInputOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const isPending = submitting || dismissing;
  const freeInputMode = !hasOptions || freeInputOpen;

  const canSubmit = !isPending && draft.trim().length > 0;

  const submitAnswer = async (answer: string): Promise<void> => {
    setSubmitting(true);
    setActionError(null);
    try {
      const errorMessage = await onSubmit(answer);
      if (errorMessage) {
        setActionError(errorMessage);
        return;
      }
      setDraft('');
      setFreeInputOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    await submitAnswer(trimmed);
  };

  const handleDismiss = async () => {
    setDismissing(true);
    setActionError(null);
    try {
      const errorMessage = await onDismiss();
      if (errorMessage) {
        setActionError(errorMessage);
      }
    } finally {
      setDismissing(false);
    }
  };

  return (
    <form style={CARD_STYLE} onSubmit={(event) => void handleSubmit(event)}>
      <span style={QUESTION_STYLE}>
        <span aria-hidden style={{ marginRight: 6 }}>
          ❓
        </span>
        {item.question}
      </span>
      {item.context ? <pre style={CONTEXT_STYLE}>{tryFormatJson(item.context)}</pre> : null}

      {hasOptions ? (
        <div className="clarification-options" role="group" aria-label="可选回答">
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              className={`clarification-option${option.recommended === true ? ' clarification-option--recommended' : ''}`}
              disabled={isPending}
              onClick={() => void submitAnswer(option.label)}
            >
              <span className="clarification-option__label">
                {option.label}
                {option.recommended === true ? (
                  <span className="clarification-option__badge">推荐</span>
                ) : null}
              </span>
              {option.description ? (
                <span className="clarification-option__desc">{option.description}</span>
              ) : null}
            </button>
          ))}
          {freeInputOpen ? null : (
            <button
              type="button"
              className="clarification-free-input-toggle"
              disabled={isPending}
              onClick={() => setFreeInputOpen(true)}
            >
              自由输入（可选）
            </button>
          )}
        </div>
      ) : null}

      {freeInputMode ? (
        <textarea
          name="answer"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="请输入你的回答（提交后 PM1 会在下一轮规划时使用）..."
          style={TEXTAREA_STYLE}
          disabled={isPending}
          required
        />
      ) : null}

      {actionError ? (
        <span role="alert" style={ERROR_TEXT_STYLE}>
          {actionError}
        </span>
      ) : null}

      <div style={ACTIONS_ROW_STYLE}>
        {freeInputMode ? (
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              ...PRIMARY_BTN_STYLE,
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {isPending ? '提交中…' : '提交回答'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void handleDismiss()}
          disabled={isPending}
          style={SECONDARY_BTN_STYLE}
          title="标记为不再询问（不会发送给 PM1）"
        >
          忽略
        </button>
      </div>
    </form>
  );
}

function AnsweredRow({ item }: { item: ClarificationItem }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, color: 'var(--fg-default)', fontWeight: 600 }}>
        ✓ {item.question}
      </span>
      {item.answer ? (
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', paddingLeft: 14 }}>
          → {item.answer}
        </span>
      ) : null}
    </div>
  );
}
