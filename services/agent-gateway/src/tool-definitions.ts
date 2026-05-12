import { LSP_TOOLS } from '@openAwork/agent-core';
import {
  globTool,
  grepTool,
  listTool,
  readTool,
  workspaceCreateDirectoryTool,
  workspaceReviewRevertTool,
  workspaceReviewDiffTool,
  workspaceReviewStatusTool,
  writeTool,
} from './workspace-tools.js';
import { websearchTool } from './tool-aliases.js';
import { codesearchToolDefinition } from './codesearch-tools.js';
import { subTodoReadTool, subTodoWriteTool, todoReadTool, todoWriteTool } from './todo-tools.js';
import { webfetchTool } from './web-tools.js';
import { createEditTool } from './edit-tools.js';
import { createMultiEditTool } from './multi-edit-tool.js';
import { batchToolDefinition } from './batch-tools.js';
import { createSkillTool } from './skill-tools.js';
import { bashToolDefinition } from './bash-tools.js';
import { applyPatchToolDefinition } from './apply-patch-tools.js';
import { questionToolDefinition } from './question-tools.js';
import { taskToolDefinition } from './task-tools.js';
import { enterPlanModeToolDefinition, exitPlanModeToolDefinition } from './plan-mode-tools.js';
import { readToolOutputToolDefinition } from './tool-output-tools.js';
import {
  backgroundCancelToolDefinition,
  backgroundOutputToolDefinition,
} from './background-task-tools.js';
import {
  bashKillToolDefinition,
  bashOutputToolDefinition,
  runBashInBackgroundToolDefinition,
} from './run-background-bash-tools.js';
import {
  sessionInfoToolDefinition,
  sessionListToolDefinition,
  sessionReadToolDefinition,
  sessionSearchToolDefinition,
} from './session-manager-tools.js';
import {
  AST_GREP_LANGUAGES,
  astGrepReplaceToolDefinition,
  astGrepSearchToolDefinition,
} from './ast-grep-tools.js';
import { interactiveBashToolDefinition } from './interactive-bash-tools.js';
import { callOmoAgentToolDefinition } from './call-omo-agent-tools.js';
import { skillMcpToolDefinition } from './skill-mcp-tools.js';
import { lookAtToolDefinition } from './look-at-tools.js';
import { generateImageToolDefinition } from './image-generation-tool.js';
import { desktopAutomationToolDefinition } from './desktop-automation.js';
import {
  lspCallHierarchyToolDefinition,
  lspFindReferencesToolDefinition,
  lspGotoDefinitionToolDefinition,
  lspGotoImplementationToolDefinition,
  lspHoverToolDefinition,
  lspPrepareRenameToolDefinition,
  lspRenameToolDefinition,
  lspSymbolsToolDefinition,
} from './lsp-tools.js';
import {
  taskCreateToolDefinition,
  taskGetToolDefinition,
  taskListToolDefinition,
  taskUpdateToolDefinition,
} from './task-crud-tools.js';
import { repoCloneToolDefinition } from './repo-clone-tools.js';
import { repoOverviewToolDefinition } from './repo-overview-tools.js';
import type { EffectiveSkill } from './skill-selection.js';

const CLAUDE_FIRST_VISIBLE_NAME_OVERRIDES = {
  skill: 'Skill',
  question: 'AskUserQuestion',
  call_omo_agent: 'Agent',
} as const;

export function getVisibleToolName(toolName: string): string {
  return (
    CLAUDE_FIRST_VISIBLE_NAME_OVERRIDES[
      toolName as keyof typeof CLAUDE_FIRST_VISIBLE_NAME_OVERRIDES
    ] ?? toolName
  );
}

type GatewayToolLike = {
  name: string;
  description: string;
};

const MCP_LIST_TOOLS_DEFINITION = {
  name: 'mcp_list_tools',
  description: '列出当前用户启用的 MCP 服务器以及每个服务器上可用的工具。',
} as const;

const MCP_CALL_DEFINITION = {
  name: 'mcp_call',
  description:
    '经过权限批准后，代当前用户调用某个已配置 MCP 服务器的工具。请先调 mcp_list_tools 查找有效的 serverId / toolName 组合。',
} as const;

export interface GatewayToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    strict: boolean;
    deferLoading?: boolean;
  };
}

const editTool = createEditTool(
  '__tool-definitions__',
  '__tool-definitions__',
  '__tool-definitions__',
);
const multiEditTool = createMultiEditTool(
  '__tool-definitions__',
  '__tool-definitions__',
  '__tool-definitions__',
);
const skillTool = createSkillTool('__tool-definitions__', '__tool-definitions__');

const MODEL_VISIBLE_GATEWAY_TOOLS = [
  websearchTool,
  codesearchToolDefinition,
  webfetchTool,
  ...LSP_TOOLS,
  lspGotoDefinitionToolDefinition,
  lspGotoImplementationToolDefinition,
  lspFindReferencesToolDefinition,
  lspSymbolsToolDefinition,
  lspPrepareRenameToolDefinition,
  lspRenameToolDefinition,
  lspHoverToolDefinition,
  lspCallHierarchyToolDefinition,
  taskCreateToolDefinition,
  taskGetToolDefinition,
  taskListToolDefinition,
  taskUpdateToolDefinition,
  listTool,
  readTool,
  globTool,
  grepTool,
  editTool,
  multiEditTool,
  skillTool,
  batchToolDefinition,
  bashToolDefinition,
  runBashInBackgroundToolDefinition,
  bashOutputToolDefinition,
  bashKillToolDefinition,
  applyPatchToolDefinition,
  questionToolDefinition,
  enterPlanModeToolDefinition,
  exitPlanModeToolDefinition,
  readToolOutputToolDefinition,
  taskToolDefinition,
  backgroundOutputToolDefinition,
  backgroundCancelToolDefinition,
  sessionListToolDefinition,
  sessionReadToolDefinition,
  sessionSearchToolDefinition,
  sessionInfoToolDefinition,
  astGrepSearchToolDefinition,
  astGrepReplaceToolDefinition,
  interactiveBashToolDefinition,
  callOmoAgentToolDefinition,
  skillMcpToolDefinition,
  lookAtToolDefinition,
  desktopAutomationToolDefinition,
  workspaceReviewStatusTool,
  workspaceReviewDiffTool,
  writeTool,
  workspaceCreateDirectoryTool,
  workspaceReviewRevertTool,
  todoWriteTool,
  todoReadTool,
  subTodoWriteTool,
  subTodoReadTool,
  MCP_LIST_TOOLS_DEFINITION,
  MCP_CALL_DEFINITION,
  generateImageToolDefinition,
  repoCloneToolDefinition,
  repoOverviewToolDefinition,
] as const;

export interface BuildGatewayToolDefinitionsContext {
  /**
   * When provided, the `skill` tool's description is rendered to enumerate
   * only the skills enabled for the current (user, workspace, session). The
   * actual tool execution is gated separately in tool-sandbox.ts; passing
   * effective here only affects what the model sees in the tool list.
   */
  effectiveSkills?: EffectiveSkill[];
}

export function buildGatewayToolDefinitions(
  ctx: BuildGatewayToolDefinitionsContext = {},
): GatewayToolDefinition[] {
  return MODEL_VISIBLE_GATEWAY_TOOLS.map((tool) => {
    let description = tool.description;
    if (tool.name === 'skill' && ctx.effectiveSkills !== undefined) {
      // Re-render description by spinning a transient skillTool with the
      // effective set. Cheap (no DB hit) since createSkillTool only computes
      // string templating from the supplied array.
      description = createSkillTool('__tool-definitions__', '__tool-definitions__', {
        effective: ctx.effectiveSkills,
      }).description;
    }
    return {
      type: 'function' as const,
      function: {
        name: getVisibleToolName(tool.name),
        description,
        parameters: buildParameters({ ...tool, name: getVisibleToolName(tool.name) }),
        strict: false,
      },
    };
  });
}

export function forEachDefaultGatewayTool(
  register: (tool: (typeof MODEL_VISIBLE_GATEWAY_TOOLS)[number]) => void,
): void {
  for (const tool of MODEL_VISIBLE_GATEWAY_TOOLS) {
    register(tool);
  }
}

function buildParameters(tool: GatewayToolLike): GatewayToolDefinition['function']['parameters'] {
  switch (tool.name) {
    case 'websearch':
      return {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          maxResults: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: '返回结果数量上限',
          },
          provider: {
            type: 'string',
            enum: [
              'duckduckgo',
              'tavily',
              'exa',
              'serper',
              'searxng',
              'bocha',
              'zhipu',
              'google',
              'bing',
            ],
          },
          apiKey: { type: 'string' },
          baseUrl: { type: 'string' },
        },
        required: ['query'],
        additionalProperties: false,
      };
    case 'webfetch':
      return {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要请求的完整 URL' },
          format: {
            type: 'string',
            enum: ['markdown', 'text', 'html'],
            description: '返回的响应格式',
          },
          timeout: {
            type: 'integer',
            minimum: 1,
            maximum: 120,
            description: '请求超时（秒）',
          },
        },
        required: ['url'],
        additionalProperties: false,
      };
    case 'Skill':
      return {
        type: 'object',
        properties: {
          skill: { type: 'string', description: '要执行的已安装 skill 名称' },
        },
        required: ['skill'],
        additionalProperties: false,
      };
    case 'AskUserQuestion':
      return {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                header: { type: 'string' },
                multiSelect: { type: 'boolean' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      description: { type: 'string' },
                      preview: { type: 'string' },
                    },
                    required: ['label', 'description'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['question', 'header', 'options'],
              additionalProperties: false,
            },
          },
          annotations: {
            type: 'object',
            description: '询问流程的可选元数据或 UI 标注',
          },
        },
        required: ['questions'],
        additionalProperties: false,
      };
    case 'EnterPlanMode':
      return {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      };
    case 'ExitPlanMode':
      return {
        type: 'object',
        properties: {
          allowedPrompts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                tool: { type: 'string', enum: ['Bash'] },
                prompt: { type: 'string' },
              },
              required: ['tool', 'prompt'],
              additionalProperties: false,
            },
          },
          plan: { type: 'string' },
        },
        required: [],
        additionalProperties: false,
      };
    case 'codesearch':
      return {
        type: 'object',
        properties: {
          query: { type: 'string', description: '代码搜索关键词' },
          tokensNum: {
            type: 'integer',
            minimum: 1000,
            maximum: 50000,
            description: '返回的 token 近似数量',
          },
        },
        required: ['query'],
        additionalProperties: false,
      };
    case 'lsp_diagnostics':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: '可选的文件路径过滤' },
        },
        required: [],
        additionalProperties: false,
      };
    case 'lsp_touch':
      return {
        type: 'object',
        properties: {
          path: { type: 'string', description: '被 touch 的文件路径' },
          waitForDiagnostics: {
            type: 'boolean',
            description: '返回前等待诊断更新',
          },
        },
        required: ['path'],
        additionalProperties: false,
      };
    case 'lsp_goto_definition':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          character: { type: 'integer', minimum: 0 },
        },
        required: ['filePath', 'line', 'character'],
        additionalProperties: false,
      };
    case 'lsp_goto_implementation':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          character: { type: 'integer', minimum: 0 },
        },
        required: ['filePath', 'line', 'character'],
        additionalProperties: false,
      };
    case 'lsp_find_references':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          character: { type: 'integer', minimum: 0 },
          includeDeclaration: { type: 'boolean' },
        },
        required: ['filePath', 'line', 'character'],
        additionalProperties: false,
      };
    case 'lsp_symbols':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          scope: { type: 'string', enum: ['document', 'workspace'] },
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
        required: ['filePath'],
        additionalProperties: false,
      };
    case 'lsp_prepare_rename':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          character: { type: 'integer', minimum: 0 },
        },
        required: ['filePath', 'line', 'character'],
        additionalProperties: false,
      };
    case 'lsp_rename':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          character: { type: 'integer', minimum: 0 },
          newName: { type: 'string' },
        },
        required: ['filePath', 'line', 'character', 'newName'],
        additionalProperties: false,
      };
    case 'lsp_hover':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          character: { type: 'integer', minimum: 0 },
        },
        required: ['filePath', 'line', 'character'],
        additionalProperties: false,
      };
    case 'lsp_call_hierarchy':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          character: { type: 'integer', minimum: 0 },
          direction: { type: 'string', enum: ['incoming', 'outgoing', 'both'] },
        },
        required: ['filePath', 'line', 'character'],
        additionalProperties: false,
      };
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
    case 'desktop_automation':
      return {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'start', 'goto', 'click', 'type', 'screenshot'],
          },
          url: { type: 'string' },
          selector: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['action'],
        additionalProperties: false,
      };
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
          timeout: {
            type: 'integer',
            minimum: 1,
            maximum: 120000,
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
        required: ['command', 'description'],
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
    case 'apply_patch':
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
    case 'question':
      return {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                header: { type: 'string' },
                multiple: { type: 'boolean' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      description: { type: 'string' },
                    },
                    required: ['label', 'description'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['question', 'header', 'options'],
              additionalProperties: false,
            },
          },
        },
        required: ['questions'],
        additionalProperties: false,
      };
    case 'read_tool_output':
      return {
        type: 'object',
        properties: {
          toolCallId: {
            type: 'string',
            description:
              '可选的明确 toolCallId，来自当前会话中之前的 tool_result 引用；有时优先使用它',
          },
          useLatestReferenced: {
            type: 'boolean',
            description:
              '仅作兼底：为 true 且未传 toolCallId 时，读取当前会话中被 [tool_output_reference] 替换掉的最近一次大输出',
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
    case 'task':
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
            description: '未传 category 时必填。**不要**同时传 category 和 subagent_type。',
          },
          category: {
            type: 'string',
            description: '未传 subagent_type 时必填。**不要**同时传 category 和 subagent_type。',
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
        required: ['description', 'prompt', 'load_skills', 'run_in_background'],
        additionalProperties: false,
      };
    case 'background_output':
      return {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: '要查看的后台任务 id。task_id / taskId / runId 中传其一。',
          },
          taskId: { type: 'string', description: 'task_id 的别名。' },
          runId: { type: 'string', description: '后台任务的 run id 别名。' },
          block: {
            type: 'boolean',
            description: '是否等任务结束后再返回',
          },
          full_session: {
            type: 'boolean',
            description: '返回过滤后的子会话消息而不仅是任务概要',
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
          limit: { type: 'integer', minimum: 1, maximum: 500 },
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
    case 'ast_grep_search':
      return {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          lang: { type: 'string', enum: [...AST_GREP_LANGUAGES] },
          paths: { type: 'array', items: { type: 'string' } },
          globs: { type: 'array', items: { type: 'string' } },
          context: { type: 'integer', minimum: 0, maximum: 20 },
        },
        required: ['pattern', 'lang'],
        additionalProperties: false,
      };
    case 'ast_grep_replace':
      return {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          rewrite: { type: 'string' },
          lang: { type: 'string', enum: [...AST_GREP_LANGUAGES] },
          paths: { type: 'array', items: { type: 'string' } },
          globs: { type: 'array', items: { type: 'string' } },
          dryRun: { type: 'boolean' },
        },
        required: ['pattern', 'rewrite', 'lang'],
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
    case 'Agent':
      return {
        type: 'object',
        properties: {
          description: { type: 'string' },
          prompt: { type: 'string' },
          subagent_type: { type: 'string' },
          run_in_background: { type: 'boolean' },
          session_id: { type: 'string' },
        },
        required: ['description', 'prompt', 'subagent_type', 'run_in_background'],
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
    case 'look_at':
      return {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: '要检视的本地文件的工作区绝对路径。file_path 与 image_data 只允许传其一。',
          },
          image_data: {
            type: 'string',
            description:
              'Base64 图片字节（可使用 data:URL）。file_path 与 image_data 只允许传其一。',
          },
          goal: {
            type: 'string',
            description: '简明指出希望从输入中提取什么。',
          },
        },
        required: ['goal'],
        additionalProperties: false,
      };
    case 'generate_image':
      return {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '描述要生成图片的文本 prompt。',
          },
          size: {
            type: 'string',
            description:
              '图片尺寸，WxH 格式。优先选预设：1K — "1024x1024"（1:1）、"1536x1024"（3:2）、"1024x1536"（2:3）；2K（自动提到 high quality）— "2048x2048"（1:1）、"2048x1152"（16:9）、"1152x2048"（9:16）；4K（实验性、慢、仅走 relay）— "3840x2160"（16:9）、"2160x3840"（9:16）。自定义尺寸须同时满足：最长边 ≤ 3840、宽高都是 16 的倍数、长宽比 ≤ 3:1、总像素 [655360, 8294400]。不传时用用户配置。',
          },
          quality: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description:
              '图片质量："low"重速度、"medium"平衡、"high"重细节。2K / 4K 尺寸会被服务端自动提到 "high"。不传时用用户配置。',
          },
          outputFormat: {
            type: 'string',
            enum: ['png', 'jpeg', 'webp'],
            description:
              '输出文件格式："png"（默认、无损）、"jpeg"（较小、不支持透明）、"webp"（现代、较小）。不传时用用户配置。',
          },
          background: {
            type: 'string',
            enum: ['auto', 'opaque'],
            description:
              '背景处理："auto" 由模型决定（PNG/WebP 下可能产生透明）；"opaque" 强制不透明。不传时用用户配置。',
          },
        },
        required: ['prompt'],
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
          filePath: { type: 'string', description: 'path 的旧别名' },
          content: {
            type: 'string',
            description: '写入文件的 UTF-8 内容。会覆盖已有文件。',
          },
        },
        required: ['content'],
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
    case 'mcp_list_tools':
      return {
        type: 'object',
        properties: {
          serverId: {
            type: 'string',
            description: '可选的已配置 MCP 服务器 id。不传时列出所有启用的服务器。',
          },
        },
        required: [],
        additionalProperties: false,
      };
    case 'mcp_call':
      return {
        type: 'object',
        properties: {
          serverId: { type: 'string', description: '要调用的已配置 MCP 服务器 id' },
          toolName: {
            type: 'string',
            description: '由该 MCP 服务器暴露的工具名称',
          },
          arguments: {
            anyOf: [{ type: 'object' }, { type: 'string' }],
            description: '转发给 MCP 工具的参数。可以是 JSON 对象或以 JSON 编码的字符串。',
          },
        },
        required: ['serverId', 'toolName', 'arguments'],
        additionalProperties: false,
      };
    case 'repo_clone':
      return {
        type: 'object',
        properties: {
          repository: {
            type: 'string',
            description: '要克隆的仓库：可传 git URL、host/path 引用、或 GitHub 的 owner/repo 简写',
          },
          branch: {
            type: 'string',
            description: '要克隆与查看的分支或 ref',
          },
          refresh: {
            type: 'boolean',
            description: 'true 时从远端拉取最新状态到受控缓存',
          },
        },
        required: ['repository'],
        additionalProperties: false,
      };
    case 'repo_overview':
      return {
        type: 'object',
        properties: {
          repository: {
            type: 'string',
            description:
              '要查看的缓存仓库：可传 git URL、host/path 引用、或 GitHub 的 owner/repo 简写',
          },
          path: {
            type: 'string',
            description:
              '要查看的目录绝对路径（代替缓存仓库）。除非 OPENAWORK_REPO_OVERVIEW_ALLOW_ANY_PATH=1，否则必须位于 repos 缓存根目录下',
          },
          depth: {
            type: 'integer',
            minimum: 1,
            maximum: 6,
            description: '要包含的最大结构深度，默认 3。',
          },
        },
        required: [],
        additionalProperties: false,
      };
    default:
      return {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: true,
      };
  }
}
