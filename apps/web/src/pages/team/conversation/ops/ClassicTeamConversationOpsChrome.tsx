/**
 * classic Team 对话内提示壳
 *
 * 状态/操作按钮已上移到最顶 TeamStatusBar。
 * 这里只保留「待你处理」与「已确认」信息。
 */

import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import type { ClarificationItem, HandoffEntry } from '../../../../stores/team/team-events.js';
import { TeamAttentionBar } from './TeamAttentionBar.js';
import { TeamDecisionBar } from './TeamDecisionBar.js';

export interface ClassicTeamConversationOpsChromeProps {
  readonly pathLabel?: string;
  readonly mode?: 'running' | 'paused' | 'idle';
  readonly failCount?: number;
  readonly failedHandoffs?: readonly HandoffEntry[];
  readonly pendingClarifications?: readonly ClarificationItem[];
  readonly busy?: boolean;
  readonly focusMode?: boolean;
  readonly onPauseAll?: () => void;
  readonly onResumeAll?: () => void;
  readonly onRetryFailed?: () => void;
  readonly onToggleFocus?: () => void;
  readonly onFocusFail?: () => void;
  readonly onFocusClarifications?: () => void;
  readonly initialDecisions?: Array<{ id: string; label: string }>;
}

const WRAP_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  padding: 0,
  flexShrink: 0,
};

export function ClassicTeamConversationOpsChrome({
  failedHandoffs = [],
  pendingClarifications = [],
  onFocusFail,
  onFocusClarifications,
  initialDecisions = [],
}: ClassicTeamConversationOpsChromeProps) {
  const [decisions, setDecisions] = useState(initialDecisions);
  const primaryFail = failedHandoffs[0] ?? null;
  const clarifyCount = pendingClarifications.length;

  const attention = useMemo((): {
    show: boolean;
    title: string;
    hint: string | undefined;
    count: number | undefined;
  } => {
    if (primaryFail) {
      const title =
        primaryFail.summary?.trim() ||
        `${primaryFail.fromRoleLayer} → ${primaryFail.toRoleLayer} 失败`;
      const hint =
        primaryFail.failureReason?.trim() ||
        (primaryFail.recoverableFailure ? '可重试' : '查看右侧任务台定位');
      return { show: true, title, hint, count: clarifyCount > 0 ? clarifyCount : undefined };
    }
    if (clarifyCount > 0) {
      return {
        show: true,
        title: `${clarifyCount} 项澄清待你回答`,
        hint: '到「任务 → 待澄清」面板统一回答',
        count: clarifyCount,
      };
    }
    return { show: false, title: '', hint: undefined, count: undefined };
  }, [clarifyCount, primaryFail]);

  const handleFocusFail = useCallback(() => {
    if (onFocusFail) {
      onFocusFail();
      return;
    }
    const target = document.querySelector('[data-team-attention-anchor="true"]');
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [onFocusFail]);

  const handleFocusClarifications = useCallback(() => {
    if (onFocusClarifications) {
      onFocusClarifications();
      return;
    }
    const target = document.querySelector('[data-team-clarification-anchor="true"]');
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [onFocusClarifications]);

  const handleRemoveDecision = useCallback((id: string) => {
    setDecisions((prev) => prev.filter((item) => item.id !== id));
  }, []);

  if (!attention.show && decisions.length === 0) {
    return null;
  }

  return (
    <div style={WRAP_STYLE} data-team-classic-ops-chrome="true">
      {attention.show ? (
        <div data-team-attention-anchor="true">
          <TeamAttentionBar
            show
            title={attention.title}
            hint={attention.hint}
            count={attention.count}
            onJump={primaryFail ? handleFocusFail : handleFocusClarifications}
          />
        </div>
      ) : null}
      <TeamDecisionBar decisions={decisions} onRemove={handleRemoveDecision} />
    </div>
  );
}
