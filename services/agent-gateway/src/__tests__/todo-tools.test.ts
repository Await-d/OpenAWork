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

  it('keeps the strengthened todo prompt aligned with the current runtime contract', async () => {
    const todoTools = await import('../todo-tools.js');

    expect(todoTools.todoWriteTool.description).toContain(
      '## Examples of When to Use the Todo List',
    );
    expect(todoTools.todoWriteTool.description).toContain(
      'While active work remains, keep exactly ONE task in_progress at a time',
    );
    expect(todoTools.todoWriteTool.description).toContain(
      'Every todo item in this tool must include content, status, and priority',
    );
    expect(todoTools.todoWriteTool.description).toContain(
      "same language as the user's latest request or the established conversation language",
    );
    expect(todoTools.todoWriteTool.description).toContain(
      'Do NOT translate user-facing todo items into English',
    );
    expect(todoTools.subTodoWriteTool.description).toContain(
      "Write temporary todo items in the same language as the user's latest request or established conversation language",
    );
    expect(
      todoTools.todoWriteInputSchema.safeParse({
        todos: [{ content: '更新提示词', status: 'in_progress', priority: 'high' }],
      }).success,
    ).toBe(true);
  });

  it('does not count cancelled todos as remaining work in the title summary', async () => {
    const todoTools = await import('../todo-tools.js');

    const result = todoTools.runTodoWriteTool('session-1', {
      todos: [
        { content: '保留进行中任务', status: 'in_progress', priority: 'high' },
        { content: '已取消任务', status: 'cancelled', priority: 'low' },
        { content: '已完成任务', status: 'completed', priority: 'medium' },
      ],
    });

    expect(result.title).toBe('1 项主待办');
    expect(result.metadata.todos[1]?.status).toBe('cancelled');
  });

  it('uses lane-aware wording in temporary todo titles', async () => {
    const todoTools = await import('../todo-tools.js');

    const result = todoTools.runSubTodoWriteTool('session-1', {
      todos: [{ content: '记录临时事项', status: 'pending', priority: 'low' }],
    });

    expect(result.title).toBe('1 项临时待办');
  });

  it('keeps english todo titles when todo content is english', async () => {
    const todoTools = await import('../todo-tools.js');

    const mainResult = todoTools.runTodoWriteTool('session-1', {
      todos: [
        { content: 'Inspect repository architecture', status: 'in_progress', priority: 'high' },
      ],
    });
    const tempResult = todoTools.runSubTodoWriteTool('session-1', {
      todos: [{ content: 'Record a temporary follow-up', status: 'pending', priority: 'low' }],
    });

    expect(mainResult.title).toBe('1 main todo');
    expect(tempResult.title).toBe('1 temporary todo');
  });

  it('documents lane-specific guidance for todo read and temporary todo tools', async () => {
    const todoTools = await import('../todo-tools.js');

    expect(todoTools.todoReadTool.description).toContain('read the current main todo list');
    expect(todoTools.todoReadTool.description).toContain(
      'Use subtodoread if you need to inspect the temporary lane',
    );
    expect(todoTools.subTodoWriteTool.description).toContain('temporary todo lane');
    expect(todoTools.subTodoWriteTool.description).toContain(
      'Every todo item in this tool must include content, status, and priority',
    );
    expect(todoTools.subTodoReadTool.description).toContain(
      'Returns the current temporary-lane todo items only',
    );
    expect(todoTools.subTodoReadTool.description).toContain(
      'Use todoread if you need the main todo list',
    );
    expect(todoTools.todoReadInputSchema.safeParse({}).success).toBe(true);
    expect(todoTools.subTodoReadInputSchema.safeParse({}).success).toBe(true);
  });

  it('rejects placeholder payloads for read tools', async () => {
    const todoTools = await import('../todo-tools.js');

    expect(todoTools.todoReadInputSchema.safeParse({ input: '' }).success).toBe(false);
    expect(todoTools.subTodoReadInputSchema.safeParse({ empty: true }).success).toBe(false);
  });
});
