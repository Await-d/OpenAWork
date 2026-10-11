import type { ToolParameters } from './tool-parameter-schema.js';
import { MAX_BASH_TIMEOUT_MS } from '../bash-tools.js';

export function buildExecutionParameters(name: string): ToolParameters | undefined {
  switch (name) {
    case 'skill':
      return {
        type: 'object',
        properties: {
          name: { type: 'string', description: '要加载的已安装 skill 名称（精确）' },
        },
        required: ['name'],
        additionalProperties: false,
      };
    case 'bash':
      return {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要运行的单行 shell 命令' },
          description: {
            type: 'string',
            description: '可选：用 5-10 个词描述该命令的作用，便于审计和回放',
          },
          timeout: {
            type: 'integer',
            minimum: 1,
            // Must stay in sync with bash-tools.ts MAX_BASH_TIMEOUT_MS (imported below).
            maximum: MAX_BASH_TIMEOUT_MS,
            description: '命令超时（毫秒）',
          },
          workdir: {
            type: 'string',
            description: '命令执行的工作区绝对路径',
          },
        },
        required: ['command'],
        additionalProperties: false,
      };
    case 'run_bash_in_background':
      return {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要在后台运行的单行 shell 命令' },
          description: {
            type: 'string',
            description: '5-10 个词描述该后台命令的作用',
          },
          workdir: {
            type: 'string',
            description: '可选：命令执行的工作区绝对路径',
          },
          timeout: {
            type: 'integer',
            minimum: 1,
            description: '可选：命令超时（毫秒），默认 24h',
          },
        },
        required: ['command'],
        additionalProperties: false,
      };
    case 'bash_output':
      return {
        type: 'object',
        properties: {
          terminal_id: {
            type: 'string',
            description: 'run_bash_in_background 返回的 terminalId',
          },
          since_bytes: {
            type: 'integer',
            minimum: 0,
            description: '只返回累计输出超过此字节数之后的尾段；默认 0 返回全部缓存的 tail',
          },
        },
        required: ['terminal_id'],
        additionalProperties: false,
      };
    case 'bash_kill':
      return {
        type: 'object',
        properties: {
          terminal_id: {
            type: 'string',
            description: '要终止的后台终端 id',
          },
        },
        required: ['terminal_id'],
        additionalProperties: false,
      };
    case 'tool_invoke':
      return {
        type: 'object',
        properties: {
          tool: {
            type: 'string',
            description: '折叠工具名（见系统提示的「可折叠工具目录」）。',
          },
          arguments: {
            type: 'object',
            description: '工具入参对象；参数不确定时先用 tool_search 查询完整 JSON Schema。',
            additionalProperties: true,
          },
        },
        required: ['tool'],
        additionalProperties: false,
      };
    case 'tool_search':
      return {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '检索关键词（工具名或能力描述，例如 "lsp" / "session" / "mcp"）。',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: '返回数量上限，默认 8。',
          },
        },
        required: ['query'],
        additionalProperties: false,
      };
    case 'read_tool_output':
      return {
        type: 'object',
        properties: {
          toolCallId: {
            type: 'string',
            description:
              '推荐：精确定位要读的 tool_result（来自会话历史中的 toolCallId）。续读上一页时若不传，系统自动回退到最近一次被引用的输出；只有明确描述时要换一份不同输出，才必须显式传它。',
          },
          toolCallRef: {
            type: 'string',
            pattern: '^[a-f0-9]{64}$',
            description: '超长 toolCallId 的稳定 SHA-256 引用，来自 tool_output_reference',
          },
          useLatestReferenced: {
            type: 'boolean',
            description:
              '兜底开关：为 true 且未传 toolCallId 时，读取当前会话中被 [tool_output_reference] 替换掉的最近一次大输出；只传选择参数（lineStart/jsonPath/charStart/itemStart 等）续读上一页时也会自动走此回退。',
          },
          jsonPath: {
            type: 'string',
            description: '针对结构化输出的可选点记路径，如 data.items[0]。读取前先钻入某个子字段。',
          },
          lineStart: {
            type: 'integer',
            minimum: 1,
            description: '大文本输出的起始行号（1-基）',
          },
          lineCount: {
            type: 'integer',
            minimum: 1,
            maximum: 400,
            description: '读多少行文本',
          },
          charStart: {
            type: 'integer',
            minimum: 0,
            description:
              '当前 jsonPath/行/项选择内的 UTF-16 字符偏移（0 基）。续读时保留原选择参数。',
          },
          charCount: {
            type: 'integer',
            minimum: 1,
            maximum: 8000,
            description:
              '每页最多 8000 字符；超额请求自动缩至 8000。实际返回同时受序列化字节预算限制，必须使用 nextCharStart 续读。',
          },
          itemStart: {
            type: 'integer',
            minimum: 0,
            description: '数组输出的起始项下标（0-基）',
          },
          itemCount: {
            type: 'integer',
            minimum: 1,
            maximum: 200,
            description: '返回多少个数组项',
          },
        },
        required: [],
        additionalProperties: false,
      };
    case 'background_output':
      return {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description:
              '后台任务 id（task_id / taskId / runId 中传其一）。优先传子代理通知标签里的 task 主键；若手上只有子代理通知里的 sessionID，也可直接传入，工具会自动按子会话反查对应任务。',
          },
          taskId: { type: 'string', description: 'task_id 的别名。' },
          runId: { type: 'string', description: '后台任务的 run id 别名。' },
          block: {
            type: 'boolean',
            description: '是否等任务结束后再返回',
          },
          full_session: {
            type: 'boolean',
            description:
              '显式 opt-in：返回过滤后的子会话消息；默认 false 只回任务状态与子代理最终总结（摘要视图）。',
          },
          include_thinking: {
            type: 'boolean',
            description: 'full_session=true 时是否包含助手 thinking 块',
          },
          include_tool_results: {
            type: 'boolean',
            description: 'full_session=true 时是否包含工具结果消息',
          },
          message_limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: '返回消息数量上限',
          },
          since_message_id: {
            type: 'string',
            description: '仅返回此 message id 之后的消息',
          },
          thinking_max_chars: {
            type: 'integer',
            minimum: 1,
            maximum: 20000,
            description: '每条消息中 thinking 文本的最大字符数',
          },
          timeout: {
            type: 'integer',
            minimum: 1,
            maximum: 600000,
            description: 'block=true 时的最大等待时间（毫秒）',
          },
        },
        required: [],
        additionalProperties: false,
      };
    case 'background_cancel':
      return {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: '要取消的任务 id。all=false 时 taskId / task_id / runId 中传其一。',
          },
          task_id: { type: 'string', description: 'taskId 的别名。' },
          runId: { type: 'string', description: '后台任务的 run id 别名。' },
          all: {
            type: 'boolean',
            description: 'true 时取消本会话下所有可取消的后台子任务。',
          },
        },
        required: [],
        additionalProperties: false,
      };
    case 'interactive_bash':
      return {
        type: 'object',
        properties: {
          tmux_command: { type: 'string' },
        },
        required: ['tmux_command'],
        additionalProperties: false,
      };
    default:
      return undefined;
  }
}
