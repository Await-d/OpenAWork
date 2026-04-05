import { z } from 'zod';
import { db, sqliteAll, sqliteRun } from './db.js';

const todoStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);
const todoPrioritySchema = z.enum(['high', 'medium', 'low']);

const TODO_WRITE_DESCRIPTION = `Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos. Feel free to edit the todo list based on new information
6. When you start working on a task - Mark exactly one relevant todo as in_progress BEFORE beginning work whenever active work remains
7. After completing a task - Mark it as completed immediately and add any new follow-up tasks discovered during implementation

## Language Requirements

- Write every todo item's content in the same language as the user's latest request or the established conversation language.
- If the user is speaking Chinese, write todos in Chinese. If the user is speaking English, write todos in English.
- Do NOT translate user-facing todo items into English unless the user is already using English or explicitly requests English.
- Keep the wording natural for that language while still being concise and actionable.

## When NOT to Use This Tool

Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Examples of When to Use the Todo List

<example>
User: I want to add a dark mode toggle to the application settings. Make sure you run the tests and build when you're done!
Assistant: *Creates todo list with the following items:*
1. Create dark mode toggle component in Settings page
2. Add dark mode state management
3. Update styles to support theme switching
4. Run tests and build, addressing any failures
5. Mark one task as in_progress and begin implementation

<reasoning>
The assistant used the todo list because:
1. Adding dark mode is a multi-step feature requiring UI, state management, and validation work
2. The user explicitly requested tests and build be run afterward
3. The todo list helps track implementation progress and follow-up validation
</reasoning>
</example>

<example>
User: Help me rename the function getCwd to getCurrentWorkingDirectory across my project
Assistant: *Searches the codebase to understand the scope of the rename*
Assistant: *Creates todo list with the affected files and keeps one rename task in_progress while applying the change*

<reasoning>
The assistant used the todo list because:
1. The rename affects multiple files and requires coordinated edits
2. Tracking each file reduces the chance of missing a reference
3. The todo list provides clear progress updates while the rename is underway
</reasoning>
</example>

## Examples of When NOT to Use the Todo List

<example>
User: How do I print 'Hello World' in Python?
Assistant: In Python, you can print "Hello World" with this simple code:

python
print("Hello World")

<reasoning>
The assistant did not use the todo list because this is a single, trivial request that can be answered directly.
</reasoning>
</example>

<example>
User: Run npm install for me and tell me what happens.
Assistant: *Executes npm install and reports the result directly*

<reasoning>
The assistant did not use the todo list because this is a single command execution with immediate results.
</reasoning>
</example>

## Task States and Management

1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on
   - completed: Task finished successfully
   - cancelled: Task no longer needed

2. **Task Management**:
   - Update task status in real time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - While active work remains, keep exactly ONE task in_progress at a time
   - Complete the current task before starting a different one
   - Cancel tasks that become irrelevant instead of leaving stale entries behind

3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter blockers, unresolved errors, or partial implementation, keep the task as in_progress or add a follow-up todo
   - Never mark a task as completed if tests are still failing, the implementation is partial, or critical follow-up work remains

4. **Task Breakdown**:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names

5. **Input Requirements**:
   - Every todo item in this tool must include content, status, and priority
   - Keep content concise, actionable, and written as the task to be done
   - Write content in the user's current language rather than defaulting to English

When in doubt, use this tool. Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.`;

const TODO_READ_DESCRIPTION = `Use this tool to read the current main todo list for the session. Use it proactively whenever you need to understand the current plan before acting.

Use this tool in these situations:
- At the beginning of a session or when resuming work to see the latest main todos
- Before starting a new task so you can verify what is pending or already in progress
- When the user asks about current progress, previous plans, or remaining work
- After completing or updating work to confirm what main-lane tasks are still relevant
- Whenever you are uncertain about what to do next and need to ground yourself in the current tracked work

Usage:
- This tool takes no parameters. Leave the input blank or empty.
- DO NOT include a dummy object, placeholder string, or keys like "input" or "empty".
- Returns the current main-lane todo items with their status, priority, and content.
- Use subtodoread if you need to inspect the temporary lane instead of the main todo list.
- If no main-lane todos exist yet, an empty list will be returned.`;

const SUBTODO_WRITE_DESCRIPTION = `Use this tool to create and manage the temporary todo lane for the current coding session. Use it for side thoughts, parking-lot items, follow-ups, or temporary ideas that should not replace the main todo list.

Use this tool when:
- You discover useful but non-blocking follow-up work during implementation
- You want to park an idea, question, or investigation thread without interrupting the main plan
- You need to track temporary notes that may later be promoted into the main todo list

Guidelines:
- The temporary lane supplements the main todo list; it should not replace it.
- Keep temporary todo items concise, actionable, and relevant to the current session.
- Write temporary todo items in the same language as the user's latest request or established conversation language.
- Every todo item in this tool must include content, status, and priority.
- If a temporary item becomes committed execution work, add it to the main todo list with todowrite.`;

const SUBTODO_READ_DESCRIPTION = `Use this tool to read the temporary todo lane for the current coding session.

Use this tool when:
- You want to review parked ideas, side investigations, or follow-up items without touching the main todo list
- You need to decide whether a temporary item should stay parked, be updated, or be promoted into the main lane
- You want to inspect temporary notes before continuing work

Usage:
- This tool takes no parameters. Leave the input blank or empty.
- DO NOT include a dummy object, placeholder string, or keys like "input" or "empty".
- Returns the current temporary-lane todo items only.
- Use todoread if you need the main todo list instead of the temporary lane.
- If no temporary todos exist yet, an empty list will be returned.`;

const sessionTodoSchema = z
  .object({
    content: z
      .string()
      .describe("Brief imperative description of the task written in the user's current language"),
    status: todoStatusSchema.describe(
      'Current status of the task: pending, in_progress, completed, cancelled',
    ),
    priority: todoPrioritySchema.describe('Priority level of the task: high, medium, low'),
  })
  .strict();

export const todoWriteInputSchema = z
  .object({
    todos: z.array(sessionTodoSchema).describe('The updated todo list for the current session'),
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

const CJK_CONTENT_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

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
  return buildTodoOutput(input.todos, 'main');
}

export function runTodoReadTool(sessionId: string): TodoWriteOutput {
  const todos = listSessionTodos(sessionId);
  return buildTodoOutput(todos, 'main');
}

export function runSubTodoWriteTool(sessionId: string, input: TodoWriteInput): TodoWriteOutput {
  replaceSessionTodos(sessionId, input.todos, 'temp');
  return buildTodoOutput(input.todos, 'temp');
}

export function runSubTodoReadTool(sessionId: string): TodoWriteOutput {
  const todos = listSessionTodos(sessionId, 'temp');
  return buildTodoOutput(todos, 'temp');
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

function buildTodoOutput(todos: SessionTodo[], lane: TodoLane): TodoWriteOutput {
  const activeCount = todos.filter(
    (todo) => todo.status !== 'completed' && todo.status !== 'cancelled',
  ).length;
  const language = inferTodoTitleLanguage(todos);
  const noun =
    language === 'cjk'
      ? lane === 'main'
        ? '主待办'
        : '临时待办'
      : lane === 'main'
        ? activeCount === 1
          ? 'main todo'
          : 'main todos'
        : activeCount === 1
          ? 'temporary todo'
          : 'temporary todos';

  return todoWriteOutputSchema.parse({
    title: language === 'cjk' ? `${activeCount} 项${noun}` : `${activeCount} ${noun}`,
    output: JSON.stringify(todos, null, 2),
    metadata: {
      todos,
    },
  });
}

function inferTodoTitleLanguage(todos: SessionTodo[]): 'cjk' | 'latin' {
  const sample = todos.find((todo) => todo.content.trim().length > 0)?.content ?? '';
  return CJK_CONTENT_PATTERN.test(sample) ? 'cjk' : 'latin';
}
