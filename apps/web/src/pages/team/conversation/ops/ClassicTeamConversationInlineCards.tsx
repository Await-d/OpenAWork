/**
 * classic Team 对话内嵌运营卡
 *
 * 把失败 handoff / 进行中 handoff 映射为 InlineOpsCard，挂在对话流 afterMessages。
 * 澄清不再逐条渲染（避免同一个确认在对话里和任务台重复出现）：只保留 1 张聚合卡，
 * 指向唯一可交互面「任务 → 待澄清」面板。仅 classic 路径使用。
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
}

const LIST_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '4px 0 8px',
  // 渲染在对话流尾部（内容列内）：宽度对齐内容列（1080 上限）并居中，
  // 与错误诊断简报 / 智能引导气泡同一约定。classic 对话区在宽屏下远宽于
  // 卡片，只给 width 不给 alignSelf 会让卡片贴着内容列左侧、右侧空一大片。
  width: '100%',
  maxWidth: 1080,
  alignSelf: 'center',
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

    if (pendingClarifications.length > 0) {
      items.push({
        id: 'clarify-aggregate',
        tone: 'block',
        title: `还有 ${pendingClarifications.length} 项澄清需要你确认`,
        body: '为避免同一个确认在对话与任务台重复出现，请到「任务 → 待澄清」面板统一回答。',
        actions: [
          {
            id: 'open-workbench',
            label: '打开任务台',
            variant: 'primary',
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
  }, [failedHandoffs, onFocusWorkbench, onRetryFailed, pendingClarifications, runningHandoffs]);

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
