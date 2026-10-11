import type { ToolParameters } from './tool-parameter-schema.js';

export function buildFilesystemParameters(name: string): ToolParameters | undefined {
  switch (name) {
    case 'list':
      return {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要检视的工作区目录绝对路径' },
          depth: {
            type: 'integer',
            minimum: 1,
            maximum: 4,
            description: '递归遍历的最大目录深度',
          },
        },
        required: ['path'],
        additionalProperties: false,
      };
    case 'read':
      return {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要读取的工作区文件绝对路径' },
          filePath: { type: 'string', description: 'path 的旧别名' },
          offset: {
            type: 'integer',
            minimum: 1,
            description: '可选的 1-基起始行号。在大文件中跳过前面部分使用；配合 limit 可分页。',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 2000,
            description:
              '可选的最大返回行数，默认 2000。超过 2000 字符的行会被截断；参考结果中的 totalLines/lineEnd 决定是否加大 offset 继续读。',
          },
        },
        required: [],
        additionalProperties: false,
      };
    case 'glob':
      return {
        type: 'object',
        properties: {
          path: { type: 'string', description: '可选的要搜索的工作区目录路径' },
          pattern: { type: 'string', description: '用于匹配工作区文件的 glob 模式' },
        },
        required: ['pattern'],
        additionalProperties: false,
      };
    case 'edit':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: '要编辑的工作区文件绝对路径' },
          oldString: {
            type: 'string',
            description: '要被替换的原文。先读文件，缩进需严格匹配。',
          },
          newString: { type: 'string', description: '写入文件的替换文本' },
          replaceAll: {
            type: 'boolean',
            description: 'true 时替换所有完全匹配的 oldString',
          },
        },
        required: ['filePath', 'oldString', 'newString'],
        additionalProperties: false,
      };
    case 'multi_edit':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: '要编辑的工作区文件绝对路径' },
          edits: {
            type: 'array',
            description: '需要在该文件上顺序执行的一组编辑操作',
            items: {
              type: 'object',
              properties: {
                oldString: { type: 'string', description: '要被替换的原文' },
                newString: {
                  type: 'string',
                  description: '替换后的文本（必须与 oldString 不同）',
                },
                replaceAll: {
                  type: 'boolean',
                  description: '是否替换 oldString 的所有出现（默认 false）',
                },
              },
              required: ['oldString', 'newString'],
              additionalProperties: false,
            },
          },
        },
        required: ['filePath', 'edits'],
        additionalProperties: false,
      };
    case 'batch':
      return {
        type: 'object',
        properties: {
          tool_calls: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                tool: { type: 'string', description: '要执行的运行时工具名称' },
                parameters: {
                  type: 'object',
                  description: '传给该工具的输入对象',
                },
              },
              required: ['tool', 'parameters'],
              additionalProperties: false,
            },
          },
        },
        required: ['tool_calls'],
        additionalProperties: false,
      };
    case 'patch':
      return {
        type: 'object',
        properties: {
          patchText: {
            type: 'string',
            description: '以 *** Begin Patch / *** End Patch 包裹的结构化补丁文本',
          },
        },
        required: ['patchText'],
        additionalProperties: false,
      };
    case 'grep':
      return {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '在文件内容中搜索的正则表达式' },
          path: { type: 'string', description: '可选的要搜索的工作区目录路径' },
          include: {
            type: 'string',
            description: '可选的 glob 模式，限定被包含的文件',
          },
          output_mode: {
            type: 'string',
            enum: ['content', 'files_with_matches', 'count'],
            description:
              '默认 "files_with_matches"。仅在配合较小的 head_limit 时才用 "content"，避免输出过大。',
          },
          head_limit: {
            type: 'integer',
            minimum: 0,
            maximum: 500,
            description:
              '返回匹配项的最大数量。output_mode="content" 时传一个正值（如 50）以控制输出量；0 表示不限制。',
          },
        },
        required: ['pattern'],
        additionalProperties: false,
      };
    case 'workspace_review_status':
      return {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要查看 git 变更的工作区根路径',
          },
        },
        required: ['path'],
        additionalProperties: false,
      };
    case 'workspace_review_diff':
      return {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要查看 git diff 的工作区根路径' },
          filePath: {
            type: 'string',
            description: '变更文件路径，可以是相对于工作区根的路径或工作区内的绝对路径',
          },
        },
        required: ['path', 'filePath'],
        additionalProperties: false,
      };
    case 'write':
      return {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要写入的工作区文件绝对路径；不存在时会创建',
          },
          filePath: {
            type: 'string',
            description: 'path 的旧别名。新调用请始终使用 path。',
          },
          content: {
            type: 'string',
            description: '写入文件的 UTF-8 内容。会覆盖已有文件。',
          },
        },
        required: ['content'],
        anyOf: [
          { type: 'object', required: ['path'] },
          { type: 'object', required: ['filePath'] },
        ],
        additionalProperties: false,
      };
    case 'workspace_create_directory':
      return {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要创建的工作区目录绝对路径' },
        },
        required: ['path'],
        additionalProperties: false,
      };
    case 'workspace_review_revert':
      return {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '包含该 git 变更的工作区根路径',
          },
          filePath: {
            type: 'string',
            description: '变更文件路径，可以是相对于工作区根的路径或工作区内的绝对路径',
          },
        },
        required: ['path', 'filePath'],
        additionalProperties: false,
      };
    case 'todowrite':
    case 'subtodowrite':
      return {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: '当前会话更新后的 todo 列表',
            items: {
              type: 'object',
              properties: {
                content: {
                  type: 'string',
                  description: '用用户当前语言写的任务简要祈使描述',
                },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed', 'cancelled'],
                  description: '任务当前状态：pending、in_progress、completed、cancelled',
                },
                priority: {
                  type: 'string',
                  enum: ['high', 'medium', 'low'],
                  description: '任务优先级：high、medium、low',
                },
              },
              required: ['content', 'status', 'priority'],
              additionalProperties: false,
            },
          },
        },
        required: ['todos'],
        additionalProperties: false,
      };
    case 'todoread':
    case 'subtodoread':
      return {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      };
    default:
      return undefined;
  }
}
