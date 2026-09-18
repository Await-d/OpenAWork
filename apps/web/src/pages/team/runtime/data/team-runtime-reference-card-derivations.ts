import type { TeamMemberRecord, TeamTaskRecord } from '@openAwork/web-client';
import type { useTeamRuntimeRoleBindings } from '../hooks/use-team-runtime-role-bindings.js';
import { ROLE_SLOT_CONFIG } from './team-runtime-reference-config.js';
import { mapMemberStatusLabel } from './team-runtime-reference-formatters.js';
import { mapTaskToLaneId } from './team-runtime-task-lanes.js';
import type { AgentTeamsRoleChip, AgentTeamsTaskLane } from './team-runtime-types.js';

type TeamRuntimeRoleCard = NonNullable<
  ReturnType<typeof useTeamRuntimeRoleBindings>['roleCards'][number]
>;

export function buildRuntimeRoleChips(
  members: TeamMemberRecord[],
  roleCards: TeamRuntimeRoleCard[],
): AgentTeamsRoleChip[] {
  return ROLE_SLOT_CONFIG.map((slot, index) => {
    const member = members[index] ?? null;
    const binding = roleCards[index] ?? null;
    const boundAgent = binding?.selectedAgent ?? null;
    return {
      accent: slot.accent,
      badge:
        boundAgent?.label.slice(0, 1).toUpperCase() ??
        member?.name.slice(0, 1).toUpperCase() ??
        slot.badge,
      id: boundAgent?.id ?? member?.id ?? slot.id,
      leader: slot.leader || binding?.role === 'planner',
      provider: boundAgent?.label ?? boundAgent?.id ?? binding?.roleLabel ?? slot.fallbackProvider,
      role: boundAgent?.label ?? member?.name ?? slot.fallbackLabel,
      status: mapMemberStatusLabel(member?.status),
    } satisfies AgentTeamsRoleChip;
  });
}

export function buildAccentByMemberId(
  members: TeamMemberRecord[],
  roleChips: AgentTeamsRoleChip[],
): Map<string, string> {
  const map = new Map<string, string>();
  roleChips.forEach((chip, index) => {
    const memberId = members[index]?.id;
    if (memberId) {
      map.set(memberId, chip.accent);
    }
  });
  return map;
}

export function buildMemberNameById(members: TeamMemberRecord[]): Map<string, string> {
  return new Map(members.map((member) => [member.id, member.name]));
}

export function buildTaskLanes(input: {
  selectedRuntimeTaskRecords: TeamTaskRecord[];
  teamTasks: TeamTaskRecord[];
  memberNameById: ReadonlyMap<string, string>;
  accentByMemberId: ReadonlyMap<string, string>;
}): AgentTeamsTaskLane[] {
  const lanes: AgentTeamsTaskLane[] = [
    { id: 'todo', title: '待办', cards: [] },
    { id: 'doing', title: '进行中', cards: [] },
    { id: 'review', title: '待评审', cards: [] },
  ];

  for (const task of input.selectedRuntimeTaskRecords) {
    const assigneeName = task.assignedAgent
      ? (input.memberNameById.get(task.assignedAgent) ?? task.assignedAgent)
      : task.assigneeId
        ? (input.memberNameById.get(task.assigneeId) ?? '未分配')
        : '未分配';
    const assigneeAccent =
      (task.assignedAgent ? input.accentByMemberId.get(task.assignedAgent) : undefined) ??
      (task.assigneeId ? input.accentByMemberId.get(task.assigneeId) : undefined) ??
      ROLE_SLOT_CONFIG[1].accent;
    lanes
      .find((lane) => lane.id === mapTaskToLaneId(task.status))
      ?.cards.push({
        assignee: assigneeName,
        assigneeAccent,
        description: task.result ?? '等待进一步推进与同步。',
        id: task.id,
        mutable: input.teamTasks.some((item) => item.id === task.id),
        priority: task.priority,
        tags:
          task.status === 'failed'
            ? ['阻塞']
            : task.status === 'completed'
              ? ['已完成']
              : task.status === 'in_progress'
                ? ['推进中']
                : ['待认领'],
        title: task.title,
      });
  }
  return lanes;
}
