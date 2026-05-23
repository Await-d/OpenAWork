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
 *   - 每条卡片：question + 上下文片段 + 输入框 + 「提交回答」/「忽略」
 *   - 已回答的会保留在已答区，可折叠
 *
 * 可阻断性：
 *   - 当 pending 数量 > 0 时，调用方可选择把 c 层向导锁住（不让进 plan）
 *     这里只渲染 UI，由父组件决定是否拦截
 */

import { useActionState, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  useClarificationStore,
  type ClarificationItem,
} from '../../../../../stores/team/team-events.js';
import { useAuthStore } from '../../../../../stores/auth/auth.js';
import { createTeamInboundClient } from '@openAwork/web-client';

const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '14px 16px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--warning) 36%, transparent)',
  background: 'color-mix(in srgb, var(--warning) 6%, var(--bg-overlay)',
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

const CARD_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'var(--card-bg, var(--bg-overlay)',
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
  background: 'color-mix(in srgb, var(--success) 5%, var(--bg-overlay)',
  border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)',
};

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

  if (filtered.length === 0) return null;

  const handleAnswer = async (item: ClarificationItem, answer: string) => {
    if (!gatewayUrl || !accessToken || !item.fromSessionId) {
      console.warn('[ClarificationsPanel] missing gateway / token / fromSessionId');
      onError?.(new Error('未登录或缺少 PM1 session'), item);
      return;
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
    } catch (err) {
      console.error('[ClarificationsPanel] inbound submit failed', err);
      onError?.(err, item);
    }
  };

  return (
    <div style={PANEL_STYLE}>
      <div style={HEADER_STYLE}>
        <span aria-hidden style={{ fontSize: 18 }}>
          🟡
        </span>
        <span style={TITLE_STYLE}>需要你回答</span>
        <span style={HINT_STYLE}>
          {pending.length > 0
            ? `${pending.length} 个澄清待回答（PM1 等待你的输入）`
            : `共 ${filtered.length} 个澄清，全部已回答`}
        </span>
        <span style={{ flex: 1 }} />
        {headerExtra}
      </div>

      {pending.map((item) => (
        <PendingCard
          key={item.id}
          item={item}
          onSubmit={(answer) => handleAnswer(item, answer)}
          onDismiss={() => dismiss(item.id)}
        />
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

function PendingCard({
  item,
  onSubmit,
  onDismiss,
}: {
  item: ClarificationItem;
  onSubmit: (answer: string) => Promise<void> | void;
  onDismiss: () => void;
}) {
  // React 19 Actions：FormData 承载提交数据，同时保留受控 draft 仅用于按钮
  // disabled 的 visual feedback（与项目其他禁用按钮 UX 保持一致）。
  // pending 状态直接取 useActionState 第三个返回值，在同一组件内使用无需 useFormStatus。
  const [draft, setDraft] = useState('');
  const [, submitAnswer, isPending] = useActionState<string, FormData>(async (_prev, formData) => {
    const trimmed = String(formData.get('answer') ?? '').trim();
    if (!trimmed) return '';
    await onSubmit(trimmed);
    return '';
  }, '');

  const canSubmit = !isPending && draft.trim().length > 0;

  return (
    <form style={CARD_STYLE} action={submitAnswer}>
      <span style={QUESTION_STYLE}>
        <span aria-hidden style={{ marginRight: 6 }}>
          ❓
        </span>
        {item.question}
      </span>
      {item.context ? <pre style={CONTEXT_STYLE}>{item.context}</pre> : null}
      <textarea
        name="answer"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="请输入你的回答（提交后 PM1 会在下一轮规划时使用）..."
        style={TEXTAREA_STYLE}
        disabled={isPending}
        required
      />
      <div style={ACTIONS_ROW_STYLE}>
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
        <button
          type="button"
          onClick={onDismiss}
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
