/**
 * classic-only 右侧 layer/todo 工作台容器
 *
 * 从 handoff / taskLanes / layer nodes 派生 view-model，渲染 TeamLayerTodoWorkbench。
 * 不改 fusion 路径；由 TeamPageV2 仅在 isClassicWorkbench 时挂载。
 */

import { useMemo, type ReactNode } from 'react';
import type {
  HandoffEntry,
  LayerNode,
  TeamRoleLayer,
} from '../../../../stores/team/team-events.js';
import type { AgentTeamsTaskLane } from '../../runtime/data/team-runtime-types.js';
import { getRoleLayerIdentity } from '../../runtime/data/role-layer-identity.js';
import { TeamLayerTodoWorkbench } from './TeamLayerTodoWorkbench.js';
import { useTeamLayerTodoWorkbenchModel } from './use-team-layer-todo-workbench-model.js';
import type { WorkbenchTodo } from './team-layer-todo-workbench-model.js';

export interface ClassicTeamLayerTodoSidePanelProps {
  readonly handoffs: readonly HandoffEntry[];
  readonly layerNodes?: readonly LayerNode[];
  readonly taskLanes?: readonly AgentTeamsTaskLane[];
  readonly overviewSlot?: ReactNode;
  readonly metricsSlot?: ReactNode;
  readonly governanceSlot?: ReactNode;
}

/**
 * taskLanes 丢失了原始 status：completed/failed 都进 review。
 * 用 card.tags 还原（reference-data 写入：阻塞/已完成/推进中/待认领）。
 */
function mapLaneCardToStatus(
  laneId: AgentTeamsTaskLane['id'],
  tags: readonly string[] | undefined,
): string {
  const tagSet = new Set(tags ?? []);
  if (tagSet.has('阻塞')) return 'failed';
  if (tagSet.has('已完成')) return 'completed';
  if (tagSet.has('推进中') || laneId === 'doing') return 'running';
  if (tagSet.has('待认领') || laneId === 'todo') return 'pending';
  if (laneId === 'review') return 'completed';
  return 'pending';
}

function inferRoleLayerFromAssignee(assignee: string | null | undefined): TeamRoleLayer | null {
  if (!assignee) return null;
  const raw = assignee.trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'reception' || raw.includes('接待')) return 'reception';
  if (raw === 'pm1' || raw.includes('规划')) return 'pm1';
  if (raw === 'pm2' || raw.includes('管控')) return 'pm2';
  if (raw === 'executor' || raw.includes('执行')) return 'executor';
  if (raw === 'tester' || raw.includes('测试')) return 'tester';
  if (raw === 'reviewer' || raw.includes('评审')) return 'reviewer';
  return null;
}

export function ClassicTeamLayerTodoSidePanel({
  handoffs,
  layerNodes = [],
  taskLanes = [],
  overviewSlot,
  metricsSlot,
  governanceSlot,
}: ClassicTeamLayerTodoSidePanelProps) {
  const layersInput = useMemo(() => {
    if (layerNodes.length === 0) return undefined;
    const byLayer = new Map<
      TeamRoleLayer,
      { id: TeamRoleLayer; state: string; displayName?: string | null; live?: boolean }
    >();
    for (const node of layerNodes) {
      const current = byLayer.get(node.roleLayer);
      const live = node.state === 'running' || node.state === 'claimed';
      if (!current) {
        byLayer.set(node.roleLayer, {
          id: node.roleLayer,
          state: node.state,
          displayName: node.displayName ?? node.title ?? null,
          live,
        });
        continue;
      }
      if (node.state === 'failed' || (current.state !== 'failed' && live)) {
        byLayer.set(node.roleLayer, {
          id: node.roleLayer,
          state: node.state === 'failed' ? 'failed' : live ? 'running' : node.state,
          displayName: node.displayName ?? current.displayName ?? null,
          live: current.live || live,
        });
      }
    }
    return Array.from(byLayer.values());
  }, [layerNodes]);

  const handoffsInput = useMemo(
    () =>
      handoffs.map((h) => ({
        id: h.id,
        state: h.state,
        fromRoleLayer: h.fromRoleLayer,
        toRoleLayer: h.toRoleLayer,
        summary: h.summary ?? null,
        failureReason: h.failureReason ?? null,
        startedAt: h.startedAt,
        endedAt: h.endedAt,
        paused: h.paused,
        updatedAt: h.updatedAt,
      })),
    [handoffs],
  );

  const runtimeTasksInput = useMemo(() => {
    const tasks: Array<{
      id: string;
      title: string;
      status: string;
      priority?: string | null;
      assignedAgent?: string | null;
      result?: string | null;
      errorMessage?: string | null;
      roleLayer?: TeamRoleLayer | string | null;
    }> = [];
    for (const lane of taskLanes) {
      for (const card of lane.cards) {
        const status = mapLaneCardToStatus(lane.id, card.tags);
        tasks.push({
          id: card.id,
          title: card.title,
          status,
          priority: card.priority,
          assignedAgent: card.assignee || null,
          result: status === 'failed' ? null : card.description || null,
          errorMessage: status === 'failed' ? card.description || null : null,
          roleLayer: inferRoleLayerFromAssignee(card.assignee),
        });
      }
    }
    return tasks;
  }, [taskLanes]);

  const {
    model,
    selection,
    setTab,
    setTodoFilter,
    setMsgFilter,
    onSelectLayer,
    onSelectRole,
    onSelectTodo,
  } = useTeamLayerTodoWorkbenchModel({
    layers: layersInput,
    handoffs: handoffsInput,
    runtimeTasks: runtimeTasksInput,
  });

  const roles = useMemo(() => {
    if (selection.layerId === 'all') {
      return model.layers.flatMap((layer) =>
        layer.roles.map((role) => ({
          id: role.id,
          name: role.name,
          state: role.status,
          color: layer.color,
        })),
      );
    }
    const layer = model.layers.find((item) => item.id === selection.layerId);
    return (layer?.roles ?? []).map((role) => ({
      id: role.id,
      name: role.name,
      state: role.status,
      color: layer?.color,
    }));
  }, [model.layers, selection.layerId]);

  const todosForList = useMemo(
    () =>
      model.filteredTodos.map((todo) => ({
        id: todo.id,
        key: todo.key,
        title: todo.title,
        sub: todo.sub,
        status: todo.status,
        priority: todo.priority,
        time: todo.elapsedLabel,
      })),
    [model.filteredTodos],
  );

  const detailTodo = useMemo(() => {
    const todo = model.activeTodo as WorkbenchTodo | null;
    if (!todo) return null;
    const identity = getRoleLayerIdentity(todo.layer);
    return {
      id: todo.id,
      key: todo.key,
      title: todo.title,
      layerName: identity.short,
      layerColor: identity.color,
      roleName: todo.owner ?? todo.roleId,
      status: todo.status,
    };
  }, [model.activeTodo]);

  const detailMessages = useMemo(() => {
    const todo = model.activeTodo;
    if (!todo) return [];

    const messages: Array<{
      id: string;
      role?: string;
      who?: string;
      when?: string;
      text: string;
      tags?: string[];
    }> = [];

    messages.push({
      id: `${todo.id}-summary`,
      role: 'system',
      who: '任务',
      text: `${todo.key} ${todo.title}`,
      tags: [todo.status, todo.source],
    });

    if (todo.sub) {
      messages.push({
        id: `${todo.id}-sub`,
        role: todo.status === 'failed' ? 'error' : 'assistant',
        who: todo.owner ?? getRoleLayerIdentity(todo.layer).short,
        text: todo.sub,
        tags: todo.status === 'failed' ? ['error'] : ['detail'],
      });
    }

    if (todo.elapsedLabel) {
      messages.push({
        id: `${todo.id}-elapsed`,
        role: 'system',
        who: '耗时',
        text: todo.elapsedLabel,
        tags: ['timing'],
      });
    }

    const related = handoffs
      .filter((h) => h.toRoleLayer === todo.layer || h.id === todo.id)
      .slice(0, 6);
    for (const h of related) {
      if (messages.some((m) => m.id === `handoff-${h.id}`)) continue;
      const identity = getRoleLayerIdentity(h.toRoleLayer);
      const text =
        h.failureReason?.trim() ||
        h.summary?.trim() ||
        `${getRoleLayerIdentity(h.fromRoleLayer).short} → ${identity.short} · ${h.state}`;
      messages.push({
        id: `handoff-${h.id}`,
        role: h.state === 'failed' ? 'error' : h.state === 'running' ? 'assistant' : 'system',
        who: identity.short,
        when: h.endedAt
          ? new Date(h.endedAt).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : h.startedAt
            ? new Date(h.startedAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : undefined,
        text,
        tags: ['handoff', h.state],
      });
    }

    return messages;
  }, [handoffs, model.activeTodo]);

  return (
    <TeamLayerTodoWorkbench
      tab={selection.tab}
      onTabChange={setTab}
      layers={model.layers.map((layer) => ({
        id: layer.id,
        code: layer.code,
        name: layer.name,
        color: layer.color,
        state: layer.state,
        stateLabel: layer.stateLabel,
        live: layer.live,
      }))}
      activeLayerId={selection.layerId === 'all' ? null : selection.layerId}
      onSelectLayer={(layerId) => onSelectLayer(layerId as TeamRoleLayer)}
      roles={roles}
      activeRoleId={selection.roleId}
      onSelectRole={onSelectRole}
      todos={todosForList}
      activeTodoId={selection.todoId}
      todoFilter={selection.todoFilter}
      onTodoFilterChange={setTodoFilter}
      onSelectTodo={onSelectTodo}
      detailTodo={detailTodo}
      detailMessages={detailMessages}
      msgFilter={selection.msgFilter}
      onMsgFilterChange={setMsgFilter}
      counts={{
        tasks: model.counts.tasks,
        failTasks: model.counts.failTasks,
        govPending: model.counts.govPending,
      }}
      overviewSlot={overviewSlot}
      metricsSlot={metricsSlot}
      governanceSlot={governanceSlot}
    />
  );
}
