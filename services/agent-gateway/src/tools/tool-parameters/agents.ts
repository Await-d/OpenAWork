import type { ToolParameters } from './tool-parameter-schema.js';
import { FROZEN_CATEGORY_DESCRIPTIONS } from '../../reference-frozen/category-snapshot.js';

export function buildAgentParameters(name: string): ToolParameters | undefined {
  switch (name) {
    case 'task_create':
      return {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: '任务标题。title 与 subject 任选其一（二者等价）。',
          },
          subject: {
            type: 'string',
            description: 'title 的旧别名。请任选其一。',
          },
          kind: {
            type: 'string',
            description: '任务类型标签，默认 "task"。',
          },
          description: { type: 'string' },
          blockedBy: { type: 'array', items: { type: 'string' } },
          blocks: { type: 'array', items: { type: 'string' } },
          parentTaskId: {
            type: 'string',
            description: '嵌套任务的父任务 id。',
          },
          parentID: { type: 'string', description: 'parentTaskId 的旧别名。' },
          assignedAgent: { type: 'string' },
          owner: { type: 'string', description: 'assignedAgent 的旧别名。' },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
          },
          tags: { type: 'array', items: { type: 'string' } },
          idempotencyKey: { type: 'string' },
          causationId: { type: 'string' },
          metadata: { type: 'object' },
        },
        required: [],
        additionalProperties: false,
      };
    case 'task_get':
      return {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
        additionalProperties: false,
      };
    case 'task_list':
      return {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      };
    case 'task_update':
      return {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          subject: { type: 'string', description: 'title 的旧别名。' },
          kind: { type: 'string' },
          description: { type: 'string' },
          status: {
            type: 'string',
            enum: [
              'pending',
              'running',
              'blocked',
              'completed',
              'failed',
              'cancelled',
              'in_progress',
              'deleted',
            ],
          },
          parentTaskId: { type: 'string' },
          parentID: { type: 'string', description: 'parentTaskId 的旧别名。' },
          addBlocks: { type: 'array', items: { type: 'string' } },
          addBlockedBy: { type: 'array', items: { type: 'string' } },
          assignedAgent: { type: 'string' },
          owner: { type: 'string', description: 'assignedAgent 的旧别名。' },
          metadata: { type: 'object' },
          expectedRevision: {
            type: 'integer',
            minimum: 0,
            description: '乐观并发：更新前期望的 revision。',
          },
          conflictPolicy: {
            type: 'string',
            enum: ['reject', 'merge', 'overwrite'],
            description: '当 expectedRevision 与当前任务 revision 不匹配时的处理策略。',
          },
          idempotencyKey: { type: 'string' },
          causationId: { type: 'string' },
        },
        required: ['id'],
        additionalProperties: false,
      };
    // `subagent` 是子代理工具的**模型可见规范名**(派发名亦为 `subagent`,
    // `task` 为历史别名)。两者共用同一份 schema,否则模型拿到的是
    // `buildParameters` 的宽松空 schema,看不到 `subagent_type` / `category`
    // 的取值指引(历史现象:模型臆造 `general`)。
    case 'task':
    case 'subagent':
      return {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: '任务简要描述（3-5 个词）',
          },
          prompt: {
            type: 'string',
            description: '传给 agent 的完整详细 prompt。Prompt **必须是英文**。',
          },
          subagent_type: {
            type: 'string',
            description:
              '未传 category 时必填。**不要**同时传 category 和 subagent_type。常用选型：explore（代码库内搜索定位）/ librarian（代码库与官方文档检索、实现示例）/ scout（外部依赖源码、上游仓库与第三方文档的只读研究）/ web-researcher（联网新闻、资讯与公开网页检索；多来源交叉比对，只读）/ oracle·metis·momus（只读顾问与计划审查）。**联网资讯/新闻检索派 web-researcher，不要派 scout**。其他内置或自定义 agent 也可直接传 id;若只想按任务性质选执行风格,请改用 category。',
          },
          category: {
            type: 'string',
            description: `未传 subagent_type 时必填。**不要**同时传 category 和 subagent_type。可选：${Object.keys(FROZEN_CATEGORY_DESCRIPTIONS).join(' / ')}。`,
          },
          load_skills: {
            type: 'array',
            description: '要注入的 skill 名称列表。必填——不需要时传 [] 。',
            items: { type: 'string' },
          },
          run_in_background: {
            type: 'boolean',
            description:
              '必填。true=异步（返回 task_id），false=同步（会等待）。任务委派用 false，仅并行探索时才用 true。',
          },
          session_id: {
            type: 'string',
            description: '要继续的已有 Task 会话',
          },
          task_id: {
            type: 'string',
            description: '现有子任务/会话的旧恢复-任务-id 别名',
          },
          command: {
            type: 'string',
            description: '触发本任务的命令',
          },
        },
        required: ['prompt'],
        additionalProperties: false,
      };
    case 'session_list':
      return {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          from_date: { type: 'string' },
          to_date: { type: 'string' },
          project_path: { type: 'string' },
        },
        required: [],
        additionalProperties: false,
      };
    case 'session_read':
      return {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          include_todos: { type: 'boolean' },
          include_transcript: { type: 'boolean' },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 500,
            description: '返回最近多少条消息，默认 20；上限 500。',
          },
          full: {
            type: 'boolean',
            description: 'true 时返回消息完整文本；默认折叠长消息（每条约 600 字符）。',
          },
        },
        required: ['session_id'],
        additionalProperties: false,
      };
    case 'session_search':
      return {
        type: 'object',
        properties: {
          query: { type: 'string' },
          session_id: { type: 'string' },
          case_sensitive: { type: 'boolean' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['query'],
        additionalProperties: false,
      };
    case 'session_info':
      return {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
        },
        required: ['session_id'],
        additionalProperties: false,
      };
    case 'Agent':
      return {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: '任务简要描述（3-5 个词），用于列表与完成通知展示。',
          },
          prompt: {
            type: 'string',
            description:
              '传给子代理的完整任务指令：目标、边界与期望产出写清楚，子代理只拿到这一条指令。',
          },
          subagent_type: {
            type: 'string',
            description:
              '子代理类型。常用：explore（代码库内搜索定位）/ librarian（代码库与官方文档检索、实现示例）/ scout（外部依赖源码、上游仓库与第三方文档的只读研究）/ web-researcher（联网新闻、资讯与公开网页检索；多来源交叉比对，只读）/ oracle·metis·momus（只读顾问与计划审查）/ hephaestus（自主深度实施）/ multimodal-looker（多模态媒体解读）。**联网资讯/新闻检索派 web-researcher，不要派 scout**（也可由主会话直接用 websearch / webfetch）。',
          },
          run_in_background: {
            type: 'boolean',
            description:
              'true=异步执行（立即返回 task_id，完成时自动回流通知，需要并行多任务时才用）；false=同步等待结果。省略时为 false。',
          },
          session_id: {
            type: 'string',
            description: '要继续的已有子代理会话 id（可选）。',
          },
        },
        required: ['prompt', 'subagent_type'],
        additionalProperties: false,
      };
    case 'skill_mcp':
      return {
        type: 'object',
        properties: {
          mcp_name: { type: 'string' },
          tool_name: { type: 'string' },
          resource_name: { type: 'string' },
          prompt_name: { type: 'string' },
          arguments: {
            anyOf: [{ type: 'string' }, { type: 'object' }],
          },
          grep: { type: 'string' },
        },
        required: ['mcp_name'],
        additionalProperties: false,
      };
    case 'session_rename':
      return {
        type: 'object',
        properties: {
          sessionID: {
            type: 'string',
            description: '要重命名的会话 ID；省略时重命名当前会话。',
          },
          title: {
            type: 'string',
            description: '新的会话标题（1–200 字符，去除首尾空白后不能为空）。',
          },
        },
        required: ['title'],
        additionalProperties: false,
      };
    case 'session_move':
      return {
        type: 'object',
        properties: {
          directory: {
            type: ['string', 'null'],
            description: '会话新的工作目录；传 null 表示解绑当前工作区。',
          },
          force: {
            type: 'boolean',
            description: 'true 时强制切换已绑定工作区，并写入 workspaceWarpHistory 审计。',
          },
        },
        required: ['directory'],
        additionalProperties: false,
      };
    default:
      return undefined;
  }
}
