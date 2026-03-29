import { z } from 'zod';
import { db, sqliteAll, sqliteRun } from './db.js';

const todoStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);
const todoPrioritySchema = z.enum(['high', 'medium', 'low']);

const TODO_WRITE_DESCRIPTION = `Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multistep tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos. Feel free to edit the todo list based on new information.
6. After completing a task - Mark it complete and add any new follow-up tasks
7. When you start working on a new task, mark the todo as in_progress. Ideally you should only have one todo as in_progress at a time. Complete existing tasks before starting new ones.

## When NOT to Use This Tool

Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task States and Management

1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully
   - cancelled: Task no longer needed

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Only have ONE task in_progress at any time
   - Complete current tasks before starting new ones
   - Cancel tasks that become irrelevant

3. **Task Breakdown**:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names

When in doubt, use this tool. Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.`;

const TODO_READ_DESCRIPTION = `Use this tool to read the current to-do list for the session. This tool should be used proactively and frequently to ensure that you are aware of
the status of the current task list. You should make use of this tool as often as possible, especially in the following situations:
- At the beginning of conversations to see what's pending
- Before starting new tasks to prioritize work
- When the user asks about previous tasks or plans
- Whenever you're uncertain about what to do next
- After completing tasks to update your understanding of remaining work
- After every few messages to ensure you're on track

Usage:
- This tool takes in no parameters. So leave the input blank or empty. DO NOT include a dummy object, placeholder string or a key like "input" or "empty". LEAVE IT BLANK.
- Returns a list of todo items with their status, priority, and content
- Use this information to track progress and plan next steps
- If no todos exist yet, an empty list will be returned`;

const SUBTODO_WRITE_DESCRIPTION = `Use this tool to create and manage the temporary todo lane for the current coding session. Use it for side thoughts, parking-lot items, or temporary ideas that should not replace the main todo list.`;

const SUBTODO_READ_DESCRIPTION = `Use this tool to read the temporary todo lane for the current coding session. Use it when you need to inspect parking-lot items without touching the main todo list.`;

const sessionTodoSchema = z
  .object({
    content: z.string().describe('Brief description of the task'),
    status: todoStatusSchema.describe(
      'Current status of the task: pending, in_progress, completed, cancelled',
    ),
    priority: todoPrioritySchema.describe('Priority level of the task: high, medium, low'),
  })
  .strict();

export const todoWriteInputSchema = z
  .object({
    todos: z.array(sessionTodoSchema).describe('The updated todo list'),
  })
  .strict();

export const todoReadInputSchema = z.object({}).strict();

export const todoWriteOutputSchema = z.object({
  title: z.string(),
  output: z.string(),
  metadata: z
    .object({
      todos: z.array(sessionTodoSchema),
    })
    .strict(),
});

export const todoWriteTool = {
  name: 'todowrite',
  description: TODO_WRITE_DESCRIPTION,
} as const;

export const todoReadTool = {
  name: 'todoread',
  description: TODO_READ_DESCRIPTION,
} as const;

export const subTodoWriteInputSchema = todoWriteInputSchema;
export const subTodoReadInputSchema = todoReadInputSchema;

export const subTodoWriteTool = {
  name: 'subtodowrite',
  description: SUBTODO_WRITE_DESCRIPTION,
} as const;

export const subTodoReadTool = {
  name: 'subtodoread',
  description: SUBTODO_READ_DESCRIPTION,
} as const;

export type SessionTodo = z.infer<typeof sessionTodoSchema>;
export type TodoLane = 'main' | 'temp';
export type TodoReadInput = z.infer<typeof todoReadInputSchema>;
export type TodoWriteInput = z.infer<typeof todoWriteInputSchema>;
export type TodoWriteOutput = z.infer<typeof todoWriteOutputSchema>;

export interface SessionTodoLanes {
  main: SessionTodo[];
  temp: SessionTodo[];
}

interface SessionTodoRow {
  lane: TodoLane;
  content: string;
  status: SessionTodo['status'];
  priority: SessionTodo['priority'];
}

export function replaceSessionTodos(
  sessionId: string,
  todos: SessionTodo[],
  lane: TodoLane = 'main',
): void {
  db.exec('BEGIN');
  try {
    sqliteRun('DELETE FROM session_todos WHERE session_id = ? AND lane = ?', [sessionId, lane]);
    todos.forEach((todo, position) => {
      sqliteRun(
        `INSERT INTO session_todos (session_id, lane, content, status, priority, position)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sessionId, lane, todo.content, todo.status, todo.priority, position],
      );
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function formatTodoWriteValidationError(rawInput: unknown): string {
  return formatValidationError(todoWriteInputSchema, todoWriteTool.name, rawInput);
}

export function formatTodoReadValidationError(rawInput: unknown): string {
  return formatValidationError(todoReadInputSchema, todoReadTool.name, rawInput);
}

export function formatSubTodoWriteValidationError(rawInput: unknown): string {
  return formatValidationError(subTodoWriteInputSchema, subTodoWriteTool.name, rawInput);
}

export function formatSubTodoReadValidationError(rawInput: unknown): string {
  return formatValidationError(subTodoReadInputSchema, subTodoReadTool.name, rawInput);
}

export function listSessionTodos(sessionId: string, lane: TodoLane = 'main'): SessionTodo[] {
  return sqliteAll<SessionTodoRow>(
    `SELECT lane, content, status, priority
      FROM session_todos
      WHERE session_id = ? AND lane = ?
      ORDER BY position ASC`,
    [sessionId, lane],
  ).map((row) =>
    sessionTodoSchema.parse({
      content: row.content,
      status: row.status,
      priority: row.priority,
    }),
  );
}

export function listSessionTodoLanes(sessionId: string): SessionTodoLanes {
  return {
    main: listSessionTodos(sessionId, 'main'),
    temp: listSessionTodos(sessionId, 'temp'),
  };
}

export function runTodoWriteTool(sessionId: string, input: TodoWriteInput): TodoWriteOutput {
  replaceSessionTodos(sessionId, input.todos);
  return buildTodoOutput(input.todos, 'todos');
}

export function runTodoReadTool(sessionId: string): TodoWriteOutput {
  const todos = listSessionTodos(sessionId);
  return buildTodoOutput(todos, 'todos');
}

export function runSubTodoWriteTool(sessionId: string, input: TodoWriteInput): TodoWriteOutput {
  replaceSessionTodos(sessionId, input.todos, 'temp');
  return buildTodoOutput(input.todos, 'temp todos');
}

export function runSubTodoReadTool(sessionId: string): TodoWriteOutput {
  const todos = listSessionTodos(sessionId, 'temp');
  return buildTodoOutput(todos, 'temp todos');
}

function formatValidationError(
  schema: typeof todoWriteInputSchema | typeof todoReadInputSchema,
  toolName: string,
  rawInput: unknown,
): string {
  const parsed = schema.safeParse(rawInput);
  if (parsed.success) {
    return '';
  }

  return `Validation failed for tool "${toolName}": ${parsed.error.issues
    .map((issue) => issue.message)
    .join(', ')}`;
}

function buildTodoOutput(todos: SessionTodo[], label: string): TodoWriteOutput {
  return todoWriteOutputSchema.parse({
    title: `${todos.filter((todo) => todo.status !== 'completed').length} ${label}`,
    output: JSON.stringify(todos, null, 2),
    metadata: {
      todos,
    },
  });
}
