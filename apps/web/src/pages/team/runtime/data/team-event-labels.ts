/**
 * team-event-labels · team-event 类型 → 人类可读文案的唯一事实源
 *
 * 背景：team-events WS 推送的事件 `type` 是机器串（如 `session.substate.changed`、
 * `session.init.changed`、`handoff.completed`）。这些串**不应该**直接出现在
 * 面向用户的 UI（待回复列表 / 推送条 / 通知）里——用户看到 `session.substate.changed`
 * 这种原始 key 完全无法理解。
 *
 * 早期 `EVENT_TYPE_LABEL` / `eventTypeLabel` / substate 展开逻辑只存在于
 * `ConversationArea.tsx` 的推送条里，导致 `MentionsView`（待回复）等其它消费方
 * 仍然裸渲染 `event.type`，把机器串泄漏到界面上。本模块把这套映射收敛成单一来源，
 * 供所有需要把 team-event 显示给人看的地方复用。
 */

import { substateLabelAny } from './substates.js';
import type { HandoffEvent, TeamRoleLayer } from '../../../../stores/team/team-events.js';

/** team-event 类型 → 中文标签（避免直接暴露 `xxx.changed` 等原始串）。 */
export const TEAM_EVENT_TYPE_LABEL: Record<string, string> = {
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
  waiting_confirmation: '等待确认',
  blocking: '阻塞',
};

/** 角色层 → 中文短标签（与 role-layer-identity 的 short 对齐）。 */
export const TEAM_EVENT_LAYER_LABEL: Record<string, string> = {
  user: '用户',
  reception: '接待',
  pm1: '规划',
  pm2: '管控',
  executor: '执行',
  tester: '测试',
  reviewer: '评审',
};

/** team-event 类型 → 中文标签；未知类型回退把 `_`/`.` 转成空格的可读串。 */
export function teamEventTypeLabel(type: string): string {
  return TEAM_EVENT_TYPE_LABEL[type] ?? type.replaceAll('_', ' ').replaceAll('.', ' · ');
}

/** 角色层 → 中文短标签；未知值回退原文。 */
export function teamEventLayerLabel(
  layer: TeamRoleLayer | string | undefined | null,
): string | null {
  if (!layer) return null;
  return TEAM_EVENT_LAYER_LABEL[layer] ?? layer;
}

/**
 * 把一条 team-event 折叠成「人话」摘要。
 *
 * 优先级：
 *   1. payload.summary / message / detail（后端给的现成可读文案）
 *   2. substate.changed → 展开成具体阶段（如「草拟规格」）
 *   3. 事件类型中文标签（如「初始化进度」）
 *
 * 不再回退到 `event.type.replaceAll('_',' ')`——那样仍会把 `session.init.changed`
 * 这类带 `.` 的机器串泄漏给用户。
 */
export function formatTeamEventSummary(event: HandoffEvent): string {
  const explicit =
    (event.payload['summary'] as string | undefined) ??
    (event.payload['message'] as string | undefined) ??
    (event.payload['detail'] as string | undefined);
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim();
  }

  if (event.type === 'session.substate.changed') {
    const substate =
      typeof event.payload['substate'] === 'string' ? (event.payload['substate'] as string) : null;
    const stageLabel = substateLabelAny(substate);
    if (stageLabel) {
      // 只回阶段名（如「草拟规格」）。调用方通常已经把事件类型标签（「阶段更新」）
      // 显示在标题处，这里再带前缀会与标题重复，故只补充具体阶段。
      return stageLabel;
    }
  }

  return teamEventTypeLabel(event.type);
}
