/**
 * classic Team 右侧 layer/todo 工作台 · 纯派生 view-model
 *
 * 不依赖 React。从 handoff / runtime task / session todo 派生层、角色、任务与选中态。
 * 仅供 classic workbench 使用；不改 fusion 路径。
 */

import type { TeamRoleLayer } from '../../../../stores/team/team-events.js';
import { getRoleLayerIdentity } from '../../runtime/data/role-layer-identity.js';

export type WorkbenchTabKey = 'tasks' | 'overview' | 'metrics' | 'governance';
export type WorkbenchTodoStatus = 'pending' | 'running' | 'failed' | 'blocked' | 'done';
export type WorkbenchTodoFilter = 'all' | 'active' | 'blocked' | 'done';
export type WorkbenchMsgFilter = 'all' | 'dialog' | 'tool' | 'error' | 'handoff';

export interface WorkbenchRole {
  id: string;
  name: string;
  status: 'idle' | 'run' | 'fail' | 'done';
  statusLabel: string;
  taskCount: number;
  layerId: TeamRoleLayer;
}

export interface WorkbenchLayer {
  id: TeamRoleLayer;
  code: string;
  name: string;
  color: string;
  state: 'idle' | 'pending' | 'running' | 'completed' | 'failed';
  stateLabel: string;
  live: boolean;
  roles: WorkbenchRole[];
}

export interface WorkbenchTodo {
  id: string;
  key: string;
  title: string;
  sub?: string;
  layer: TeamRoleLayer;
  roleId?: string;
  status: WorkbenchTodoStatus;
  priority?: 'P0' | 'P1' | 'P2';
  owner?: string;
  elapsedLabel?: string;
  source: 'handoff' | 'runtime-task' | 'session-todo';
}

export interface WorkbenchSelection {
  tab: WorkbenchTabKey;
  layerId: TeamRoleLayer | 'all';
  roleId: string | 'all';
  todoId: string | null;
  todoFilter: WorkbenchTodoFilter;
  msgFilter: WorkbenchMsgFilter;
}

export interface BuildWorkbenchModelInput {
  layers?: Array<{
    id: TeamRoleLayer;
    state?: string | null;
    displayName?: string | null;
    personaKey?: string | null;
    live?: boolean;
  }>;
  handoffs?: Array<{
    id: string;
    state: string;
    fromRoleLayer: TeamRoleLayer;
    toRoleLayer: TeamRoleLayer;
    summary?: string | null;
    failureReason?: string | null;
    startedAt?: number;
    endedAt?: number;
    paused?: boolean;
    updatedAt?: number;
  }>;
  runtimeTasks?: Array<{
    id: string;
    title: string;
    status: string;
    priority?: string | number | null;
    assignedAgent?: string | null;
    result?: string | null;
    errorMessage?: string | null;
    createdAt?: string | number;
    updatedAt?: string | number;
    sessionId?: string | null;
    roleLayer?: TeamRoleLayer | string | null;
  }>;
  sessionTodos?: Array<{
    id: string;
    content?: string;
    status?: string;
    activeForm?: string;
  }>;
  selection?: Partial<WorkbenchSelection>;
}

export interface WorkbenchBadgeCounts {
  tasks: number;
  failTasks: number;
  runningTasks: number;
  doneTasks: number;
  govPending: number;
}

export interface TeamLayerTodoWorkbenchModel {
  layers: WorkbenchLayer[];
  todos: WorkbenchTodo[];
  filteredTodos: WorkbenchTodo[];
  selection: WorkbenchSelection;
  activeTodo: WorkbenchTodo | null;
  counts: WorkbenchBadgeCounts;
}

/** 固定展示顺序：权威 5 层 + 前端事件层 tester。 */
const CANONICAL_LAYER_IDS: readonly TeamRoleLayer[] = [
  'reception',
  'pm1',
  'pm2',
  'executor',
  'tester',
  'reviewer',
];

const DEFAULT_SELECTION: WorkbenchSelection = {
  tab: 'tasks',
  layerId: 'all',
  roleId: 'all',
  todoId: null,
  todoFilter: 'all',
  msgFilter: 'all',
};

const LAYER_STATE_LABEL: Record<WorkbenchLayer['state'], string> = {
  idle: '待命',
  pending: '排队',
  running: '运行中',
  completed: '完成',
  failed: '失败',
};

const ROLE_STATUS_LABEL: Record<WorkbenchRole['status'], string> = {
  idle: '待命',
  run: '运行中',
  fail: '失败',
  done: '完成',
};

export function listCanonicalLayers(): TeamRoleLayer[] {
  return [...CANONICAL_LAYER_IDS];
}

function isTeamRoleLayer(value: string | null | undefined): value is TeamRoleLayer {
  if (!value) return false;
  return (CANONICAL_LAYER_IDS as readonly string[]).includes(value) || value === 'user';
}

function normalizeLayerId(value: string | null | undefined): TeamRoleLayer {
  if (isTeamRoleLayer(value) && value !== 'user') return value;
  return 'executor';
}

function mapTaskStatus(status: string | null | undefined): WorkbenchTodoStatus {
  const s = (status ?? '').toLowerCase();
  if (s === 'running' || s === 'in_progress' || s === 'claimed') return 'running';
  if (s === 'completed' || s === 'done' || s === 'success') return 'done';
  if (s === 'failed' || s === 'error') return 'failed';
  if (s === 'blocked' || s === 'waiting') return 'blocked';
  if (s === 'cancelled' || s === 'canceled') return 'done';
  return 'pending';
}

function mapHandoffStatus(state: string | null | undefined, paused?: boolean): WorkbenchTodoStatus {
  if (paused) return 'blocked';
  return mapTaskStatus(state);
}

function mapPriority(priority: string | number | null | undefined): 'P0' | 'P1' | 'P2' | undefined {
  if (priority == null || priority === '') return undefined;
  const raw = String(priority).toLowerCase();
  if (raw === 'p0' || raw === 'high' || raw === 'critical' || raw === '0') return 'P0';
  if (raw === 'p1' || raw === 'medium' || raw === '1') return 'P1';
  if (raw === 'p2' || raw === 'low' || raw === '2') return 'P2';
  return 'P2';
}

function shortKey(id: string, index: number): string {
  const cleaned = id.replace(/[^a-zA-Z0-9]/g, '');
  if (cleaned.length >= 2) {
    const tail = cleaned.slice(-4);
    return `#${tail}`;
  }
  return `#${String(index + 1).padStart(2, '0')}`;
}

function formatElapsed(startedAt?: number, endedAt?: number): string | undefined {
  if (!startedAt || !Number.isFinite(startedAt)) return undefined;
  const end = endedAt && Number.isFinite(endedAt) ? endedAt : Date.now();
  const sec = Math.max(0, Math.floor((end - startedAt) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function layerStateFromHandoffs(
  layerId: TeamRoleLayer,
  handoffs: NonNullable<BuildWorkbenchModelInput['handoffs']>,
  layerHint?: { state?: string | null; live?: boolean },
): { state: WorkbenchLayer['state']; live: boolean } {
  const related = handoffs.filter((h) => h.toRoleLayer === layerId || h.fromRoleLayer === layerId);
  const hasFailed = related.some((h) => h.state === 'failed');
  const hasRunning = related.some((h) => h.state === 'running' || h.state === 'claimed');
  const hasPending = related.some((h) => h.state === 'pending');
  const allTerminal =
    related.length > 0 &&
    related.every(
      (h) => h.state === 'completed' || h.state === 'cancelled' || h.state === 'failed',
    );
  const allCompleted =
    related.length > 0 && related.every((h) => h.state === 'completed' || h.state === 'cancelled');

  let state: WorkbenchLayer['state'] = 'idle';
  if (hasFailed && !hasRunning) state = 'failed';
  else if (hasRunning) state = 'running';
  else if (allCompleted) state = 'completed';
  else if (hasPending || (allTerminal && hasFailed)) state = hasFailed ? 'failed' : 'pending';
  else if (layerHint?.state) {
    const mapped = mapTaskStatus(layerHint.state);
    if (mapped === 'running') state = 'running';
    else if (mapped === 'failed') state = 'failed';
    else if (mapped === 'done') state = 'completed';
    else if (mapped === 'pending' || mapped === 'blocked') state = 'pending';
  }

  const live = Boolean(layerHint?.live) || hasRunning;
  return { state, live };
}

function roleStatusFromTodos(
  layerId: TeamRoleLayer,
  roleId: string,
  todos: WorkbenchTodo[],
): WorkbenchRole['status'] {
  const related = todos.filter(
    (t) => t.layer === layerId && (t.roleId == null || t.roleId === roleId || roleId === layerId),
  );
  if (related.some((t) => t.status === 'failed')) return 'fail';
  if (related.some((t) => t.status === 'running')) return 'run';
  if (related.length > 0 && related.every((t) => t.status === 'done')) return 'done';
  return 'idle';
}

export function buildWorkbenchTodos(input: BuildWorkbenchModelInput): WorkbenchTodo[] {
  const todos: WorkbenchTodo[] = [];
  const seen = new Set<string>();
  const runtimeTasks = input.runtimeTasks ?? [];
  const handoffs = input.handoffs ?? [];
  const sessionTodos = input.sessionTodos ?? [];

  // 1) runtime tasks（保留原始 status / roleLayer）
  runtimeTasks.forEach((task, index) => {
    if ((task.status ?? '').toLowerCase() === 'cancelled') return;
    const explicitLayer = isTeamRoleLayer(task.roleLayer as string)
      ? (task.roleLayer as TeamRoleLayer)
      : null;
    const agentLayer =
      task.assignedAgent && isTeamRoleLayer(task.assignedAgent)
        ? (task.assignedAgent as TeamRoleLayer)
        : null;
    const layer = explicitLayer ?? agentLayer ?? 'executor';
    todos.push({
      id: task.id,
      key: shortKey(task.id, index),
      title: task.title || '未命名任务',
      sub: task.errorMessage ?? task.result ?? undefined,
      layer,
      roleId: task.assignedAgent ?? undefined,
      status: mapTaskStatus(task.status),
      priority: mapPriority(task.priority),
      owner: task.assignedAgent ?? undefined,
      source: 'runtime-task',
    });
    seen.add(task.id);
  });

  // 2) handoffs：无 runtime 时作主列表；有 runtime 时补失败/阻塞上下文（去重）
  handoffs.forEach((handoff, index) => {
    if (seen.has(handoff.id)) return;
    // 已有 runtime 任务时，仅补充 failed/blocked/pending 的 handoff，避免刷屏
    if (runtimeTasks.length > 0) {
      const status = mapHandoffStatus(handoff.state, handoff.paused);
      if (status !== 'failed' && status !== 'blocked' && status !== 'pending') return;
    }
    const title =
      handoff.summary?.trim() ||
      `${getRoleLayerIdentity(handoff.fromRoleLayer).short} → ${getRoleLayerIdentity(handoff.toRoleLayer).short}`;
    todos.push({
      id: handoff.id,
      key: shortKey(handoff.id, todos.length + index),
      title,
      sub: handoff.failureReason ?? undefined,
      layer: handoff.toRoleLayer,
      roleId: handoff.toRoleLayer,
      status: mapHandoffStatus(handoff.state, handoff.paused),
      priority: handoff.state === 'failed' ? 'P0' : 'P1',
      owner: handoff.toRoleLayer,
      elapsedLabel: formatElapsed(handoff.startedAt, handoff.endedAt),
      source: 'handoff',
    });
    seen.add(handoff.id);
  });

  // 3) session todos 补充
  sessionTodos.forEach((todo, index) => {
    if (seen.has(todo.id)) return;
    todos.push({
      id: todo.id,
      key: shortKey(todo.id, todos.length + index),
      title: todo.content?.trim() || todo.activeForm?.trim() || '会话待办',
      layer: 'executor',
      status: mapTaskStatus(todo.status),
      source: 'session-todo',
    });
    seen.add(todo.id);
  });

  return todos;
}

export function buildWorkbenchLayers(input: BuildWorkbenchModelInput): WorkbenchLayer[] {
  const handoffs = input.handoffs ?? [];
  const todos = buildWorkbenchTodos(input);
  const inputLayers = new Map((input.layers ?? []).map((layer) => [layer.id, layer]));

  // 若输入层包含非 canonical id，仍追加到末尾
  const ids: TeamRoleLayer[] = [...CANONICAL_LAYER_IDS];
  for (const layer of input.layers ?? []) {
    if (!ids.includes(layer.id) && layer.id !== 'user') {
      ids.push(layer.id);
    }
  }

  return ids.map((layerId) => {
    const identity = getRoleLayerIdentity(layerId);
    const hint = inputLayers.get(layerId);
    const { state, live } = layerStateFromHandoffs(layerId, handoffs, hint);
    const roleId = layerId;
    const roleName = hint?.displayName?.trim() || identity.short;
    const status = roleStatusFromTodos(layerId, roleId, todos);
    const taskCount = todos.filter((t) => t.layer === layerId).length;
    const role: WorkbenchRole = {
      id: roleId,
      name: roleName,
      status,
      statusLabel: ROLE_STATUS_LABEL[status],
      taskCount,
      layerId,
    };

    return {
      id: layerId,
      code: identity.code ?? layerId.slice(0, 1),
      name: identity.short,
      color: identity.color,
      state,
      stateLabel: LAYER_STATE_LABEL[state],
      live,
      roles: [role],
    };
  });
}

export function filterWorkbenchTodos(
  todos: readonly WorkbenchTodo[],
  filter: WorkbenchTodoFilter,
  layerId: TeamRoleLayer | 'all' = 'all',
  roleId: string | 'all' = 'all',
): WorkbenchTodo[] {
  return todos.filter((todo) => {
    if (layerId !== 'all' && todo.layer !== layerId) return false;
    if (roleId !== 'all' && todo.roleId && todo.roleId !== roleId && todo.roleId !== layerId) {
      // allow roleId === layer default role
      if (todo.roleId !== roleId) return false;
    }
    if (roleId !== 'all' && !todo.roleId && roleId !== layerId && roleId !== todo.layer) {
      return false;
    }
    switch (filter) {
      case 'active':
        return todo.status === 'running' || todo.status === 'pending';
      case 'blocked':
        return todo.status === 'blocked' || todo.status === 'failed';
      case 'done':
        return todo.status === 'done';
      case 'all':
      default:
        return true;
    }
  });
}

export function preferredTodoForLayer(
  todos: readonly WorkbenchTodo[],
  layerId: TeamRoleLayer | 'all',
  roleId: string | 'all' = 'all',
): WorkbenchTodo | null {
  const scoped = todos.filter((todo) => {
    if (layerId !== 'all' && todo.layer !== layerId) return false;
    if (roleId !== 'all' && todo.roleId && todo.roleId !== roleId) return false;
    return true;
  });
  if (scoped.length === 0) return null;
  return (
    scoped.find((t) => t.status === 'failed') ||
    scoped.find((t) => t.status === 'blocked') ||
    scoped.find((t) => t.status === 'running') ||
    scoped.find((t) => t.status === 'pending') ||
    scoped[0] ||
    null
  );
}

export function selectLayer(
  selection: WorkbenchSelection,
  layerId: TeamRoleLayer | 'all',
  roleId: string | 'all',
  todos: readonly WorkbenchTodo[],
): WorkbenchSelection {
  const preferred = preferredTodoForLayer(todos, layerId, roleId);
  return {
    ...selection,
    tab: 'tasks',
    layerId,
    roleId,
    todoId: preferred?.id ?? null,
  };
}

export function selectTodo(
  selection: WorkbenchSelection,
  todoId: string,
  todos: readonly WorkbenchTodo[],
): WorkbenchSelection {
  const todo = todos.find((item) => item.id === todoId);
  if (!todo) {
    return { ...selection, todoId };
  }
  return {
    ...selection,
    tab: 'tasks',
    layerId: todo.layer,
    roleId: todo.roleId ?? todo.layer,
    todoId: todo.id,
  };
}

export function countWorkbenchBadges(
  todos: readonly WorkbenchTodo[],
  handoffs?: BuildWorkbenchModelInput['handoffs'],
): WorkbenchBadgeCounts {
  const failTasks = todos.filter((t) => t.status === 'failed' || t.status === 'blocked').length;
  const runningTasks = todos.filter((t) => t.status === 'running').length;
  const doneTasks = todos.filter((t) => t.status === 'done').length;
  const pendingHandoffs = (handoffs ?? []).filter(
    (h) => h.state === 'pending' || h.state === 'failed',
  ).length;
  return {
    tasks: todos.length,
    failTasks,
    runningTasks,
    doneTasks,
    govPending: pendingHandoffs,
  };
}

function normalizeSelection(
  partial: Partial<WorkbenchSelection> | undefined,
  todos: readonly WorkbenchTodo[],
): WorkbenchSelection {
  const base: WorkbenchSelection = {
    ...DEFAULT_SELECTION,
    ...partial,
    tab: partial?.tab ?? DEFAULT_SELECTION.tab,
    layerId: partial?.layerId ?? DEFAULT_SELECTION.layerId,
    roleId: partial?.roleId ?? DEFAULT_SELECTION.roleId,
    todoId: partial?.todoId ?? DEFAULT_SELECTION.todoId,
    todoFilter: partial?.todoFilter ?? DEFAULT_SELECTION.todoFilter,
    msgFilter: partial?.msgFilter ?? DEFAULT_SELECTION.msgFilter,
  };

  if (base.todoId && todos.some((t) => t.id === base.todoId)) {
    return base;
  }

  const preferred = preferredTodoForLayer(todos, base.layerId, base.roleId);
  return {
    ...base,
    todoId: preferred?.id ?? null,
  };
}

export function buildTeamLayerTodoWorkbenchModel(
  input: BuildWorkbenchModelInput,
): TeamLayerTodoWorkbenchModel {
  const layers = buildWorkbenchLayers(input);
  const todos = buildWorkbenchTodos(input);
  const selection = normalizeSelection(input.selection, todos);
  const filteredTodos = filterWorkbenchTodos(
    todos,
    selection.todoFilter,
    selection.layerId,
    selection.roleId,
  );
  const activeTodo = selection.todoId
    ? (todos.find((t) => t.id === selection.todoId) ?? null)
    : null;
  const counts = countWorkbenchBadges(todos, input.handoffs);

  return {
    layers,
    todos,
    filteredTodos,
    selection,
    activeTodo,
    counts,
  };
}
