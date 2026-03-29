import { beforeEach, describe, expect, it, vi } from 'vitest';

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
type TodoPriority = 'high' | 'medium' | 'low';
type TodoLane = 'main' | 'temp';

interface MockTodoRow {
  session_id: string;
  lane: TodoLane;
  position: number;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}

const state = vi.hoisted(() => ({
  rows: [] as MockTodoRow[],
}));

vi.mock('../db.js', () => ({
  db: {
    exec: (_query: string) => undefined,
  },
  sqliteRun: (query: string, params: Array<string | number>) => {
    if (query.startsWith('DELETE FROM session_todos WHERE session_id = ? AND lane = ?')) {
      const [sessionId, lane] = params;
      state.rows = state.rows.filter((row) => !(row.session_id === sessionId && row.lane === lane));
      return;
    }

    if (query.includes('INSERT INTO session_todos')) {
      const [sessionId, lane, content, status, priority, position] = params;
      state.rows.push({
        session_id: String(sessionId),
        lane: lane as TodoLane,
        content: String(content),
        status: status as TodoStatus,
        priority: priority as TodoPriority,
        position: Number(position),
      });
    }
  },
  sqliteAll: (query: string, params: Array<string>) => {
    const [sessionId, lane] = params;
    if (!query.includes('FROM session_todos')) {
      return [];
    }

    return state.rows
      .filter((row) => row.session_id === sessionId && row.lane === lane)
      .sort((left, right) => left.position - right.position)
      .map(({ content, lane: rowLane, priority, status }) => ({
        content,
        lane: rowLane,
        status,
        priority,
      }));
  },
}));

describe('todo tools lane storage', () => {
  beforeEach(() => {
    state.rows = [];
    vi.resetModules();
  });

  it('stores and reads main and temp todos independently while default reads stay on main', async () => {
    const todoTools = await import('../todo-tools.js');

    todoTools.replaceSessionTodos('session-1', [
      { content: '主任务', status: 'in_progress', priority: 'high' },
    ]);
    todoTools.replaceSessionTodos(
      'session-1',
      [{ content: '临时想法', status: 'pending', priority: 'low' }],
      'temp',
    );

    expect(todoTools.listSessionTodos('session-1')).toEqual([
      { content: '主任务', status: 'in_progress', priority: 'high' },
    ]);
    expect(todoTools.listSessionTodos('session-1', 'temp')).toEqual([
      { content: '临时想法', status: 'pending', priority: 'low' },
    ]);
  });

  it('keeps lane ordering independent when replacing one lane', async () => {
    const todoTools = await import('../todo-tools.js');

    todoTools.replaceSessionTodos('session-1', [
      { content: '主任务 1', status: 'pending', priority: 'high' },
      { content: '主任务 2', status: 'completed', priority: 'medium' },
    ]);
    todoTools.replaceSessionTodos(
      'session-1',
      [{ content: '临时任务 1', status: 'pending', priority: 'low' }],
      'temp',
    );
    todoTools.replaceSessionTodos(
      'session-1',
      [{ content: '临时任务 2', status: 'in_progress', priority: 'medium' }],
      'temp',
    );

    expect(todoTools.listSessionTodos('session-1')).toEqual([
      { content: '主任务 1', status: 'pending', priority: 'high' },
      { content: '主任务 2', status: 'completed', priority: 'medium' },
    ]);
    expect(todoTools.listSessionTodos('session-1', 'temp')).toEqual([
      { content: '临时任务 2', status: 'in_progress', priority: 'medium' },
    ]);
  });

  it('exposes temp-lane specific tool helpers and aggregated lane reads', async () => {
    const todoTools = await import('../todo-tools.js');

    todoTools.runTodoWriteTool('session-1', {
      todos: [{ content: '主待办工具', status: 'pending', priority: 'high' }],
    });
    todoTools.runSubTodoWriteTool('session-1', {
      todos: [{ content: '临时待办工具', status: 'pending', priority: 'low' }],
    });

    expect(todoTools.runTodoReadTool('session-1').metadata.todos).toEqual([
      { content: '主待办工具', status: 'pending', priority: 'high' },
    ]);
    expect(todoTools.runSubTodoReadTool('session-1').metadata.todos).toEqual([
      { content: '临时待办工具', status: 'pending', priority: 'low' },
    ]);
    expect(todoTools.listSessionTodoLanes('session-1')).toEqual({
      main: [{ content: '主待办工具', status: 'pending', priority: 'high' }],
      temp: [{ content: '临时待办工具', status: 'pending', priority: 'low' }],
    });
  });
});
