import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

const optionalNonBlankStringSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().trim().min(1).optional());

/**
 * Schema for the `task` (a.k.a. `delegate_task`) tool.
 *
 * Field notes — kept aligned with opencode / oh-my-opencode:
 *
 * - `session_id` (formerly `resume`): continue an existing child
 *   session. Consumed by `tool-sandbox.ts` task handler to look up
 *   `findTaskBySessionId` and replay onto the same child checkpoint.
 *
 * - `task_id`: alternative re-entry point — when the parent already
 *   owns a task graph entry, reuse its session id without having to
 *   carry the latter through every tool round-trip.
 *
 * - `command`: **reserved for future use**. opencode/oh-my-opencode
 *   use this to invoke a slash-command template that renders an
 *   alternate prompt before dispatching. OpenAWork's slash commands
 *   are discrete server-side actions (compact_session / init_deep /
 *   start_ralph_loop / …), not prompt templates, so there is no
 *   meaningful runtime mapping yet. The field is accepted (and
 *   currently ignored) so that LLM calls compatible with the upstream
 *   schema don't trip a validation error; once OpenAWork grows a
 *   prompt-template subsystem this can be wired through. Schema
 *   `.describe` text is intentionally explicit about the no-op so the
 *   model doesn't expect side effects.
 */
/**
 * 子代理工具的**规范名**（对齐上游 opencode 的 `subagent`）。
 *
 * `task` 作为**别名**继续被接受（兼容既有 prompt、存量会话与验收脚本）：
 * 名称归一由 `routes/tool-name-compat.ts` 与 `tools/legacy-tool-name-rewrite.ts`
 * 的镜像表承担，运行期判定统一走 `isTaskToolName()`。
 */
export const TASK_TOOL_NAME = 'subagent';

/** 历史别名。新代码不要产出它；仅用于接受既有调用。 */
export const TASK_TOOL_LEGACY_NAME = 'task';

/** 是否为子代理工具（规范名或历史别名）。 */
export function isTaskToolName(toolName: string): boolean {
  return toolName === TASK_TOOL_NAME || toolName === TASK_TOOL_LEGACY_NAME;
}

const taskInputSchema = z
  .object({
    description: optionalNonBlankStringSchema,
    prompt: z.string().min(1),
    subagent_type: optionalNonBlankStringSchema,
    category: optionalNonBlankStringSchema,
    load_skills: z.array(z.string().min(1)).default([]),
    run_in_background: z.boolean().optional(),
    session_id: optionalNonBlankStringSchema.describe(
      '要继续的已有子会话 ID（取代旧的 `resume` 字段）。',
    ),
    task_id: optionalNonBlankStringSchema,
    command: optionalNonBlankStringSchema.describe(
      '保留字段，仅用于上游 schema 兼容的 slash command 标识。OpenAWork 目前忽略该字段——slash command 是服务端动作而非 prompt 模板，请直接在 `prompt` 中表达工作。',
    ),
    // ── 上游 `subagent` 工具的输入别名（对齐 opencode）────────────────────
    // 上游 schema：`{ agent, description, prompt, model, sessionID, background }`。
    // 这里接受同义字段并归一化为本仓的规范字段，使上游形状的调用可直接工作。
    agent: optionalNonBlankStringSchema.describe('`subagent_type` 的上游别名。'),
    background: z.boolean().optional().describe('`run_in_background` 的上游别名。'),
    sessionID: optionalNonBlankStringSchema.describe('`session_id` 的上游别名。'),
  })
  .superRefine((value, context) => {
    if (value.subagent_type && value.category) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either category or subagent_type, not both',
        path: ['category'],
      });
    }

    if (!value.subagent_type && !value.category && !value.agent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either category or subagent_type is required',
        path: ['subagent_type'],
      });
    }

    if (value.subagent_type && value.agent && value.subagent_type !== value.agent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'subagent_type and agent disagree; provide only one',
        path: ['agent'],
      });
    }
  })
  .transform((value) => ({
    ...value,
    // 归一化上游别名 → 本仓规范字段。显式给出的规范字段优先。
    subagent_type: value.subagent_type ?? value.agent,
    run_in_background: value.run_in_background ?? value.background ?? false,
    session_id: value.session_id ?? value.sessionID,
  }));

const taskOutputSchema = z.object({
  taskId: z.string(),
  sessionId: z.string(),
  status: z.enum(['pending', 'running', 'done', 'failed', 'cancelled']),
  assignedAgent: z.string(),
  category: z.string().optional(),
  requestedSkills: z.array(z.string()).optional(),
  result: z.string().optional(),
  errorMessage: z.string().optional(),
  message: z.string().optional(),
  reason: z.string().optional(),
  timeoutSource: z.enum(['first_response']).optional(),
});

export const taskToolDefinition: ToolDefinition<typeof taskInputSchema, typeof taskOutputSchema> = {
  name: TASK_TOOL_NAME,
  description:
    '启动一个 agent 任务，可按 category 选取或直接指定 agent。category 与 subagent_type 仅传其一。load_skills 与 run_in_background 必填。同步执行使用 run_in_background=false，仅并行后台工作时才传 true。子任务自动超时由助手首活超时 / 重试则控制。别名 `task` 同样被接受；也接受 `agent` / `background` / `sessionID` 作为同义字段。子代理选型（按任务性质选，不要默认 scout）：explore=代码库内搜索与定位；librarian=代码库与官方文档检索、多仓库分析、实现示例；scout=外部依赖源码 / 上游仓库 / 第三方文档的只读研究；web-researcher=联网新闻 / 资讯 / 公开网页检索（多来源交叉比对，只读）；general=通用研究与多步执行；oracle/metis/momus/prometheus=只读顾问与计划审查。其他内置或自定义 agent 也可直接传 id。',
  inputSchema: taskInputSchema,
  outputSchema: taskOutputSchema,
  timeout: 30000,
  execute: async () => {
    throw new Error('task must execute through the gateway-managed sandbox path');
  },
};
