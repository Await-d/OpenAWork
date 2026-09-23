/**
 * rollback-derived-state · 回合回退后的「子代理派生状态」清理（纯逻辑）
 *
 * 回退（截断重发 / 编辑重发）在后端只删该回合的派生物（任务图节点、run events、
 * 团队记录、diff / 快照记录…），**子会话本身保留**（ADR：回合回退不删除其它会话的
 * 数据）。因此前端必须自己把「属于被作废回合的子代理展示」摘掉，否则它们会一直挂在
 * 页面上——这正是回退后「子代理信息还在展示」的根因。
 *
 * 三处清理口径：
 *   1. 子会话列表：按 metadata 的 `taskParentToolRequestId`（创建它的回合键）匹配
 *      receipt 的 `invalidatedClientRequestIds`；
 *   2. 任务列表：子代理运行列表是 **task 驱动**（`task.sessionId` 指向子会话），
 *      移除指向被摘除子会话的任务；
 *   3. 子代理完成通知：按作废窗口 `[cutoffTimeMs, tombstoneAtMs)` 过滤（与 team 的
 *      rollback-tombstones 同口径，多端幂等）。
 */

import type { SubagentNotice } from '@openAwork/shared';
import type { RollbackReceipt, Session, SessionTask } from '@openAwork/web-client';

/** 与网关 `tool-sandbox.ts` 的 `TASK_PARENT_TOOL_REQUEST_ID_KEY` 必须一致。 */
export const TASK_PARENT_TOOL_REQUEST_ID_KEY = 'taskParentToolRequestId';

/** 从子会话 metadata 读取「创建它的父回合键」；缺失 / 脏数据返回 null。 */
export function readTaskParentRequestId(metadataJson: string | undefined): string | null {
  if (typeof metadataJson !== 'string' || metadataJson.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const value = (parsed as Record<string, unknown>)[TASK_PARENT_TOOL_REQUEST_ID_KEY];
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export interface RollbackDerivedStateInput {
  receipt: Pick<
    RollbackReceipt,
    'cutoffTimeMs' | 'invalidatedClientRequestIds' | 'tombstoneAtMs'
  > | null;
  childSessions: readonly Session[];
  subagentNotices: readonly SubagentNotice[];
  sessionTasks: readonly SessionTask[];
}

export interface RollbackDerivedStateResult {
  childSessions: Session[];
  /** 被摘除的子会话 id（供调用方顺带清理选中态）。 */
  removedChildSessionIds: readonly string[];
  sessionTasks: SessionTask[];
  subagentNotices: SubagentNotice[];
}

/**
 * 计算回退后的派生状态。receipt 为空或未失效任何回合时原样返回（幂等 no-op）——
 * 旧网关可能不返回 receipt，此时不得猜测删除。
 */
export function resolveRollbackDerivedState(
  input: RollbackDerivedStateInput,
): RollbackDerivedStateResult {
  const invalidatedRequestIds = new Set(input.receipt?.invalidatedClientRequestIds ?? []);
  if (invalidatedRequestIds.size === 0) {
    return {
      childSessions: [...input.childSessions],
      removedChildSessionIds: [],
      sessionTasks: [...input.sessionTasks],
      subagentNotices: [...input.subagentNotices],
    };
  }

  const removedChildSessionIds: string[] = [];
  const childSessions = input.childSessions.filter((child) => {
    const parentRequestId = readTaskParentRequestId(child.metadata_json);
    if (parentRequestId !== null && invalidatedRequestIds.has(parentRequestId)) {
      removedChildSessionIds.push(child.id);
      return false;
    }
    return true;
  });

  const removedChildSessionIdSet = new Set(removedChildSessionIds);
  const sessionTasks = input.sessionTasks.filter(
    (task) => !(task.sessionId && removedChildSessionIdSet.has(task.sessionId)),
  );

  const cutoffTimeMs = input.receipt?.cutoffTimeMs ?? 0;
  const tombstoneAtMs = input.receipt?.tombstoneAtMs ?? 0;
  const subagentNotices = input.subagentNotices.filter((notice) => {
    const createdAt = notice.createdAt;
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) {
      return true;
    }
    return createdAt < cutoffTimeMs || createdAt >= tombstoneAtMs;
  });

  return {
    childSessions,
    removedChildSessionIds,
    sessionTasks,
    subagentNotices,
  };
}
