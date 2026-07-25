/**
 * classic Team 对话内嵌运营卡
 *
 * 把失败 handoff / 待澄清 映射为 InlineOpsCard，挂在对话流 afterMessages。
 * 仅 classic 路径使用。
 */

import { useMemo, type CSSProperties } from 'react';
import type { ClarificationItem, HandoffEntry } from '../../../../stores/team/team-events.js';
import { getRoleLayerIdentity } from '../../runtime/data/role-layer-identity.js';
import { TeamInlineOpsCard } from './TeamInlineOpsCard.js';

export interface ClassicTeamConversationInlineCardsProps {
  readonly failedHandoffs?: readonly HandoffEntry[];
  readonly pendingClarifications?: readonly ClarificationItem[];
  readonly runningHandoffs?: readonly HandoffEntry[];
  readonly onRetryFailed?: () => void;
  readonly onFocusWorkbench?: () => void;
  readonly onFillComposer?: (text: string) => void;
}

const LIST_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '4px 0 8px',
  width: 'min(680px, 100%)',
};

function formatTime(ts?: number): string | undefined {
  if (!ts || !Number.isFinite(ts)) return undefined;
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ClassicTeamConversationInlineCards({
  failedHandoffs = [],
  pendingClarifications = [],
  runningHandoffs = [],
  onRetryFailed,
  onFocusWorkbench,
  onFillComposer,
}: ClassicTeamConversationInlineCardsProps) {
  const cards = useMemo(() => {
    const items: Array<{
      id: string;
      tone: 'progress' | 'block' | 'fail' | 'done';
      title: string;
      body?: string;
      timeLabel?: string;
      code?: string;
      actions?: Array<{
        id: string;
        label: string;
        variant?: 'primary' | 'danger' | 'default';
        onClick?: () => void;
      }>;
    }> = [];

    for (const item of pendingClarifications.slice(0, 3)) {
      items.push({
        id: `clarify-${item.id}`,
        tone: 'block',
        title: '需要你确认',
        body: item.question,
        timeLabel: formatTime(item.createdAt),
        code: item.context?.trim() || undefined,
        actions: [
          ...(onFillComposer
            ? [
                {
                  id: 'answer',
                  label: '填入回复',
                  variant: 'primary' as const,
                  onClick: () => onFillComposer(item.question),
                },
              ]
            : []),
          {
            id: 'open-workbench',
            label: '打开任务台',
            onClick: onFocusWorkbench,
          },
        ],
      });
    }

    for (const handoff of failedHandoffs.slice(0, 4)) {
      const from = getRoleLayerIdentity(handoff.fromRoleLayer).short;
      const to = getRoleLayerIdentity(handoff.toRoleLayer).short;
      const title = handoff.summary?.trim() || `${from} → ${to} 失败`;
      items.push({
        id: `fail-${handoff.id}`,
        tone: 'fail',
        title,
        body:
          handoff.failureReason?.trim() ||
          (handoff.recoverableFailure ? '可重试失败' : '任务失败，请查看详情'),
        timeLabel: formatTime(handoff.endedAt ?? handoff.updatedAt),
        actions: [
          ...(onRetryFailed
            ? [
                {
                  id: 'retry',
                  label: '重试失败',
                  variant: 'danger' as const,
                  onClick: onRetryFailed,
                },
              ]
            : []),
          {
            id: 'workbench',
            label: '查看任务台',
            onClick: onFocusWorkbench,
          },
        ],
      });
    }

    // 进行中 handoff：最多 2 条进度卡，避免刷屏
    for (const handoff of runningHandoffs.slice(0, 2)) {
      const to = getRoleLayerIdentity(handoff.toRoleLayer).short;
      items.push({
        id: `run-${handoff.id}`,
        tone: 'progress',
        title: handoff.summary?.trim() || `${to} 运行中`,
        body: `${getRoleLayerIdentity(handoff.fromRoleLayer).short} → ${to}`,
        timeLabel: formatTime(handoff.startedAt ?? handoff.updatedAt),
        actions: onFocusWorkbench
          ? [
              {
                id: 'workbench',
                label: '定位任务',
                onClick: onFocusWorkbench,
              },
            ]
          : undefined,
      });
    }

    return items;
  }, [
    failedHandoffs,
    onFillComposer,
    onFocusWorkbench,
    onRetryFailed,
    pendingClarifications,
    runningHandoffs,
  ]);

  if (cards.length === 0) return null;

  return (
    <div style={LIST_STYLE} data-team-classic-inline-cards="true">
      {cards.map((card) => (
        <div
          key={card.id}
          data-team-ops-card-id={card.id}
          data-team-attention-anchor={
            card.tone === 'fail' || card.tone === 'block' ? 'true' : undefined
          }
        >
          <TeamInlineOpsCard
            tone={card.tone}
            title={card.title}
            body={card.body}
            timeLabel={card.timeLabel}
            code={card.code}
            actions={card.actions}
          />
        </div>
      ))}
    </div>
  );
}
