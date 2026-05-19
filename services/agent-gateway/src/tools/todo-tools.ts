import { z } from 'zod';
import { db, sqliteAll, sqliteRun } from '../infra/db.js';

const todoStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);
const todoPrioritySchema = z.enum(['high', 'medium', 'low']);

const TODO_WRITE_DESCRIPTION = `使用该工具创建和维护当前编码会话的结构化任务清单。它能帮你跟踪进度、组织复杂任务、并向用户展现你的周全考虑。
同时也让用户能看到任务进度与请求的整体推进。

## 何时使用本工具
在以下场景主动使用：

1. 复杂的多步骤任务——任务涉及 3 个及以上独立步骤或动作
2. 需要认真规划或多项操作的任务
3. 用户明确要求使用 todo list
4. 用户一次提供多项任务（编号列表或逗号分隔）
5. 接到新指令后——立刻将用户需求记入 todo。允许根据新信息随时调整该清单
6. 开始推进某项任务时——动手之前先将一项相关 todo 标为 in_progress（仅当仍有未完任务时）
7. 完成某项任务后——立刻标为 completed，并把实现过程中发现的后续工作加入 todo

## 语言要求

- todo 内容**使用与用户最近请求或会话语言一致的语言**。
- 用户说中文则 todo 写中文，用户说英文则写英文。
- 除非用户本就使用英文或明确要求英文，否则不要把面向用户的 todo 翻译为英文。
- 保持该语言下的自然表达，同时简洁、可执行。

## 何时不要使用本工具

以下情况跳过：
1. 只有单一、明确的任务
2. 任务轻微，跟踪不带来价值
3. 任务可以在不到 3 个轻微步骤内完成
4. 纯对话 / 信息性需求

请注意：只有一项轻微任务时不要调本工具，直接动手更高效。

## 使用示例（应当使用）

<example>
用户：帮我在设置页加个深色模式开关，完事后记得跑测试和构建！
助手：*创建 todo 列表：*
1. 在 Settings 页面创建深色模式开关组件
2. 增加深色模式状态管理
3. 更新样式以支持主题切换
4. 跑测试和构建，修复失败项
5. 将一项任务标为 in_progress 并开始实现

<reasoning>
助手使用 todo list 的原因：
1. 加深色模式是多步骤功能，涉及 UI、状态管理与验证
2. 用户明确要求后续跑测试和构建
3. todo list 便于跟踪实现进度与验证
</reasoning>
</example>

<example>
用户：把项目里的 getCwd 函数重命名为 getCurrentWorkingDirectory
助手：*在代码库中检索重命名范围*
助手：*为受影响的文件建一份 todo，保持一项 in_progress 执行重命名*

<reasoning>
使用 todo list 原因：
1. 重命名跨多文件，需协同修改
2. 逐个文件跟踪可减少漏改风险
3. 重命名过程中 todo list 能提供清晰进度反馈
</reasoning>
</example>

## 使用示例（不当使用）

<example>
用户：Python 里怎么输出 Hello World？
助手：用以下代码：

python
print("Hello World")

<reasoning>
不使用 todo list：这是单一且轻微的问题，可直接回答。
</reasoning>
</example>

<example>
用户：帮我跑 npm install 并告诉我结果。
助手：*执行 npm install 后直接返回结果*

<reasoning>
不使用 todo list：单一命令、结果立即可见。
</reasoning>
</example>

## 任务状态与管理

1. **任务状态**：使用以下状态跟踪进度：
   - pending：未开始
   - in_progress：正在执行
   - completed：成功完成
   - cancelled：不再需要

2. **任务管理**：
   - 并行推进时实时更新任务状态
   - 一旦完成马上标为 completed（不要批量完结）
   - 存在未完任务时，同一时间**只保持一项**为 in_progress
   - 先完成当前任务再起新任务
   - 任务不再需要时请 cancelled，不要留陈旧项

3. **任务完成要求**：
   - **仅**在**完全**完成后才标为 completed
   - 遇到阻碍、未解决错误、部分实现，保持 in_progress 或补一项后续 todo
   - 测试仍在失败、实现不完整、有关键后续未做时**绝不**标为 completed

4. **任务拆分**：
   - 产出具体、可行动的条目
   - 将复杂任务拆为可控的小步
   - 使用清晰、具描述性的任务名称

5. **输入要求**：
   - 每项 todo 必须包含 content、status、priority
   - content 保持简洁、可行动，描述为"要做什么"
   - **使用用户当前语言**，不要默认英文

拿不准是否该用时，就用。主动任务管理能体现认真并确保需求都被认真处理。`;

const TODO_READ_DESCRIPTION = `使用该工具读取当前会话的主 todo 列表。在动手前需要了解当前计划时主动使用。

何时使用：
- 会话初始或恢复工作时，查看最新的主 todos
- 开新任务前，核实哪些还 pending 或已在 in_progress
- 用户询问当前进度、之前计划或剩余工作时
- 完成/更新某项工作后，确认仍有哪些主道 todo 仍适用
- 不确定接下来该做什么、需要重新锚定到当前已跟踪的工作上时

用法：
- 本工具不接受参数。输入留空即可。
- **不要**传入占位对象、占位字符串，或者诸如 "input" / "empty" 这样的键。
- 返回当前主道 todo 项及其 status、priority、content。
- 要查看临时道而不是主道，请用 subtodoread。
- 主道上还没有 todo 时，返回空列表。`;

const SUBTODO_WRITE_DESCRIPTION = `使用该工具创建和维护当前会话的临时 todo 道。用于记录边角思考、停车区项、后续事项、不应取代主道的临时想法。

何时使用：
- 实现过程中发现有价值但不阻塞主路的后续工作
- 想把某个点子、问题、调查线索先存下来，不打断当前主计划
- 需要跟踪临时笔记，后续可能提升进主 todo 列表

准则：
- 临时道是主 todo 的补充，不应取代。
- 临时 todo 也要简洁、可行动、与当前会话相关。
- 使用与用户最近请求或会话语言一致的语言。
- 每项 todo 必须包含 content、status、priority。
- 临时项一旦转成正式执行工作，请用 todowrite 添加到主 todo 中。`;

const SUBTODO_READ_DESCRIPTION = `使用该工具读取当前会话的临时 todo 道。

何时使用：
- 希望复看暂存的点子、边角调查、后续事项，又不动主 todo
- 需要决定某个临时项是继续存放、更新，还是提升进主道
- 继续推进前想看一眼临时笔记

用法：
- 本工具不接受参数。输入留空即可。
- **不要**传入占位对象、占位字符串，或者诸如 "input" / "empty" 这样的键。
- 仅返回当前临时道上的 todo 项。
- 要查看主道请用 todoread。
- 临时道上还没有 todo 时，返回空列表。`;

const sessionTodoSchema = z
  .object({
    content: z.string().describe('用用户当前语言写的任务简要祈使描述'),
    status: todoStatusSchema.describe('任务当前状态：pending、in_progress、completed、cancelled'),
    priority: todoPrioritySchema.describe('任务优先级：high、medium、low'),
  })
  .strict();

export const todoWriteInputSchema = z
  .object({
    todos: z.array(sessionTodoSchema).describe('当前会话更新后的 todo 列表'),
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
