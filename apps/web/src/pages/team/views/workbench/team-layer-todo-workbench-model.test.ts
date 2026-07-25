import { describe, expect, it } from 'vitest';
import type { TeamRoleLayer } from '../../../../stores/team/team-events.js';
import {
  buildTeamLayerTodoWorkbenchModel,
  buildWorkbenchLayers,
  buildWorkbenchTodos,
  filterWorkbenchTodos,
  listCanonicalLayers,
  preferredTodoForLayer,
  selectLayer,
  selectTodo,
  type WorkbenchSelection,
  type WorkbenchTodo,
} from './team-layer-todo-workbench-model.js';

const baseSelection: WorkbenchSelection = {
  tab: 'tasks',
  layerId: 'all',
  roleId: 'all',
  todoId: null,
  todoFilter: 'all',
  msgFilter: 'all',
};

describe('listCanonicalLayers', () => {
  it('returns fixed layer order including tester', () => {
    expect(listCanonicalLayers()).toEqual([
      'reception',
      'pm1',
      'pm2',
      'executor',
      'tester',
      'reviewer',
    ]);
  });
});

describe('buildWorkbenchLayers', () => {
  it('empty input still yields canonical layers with identity fields', () => {
    const layers = buildWorkbenchLayers({});
    expect(layers.map((l) => l.id)).toEqual(listCanonicalLayers());
    const executor = layers.find((l) => l.id === 'executor');
    expect(executor?.code).toBe('e');
    expect(executor?.name).toBe('执行');
    expect(executor?.color).toMatch(/var\(--/);
    expect(executor?.roles.length).toBe(1);
  });

  it('marks layer failed/running from handoffs', () => {
    const layers = buildWorkbenchLayers({
      handoffs: [
        {
          id: 'h1',
          state: 'failed',
          fromRoleLayer: 'pm2',
          toRoleLayer: 'executor',
          summary: 'callback failed',
        },
        {
          id: 'h2',
          state: 'running',
          fromRoleLayer: 'pm2',
          toRoleLayer: 'tester',
        },
      ],
    });
    expect(layers.find((l) => l.id === 'executor')?.state).toBe('failed');
    expect(layers.find((l) => l.id === 'tester')?.state).toBe('running');
    expect(layers.find((l) => l.id === 'tester')?.live).toBe(true);
  });
});

describe('buildWorkbenchTodos', () => {
  it('maps runtime task statuses and priorities', () => {
    const todos = buildWorkbenchTodos({
      runtimeTasks: [
        {
          id: 'task-running',
          title: 'session 落库',
          status: 'in_progress',
          priority: 'high',
          roleLayer: 'executor',
          assignedAgent: 'e2',
        },
        {
          id: 'task-failed',
          title: 'callback 校验',
          status: 'failed',
          priority: 'P0',
          roleLayer: 'executor',
          errorMessage: 'timeout',
        },
        {
          id: 'task-done',
          title: 'plan',
          status: 'completed',
          priority: 'low',
          roleLayer: 'pm1',
        },
        {
          id: 'task-cancelled',
          title: 'skip',
          status: 'cancelled',
          roleLayer: 'pm2',
        },
      ],
    });

    expect(todos.map((t) => t.id)).toEqual(['task-running', 'task-failed', 'task-done']);
    expect(todos.find((t) => t.id === 'task-running')?.status).toBe('running');
    expect(todos.find((t) => t.id === 'task-running')?.priority).toBe('P0');
    expect(todos.find((t) => t.id === 'task-failed')?.status).toBe('failed');
    expect(todos.find((t) => t.id === 'task-failed')?.sub).toBe('timeout');
    expect(todos.find((t) => t.id === 'task-done')?.status).toBe('done');
    expect(todos.find((t) => t.id === 'task-done')?.priority).toBe('P2');
    expect(todos.every((t) => t.source === 'runtime-task')).toBe(true);
  });

  it('falls back to handoff todos when runtime tasks empty', () => {
    const todos = buildWorkbenchTodos({
      handoffs: [
        {
          id: 'handoff-1',
          state: 'failed',
          fromRoleLayer: 'pm2',
          toRoleLayer: 'executor',
          summary: 'callback 校验',
          failureReason: 'token timeout',
          paused: false,
        },
        {
          id: 'handoff-2',
          state: 'pending',
          fromRoleLayer: 'executor',
          toRoleLayer: 'tester',
          paused: true,
        },
      ],
    });

    expect(todos).toHaveLength(2);
    expect(todos[0]?.source).toBe('handoff');
    expect(todos[0]?.title).toBe('callback 校验');
    expect(todos[0]?.status).toBe('failed');
    expect(todos[0]?.layer).toBe('executor');
    expect(todos[1]?.status).toBe('blocked');
  });

  it('merges failed/pending handoffs when runtime tasks exist', () => {
    const todos = buildWorkbenchTodos({
      runtimeTasks: [
        {
          id: 'task-1',
          title: 'session 落库',
          status: 'running',
          roleLayer: 'executor',
        },
      ],
      handoffs: [
        {
          id: 'handoff-fail',
          state: 'failed',
          fromRoleLayer: 'pm2',
          toRoleLayer: 'executor',
          summary: 'callback 失败',
          failureReason: 'timeout',
        },
        {
          id: 'handoff-running',
          state: 'running',
          fromRoleLayer: 'pm2',
          toRoleLayer: 'tester',
          summary: '测试中',
        },
        {
          id: 'handoff-pending',
          state: 'pending',
          fromRoleLayer: 'executor',
          toRoleLayer: 'reviewer',
          summary: '待评审',
        },
      ],
    });

    // runtime + failed/pending handoff；running handoff 不补入
    expect(todos.map((t) => t.id)).toEqual(['task-1', 'handoff-fail', 'handoff-pending']);
    expect(todos.find((t) => t.id === 'handoff-fail')?.status).toBe('failed');
    expect(todos.find((t) => t.id === 'handoff-pending')?.status).toBe('pending');
  });
});

describe('filterWorkbenchTodos', () => {
  const todos: WorkbenchTodo[] = [
    {
      id: '1',
      key: '#1',
      title: 'a',
      layer: 'executor',
      roleId: 'e1',
      status: 'running',
      source: 'runtime-task',
    },
    {
      id: '2',
      key: '#2',
      title: 'b',
      layer: 'executor',
      roleId: 'e1',
      status: 'failed',
      source: 'runtime-task',
    },
    {
      id: '3',
      key: '#3',
      title: 'c',
      layer: 'tester',
      roleId: 't1',
      status: 'done',
      source: 'runtime-task',
    },
    {
      id: '4',
      key: '#4',
      title: 'd',
      layer: 'pm1',
      status: 'pending',
      source: 'runtime-task',
    },
  ];

  it('filters active / blocked / done', () => {
    expect(filterWorkbenchTodos(todos, 'active').map((t) => t.id)).toEqual(['1', '4']);
    expect(filterWorkbenchTodos(todos, 'blocked').map((t) => t.id)).toEqual(['2']);
    expect(filterWorkbenchTodos(todos, 'done').map((t) => t.id)).toEqual(['3']);
  });

  it('filters by layer and role', () => {
    expect(filterWorkbenchTodos(todos, 'all', 'executor').map((t) => t.id)).toEqual(['1', '2']);
    expect(filterWorkbenchTodos(todos, 'all', 'executor', 'e1').map((t) => t.id)).toEqual([
      '1',
      '2',
    ]);
  });
});

describe('preferredTodoForLayer', () => {
  it('prefers failed over running', () => {
    const todos: WorkbenchTodo[] = [
      {
        id: 'run',
        key: '#r',
        title: 'running',
        layer: 'executor',
        status: 'running',
        source: 'runtime-task',
      },
      {
        id: 'fail',
        key: '#f',
        title: 'failed',
        layer: 'executor',
        status: 'failed',
        source: 'runtime-task',
      },
    ];
    expect(preferredTodoForLayer(todos, 'executor')?.id).toBe('fail');
  });
});

describe('selection reducers', () => {
  const todos: WorkbenchTodo[] = [
    {
      id: 't-exec-fail',
      key: '#12',
      title: 'callback',
      layer: 'executor',
      roleId: 'e1',
      status: 'failed',
      source: 'runtime-task',
    },
    {
      id: 't-test',
      key: '#14',
      title: 'login test',
      layer: 'tester',
      roleId: 't1',
      status: 'pending',
      source: 'runtime-task',
    },
  ];

  it('selectLayer switches tab and prefers failed todo', () => {
    const next = selectLayer(baseSelection, 'executor', 'all', todos);
    expect(next.tab).toBe('tasks');
    expect(next.layerId).toBe('executor');
    expect(next.todoId).toBe('t-exec-fail');
  });

  it('selectTodo writes back layer and role', () => {
    const next = selectTodo(baseSelection, 't-test', todos);
    expect(next.layerId).toBe('tester');
    expect(next.roleId).toBe('t1');
    expect(next.todoId).toBe('t-test');
    expect(next.tab).toBe('tasks');
  });
});

describe('buildTeamLayerTodoWorkbenchModel', () => {
  it('normalizes invalid todoId to preferred', () => {
    const model = buildTeamLayerTodoWorkbenchModel({
      runtimeTasks: [
        {
          id: 'alive',
          title: 'work',
          status: 'running',
          roleLayer: 'executor' as TeamRoleLayer,
        },
      ],
      selection: {
        ...baseSelection,
        todoId: 'missing',
        layerId: 'executor',
      },
    });
    expect(model.selection.todoId).toBe('alive');
    expect(model.activeTodo?.id).toBe('alive');
    expect(model.counts.runningTasks).toBe(1);
    expect(model.filteredTodos).toHaveLength(1);
  });
});
