import type { CanonicalRoleDescriptor } from '@openAwork/shared';
import type { TeamMessage } from './team-message.js';

export type MemberStatus =
  | 'idle' // 空闲
  | 'working' // 工作中
  | 'waiting_for_input' // 等待其他成员输入
  | 'waiting_for_approval' // 等待审批
  | 'blocked' // 被阻塞（无法继续）
  | 'collaborating' // 正在协作
  | 'done' // 已完成
  | 'error'; // 错误状态

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  canonicalRole?: CanonicalRoleDescriptor;
  status: MemberStatus;
  currentTask?: string;

  // 新增字段
  blockedBy?: string[]; // 被哪些成员阻塞
  waitingFor?: string; // 等待谁的响应（成员 ID）
  collaboratingWith?: string[]; // 正在与谁协作
  messageQueue: TeamMessage[]; // 待处理消息队列
  capabilities: string[]; // 能力列表（例如 ['code', 'review', 'test']）
  lastActiveAt?: number; // 最后活跃时间
}

export type MemberStatusTransition = {
  from: MemberStatus;
  to: MemberStatus;
  condition?: string; // 转换条件描述
};

// 合法的状态转换表
const VALID_TRANSITIONS: MemberStatusTransition[] = [
  { from: 'idle', to: 'working' },
  { from: 'working', to: 'waiting_for_input' },
  { from: 'working', to: 'waiting_for_approval' },
  { from: 'working', to: 'blocked' },
  { from: 'working', to: 'collaborating' },
  { from: 'working', to: 'done' },
  { from: 'working', to: 'error' },
  { from: 'waiting_for_input', to: 'working', condition: '收到输入' },
  { from: 'waiting_for_input', to: 'blocked', condition: '超时' },
  { from: 'waiting_for_approval', to: 'working', condition: '审批通过' },
  { from: 'waiting_for_approval', to: 'error', condition: '审批拒绝' },
  { from: 'blocked', to: 'idle', condition: '阻塞解除' },
  { from: 'collaborating', to: 'working', condition: '协作结束' },
  { from: 'error', to: 'idle', condition: '错误恢复' },
  { from: 'done', to: 'idle', condition: '重新分配任务' },
];

export function canTransition(from: MemberStatus, to: MemberStatus): boolean {
  return VALID_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

export function transitionMemberStatus(
  member: TeamMember,
  newStatus: MemberStatus,
  reason?: string,
): TeamMember {
  if (!canTransition(member.status, newStatus)) {
    throw new Error(
      `Invalid status transition: ${member.status} -> ${newStatus}` +
        (reason ? ` (reason: ${reason})` : ''),
    );
  }

  return {
    ...member,
    status: newStatus,
    lastActiveAt: Date.now(),
  };
}

export { VALID_TRANSITIONS };
