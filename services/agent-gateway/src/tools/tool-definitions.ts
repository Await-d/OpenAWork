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
import { toolInvokeDefinition, toolSearchDefinition } from './tool-folding.js';
import {
  buildPluginGatewayToolDefinitions,
  getPluginToolRegistry,
} from '../plugin/tool-registry.js';
import { createEditTool } from './edit-tools.js';
import { createMultiEditTool } from './multi-edit-tool.js';
import { batchToolDefinition } from './batch-tools.js';
import { createSkillTool } from '../skill/skill-tools.js';
import { bashToolDefinition, MAX_BASH_TIMEOUT_MS } from './bash-tools.js';
import { applyPatchToolDefinition } from './apply-patch-tools.js';
import { questionToolDefinition } from './question-tools.js';
import { taskToolDefinition } from '../task/task-tools.js';
import { FROZEN_CATEGORY_DESCRIPTIONS } from '../reference-frozen/category-snapshot.js';
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
} from '../session/session-manager-tools.js';
import {
  sessionMoveToolDefinition,
  sessionRenameToolDefinition,
} from './session-management-tools.js';
import { modelSearchToolDefinition } from './model-search-tools.js';
import {
  AST_GREP_LANGUAGES,
  astGrepReplaceToolDefinition,
  astGrepSearchToolDefinition,
} from './ast-grep-tools.js';
import { interactiveBashToolDefinition } from './interactive-bash-tools.js';
import { callOmoAgentToolDefinition } from './call-omo-agent-tools.js';
import { skillMcpToolDefinition } from '../skill/skill-mcp-tools.js';
import { lookAtToolDefinition } from './look-at-tools.js';
import { generateImageToolDefinition } from './image-generation-tool.js';
import { convertMediaToolDefinition } from './convert-media-tool.js';
import { extractMediaInfoToolDefinition } from './extract-media-info-tool.js';
import { extractVideoFrameToolDefinition } from './extract-video-frame-tool.js';
import { generateAudioToolDefinition } from './generate-audio-tool.js';
import { desktopAutomationToolDefinition } from './desktop-automation.js';
import { desktopControlToolDefinition } from './desktop-control.js';
import { computerUseToolDefinition } from './gui/computer-use-tool.js';
import {
  buildDesktopAutomationParameters,
  buildDesktopControlParameters,
} from './desktop-tool-parameters.js';
import { buildChannelToolParameters } from './channel-tool-parameters.js';
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
import { CODEGRAPH_TOOL_DEFINITIONS } from './codegraph-tools.js';
import {
  taskCreateToolDefinition,
  taskGetToolDefinition,
  taskListToolDefinition,
  taskUpdateToolDefinition,
} from '../task/task-crud-tools.js';
import { repoCloneToolDefinition } from './repo-clone-tools.js';
import { repoOverviewToolDefinition } from './repo-overview-tools.js';
import { CHANNEL_TOOL_DEFINITIONS } from './channel-tools.js';
import { mcpManageServersToolDefinition } from '../mcp/mcp-admin-tools.js';
import { memoryManageToolDefinition } from '../memory/memory-admin-tools.js';
import { skillManageToolDefinition } from '../skill/skill-admin-tools.js';
import { pluginManageToolDefinition } from '../plugin/plugin-admin-tools.js';
import { scheduleManageToolDefinition } from '../cron/schedule-admin-tools.js';
import { agentManageToolDefinition } from '../agent/agent-admin-tools.js';
import { teamWorkspaceManageToolDefinition } from '../team/team-workspace-admin-tools.js';
import type { EffectiveSkill } from '../skill/skill-selection.js';

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
      anyOf?: { type: 'object'; required: string[] }[];
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
  sessionRenameToolDefinition,
  sessionMoveToolDefinition,
  modelSearchToolDefinition,
  astGrepSearchToolDefinition,
  astGrepReplaceToolDefinition,
  interactiveBashToolDefinition,
  callOmoAgentToolDefinition,
  skillMcpToolDefinition,
  lookAtToolDefinition,
  desktopAutomationToolDefinition,
  desktopControlToolDefinition,
  computerUseToolDefinition,
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
  mcpManageServersToolDefinition,
  memoryManageToolDefinition,
  skillManageToolDefinition,
  pluginManageToolDefinition,
  scheduleManageToolDefinition,
  agentManageToolDefinition,
  teamWorkspaceManageToolDefinition,
  generateImageToolDefinition,
  convertMediaToolDefinition,
  extractMediaInfoToolDefinition,
  extractVideoFrameToolDefinition,
  generateAudioToolDefinition,
  repoCloneToolDefinition,
  repoOverviewToolDefinition,
  ...CHANNEL_TOOL_DEFINITIONS,
  ...CODEGRAPH_TOOL_DEFINITIONS,
  toolInvokeDefinition,
  toolSearchDefinition,
] as const;

// v2 plugin platform: built-in tool names are reserved. A plugin tool
// must not shadow them — the sandbox would route the name to the
// built-in executor and the plugin tool would silently never run.
getPluginToolRegistry().setReservedNames(
  MODEL_VISIBLE_GATEWAY_TOOLS.flatMap((tool) => [tool.name, getVisibleToolName(tool.name)]),
);

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
  const builtin = MODEL_VISIBLE_GATEWAY_TOOLS.map((tool) => {
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
  // v2 plugin platform: plugin-contributed tools are appended after the
  // built-ins. Name collisions are rejected at registration time, so the
  // two lists never overlap.
  return [...builtin, ...buildPluginGatewayToolDefinitions()];
}

export function forEachDefaultGatewayTool(
  register: (tool: (typeof MODEL_VISIBLE_GATEWAY_TOOLS)[number]) => void,
): void {
  for (const tool of MODEL_VISIBLE_GATEWAY_TOOLS) {
    register(tool);
  }
}

function buildParameters(tool: GatewayToolLike): GatewayToolDefinition['function']['parameters'] {
  const channelParameters = buildChannelToolParameters(tool.name);
  if (channelParameters) {
    return channelParameters;
  }

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
            enum: ['markdown', 'text', 'html', 'image-preview'],
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
    case 'codegraph_status':
      return {
        type: 'object',
        properties: {
          workspaceRoot: { type: 'string', description: '可选：当前 active workspace 内的根目录' },
        },
        required: [],
        additionalProperties: false,
      };
    case 'codegraph_index':
      return {
        type: 'object',
        properties: {
          workspaceRoot: { type: 'string', description: '可选：当前 active workspace 内的根目录' },
          path: { type: 'string', description: '可选：只索引 active workspace 内的子路径' },
          force: { type: 'boolean', description: '是否强制重新索引' },
        },
        required: [],
        additionalProperties: false,
      };
    case 'codegraph_search':
      return {
        type: 'object',
        properties: {
          workspaceRoot: { type: 'string', description: '可选：当前 active workspace 内的根目录' },
          query: { type: 'string', description: '符号名称或部分名称' },
          kind: {
            type: 'string',
            enum: [
              'function',
              'method',
              'class',
              'interface',
              'type',
              'variable',
              'route',
              'component',
            ],
          },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['query'],
        additionalProperties: false,
      };
    case 'codegraph_node':
      return {
        type: 'object',
        properties: {
          workspaceRoot: { type: 'string', description: '可选：当前 active workspace 内的根目录' },
          symbol: { type: 'string', description: '要查看的符号名' },
          file: {
            type: 'string',
            description: 'active workspace 内的文件路径，用于文件模式或消歧',
          },
          includeCode: { type: 'boolean' },
          offset: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 2000 },
          symbolsOnly: { type: 'boolean' },
        },
        required: [],
        anyOf: [
          { type: 'object', required: ['symbol'] },
          { type: 'object', required: ['file'] },
        ],
        additionalProperties: false,
      };
    case 'codegraph_callers':
      return {
        type: 'object',
        properties: {
          workspaceRoot: { type: 'string', description: '可选：当前 active workspace 内的根目录' },
          symbol: { type: 'string', description: '要查找调用方的符号名' },
          file: { type: 'string', description: 'active workspace 内的文件路径，用于消歧' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['symbol'],
        additionalProperties: false,
      };
    case 'codegraph_impact':
      return {
        type: 'object',
        properties: {
          workspaceRoot: { type: 'string', description: '可选：当前 active workspace 内的根目录' },
          symbol: { type: 'string', description: '影响面遍历起点符号' },
          file: { type: 'string', description: 'active workspace 内的文件路径，用于消歧' },
          maxDepth: { type: 'integer', minimum: 1, maximum: 5 },
          maxResults: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['symbol'],
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
      return buildDesktopAutomationParameters();
    case 'desktop_control':
      return buildDesktopControlParameters();
    case 'computer_use':
      return {
        type: 'object',
        properties: {
          instruction: {
            type: 'string',
            description: '用自然语言描述要让系统桌面完成的任务，例如「打开系统设置」。',
          },
          maxSteps: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: '最大循环步数（可选，1–100）；省略时由主循环使用默认上限。',
          },
        },
        required: ['instruction'],
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
              '可选的明确 toolCallId，来自当前会话中之前的 tool_result 引用；有时优先使用它',
          },
          toolCallRef: {
            type: 'string',
            pattern: '^[a-f0-9]{64}$',
            description: '超长 toolCallId 的稳定 SHA-256 引用，来自 tool_output_reference',
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
            description:
              '未传 category 时必填。**不要**同时传 category 和 subagent_type。常用选型：explore（代码库内搜索定位）/ librarian（代码库与官方文档检索、实现示例）/ scout（外部依赖源码、上游仓库与第三方文档的只读研究）/ web-researcher（联网新闻、资讯与公开网页检索；多来源交叉比对，只读）/ general（通用研究与多步执行）。**联网资讯/新闻检索派 web-researcher，不要派 scout**。其他内置或自定义 agent 也可直接传 id。',
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
              'Base64 图片字节、data:URL，或 HTTP/HTTPS 远程图片 URL。file_path 与 image_data 只允许传其一。',
          },
          goal: {
            type: 'string',
            description: '简明指出希望从输入中提取什么。',
          },
          offset: {
            type: 'number',
            description:
              'PDF 文本的起始行号（从 1 开始，默认 1）。仅当上一次结果被截断并提示 Use offset=... 时用于续读。',
          },
        },
        required: [],
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
    case 'convert_media':
      return {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: '媒体来源：artifactId、data:URL 或 HTTP/HTTPS 远程 URL',
          },
          targetFormat: {
            type: 'string',
            enum: [
              'mp3',
              'wav',
              'ogg',
              'aac',
              'flac',
              'm4a',
              'mp4',
              'webm',
              'mkv',
              'mov',
              'avi',
              'gif',
              'png',
              'jpg',
              'webp',
              'weba',
            ],
            description: '目标格式',
          },
          videoQuality: {
            type: 'integer',
            minimum: 0,
            maximum: 51,
            description: '视频编码质量 CRF 值（0-51，越低质量越高，默认 23）',
          },
          audioBitrate: { type: 'string', description: '音频比特率，如 "128k"' },
          videoScale: { type: 'string', description: '视频分辨率缩放，如 "1280:-1"' },
          videoFps: { type: 'integer', minimum: 1, maximum: 60, description: '视频帧率' },
          startTime: { type: 'number', minimum: 0, description: '截取起始时间（秒）' },
          duration: { type: 'number', minimum: 0, description: '截取持续时间（秒）' },
        },
        required: ['source', 'targetFormat'],
        additionalProperties: false,
      };
    case 'extract_media_info':
      return {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: '媒体来源：artifactId、data:URL 或 HTTP/HTTPS 远程 URL',
          },
        },
        required: ['source'],
        additionalProperties: false,
      };
    case 'extract_video_frame':
      return {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: '视频来源：artifactId、data:URL 或 HTTP/HTTPS 远程 URL',
          },
          timestamp: {
            type: 'number',
            minimum: 0,
            description: '提取帧的时间戳（秒），默认取第 1 秒',
          },
          count: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
            description: '提取多帧的数量（1-10），均匀分布',
          },
          width: {
            type: 'integer',
            minimum: 16,
            maximum: 3840,
            description: '输出帧的宽度（像素），高度自动等比缩放',
          },
          format: {
            type: 'string',
            enum: ['png', 'jpg'],
            description: '输出图片格式：png（默认）或 jpg',
          },
        },
        required: ['source'],
        additionalProperties: false,
      };
    case 'generate_audio':
      return {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '要转为语音的文本内容，支持中英文混合，最长 5000 字符',
          },
          voice: {
            type: 'string',
            enum: [
              'zh-CN-XiaoxiaoNeural',
              'zh-CN-YunxiNeural',
              'zh-CN-YunyangNeural',
              'zh-CN-XiaoyiNeural',
              'zh-CN-YunjianNeural',
              'en-US-AriaNeural',
              'en-US-GuyNeural',
              'en-US-JennyNeural',
            ],
            description: '语音角色，默认 zh-CN-XiaoxiaoNeural',
          },
          rate: { type: 'number', minimum: 0.5, maximum: 2, description: '语速倍率，1.0=正常速度' },
          volume: { type: 'number', minimum: 0, maximum: 1, description: '音量 0-1，默认 1.0' },
          pitch: { type: 'string', description: '音调调整，如 "+10Hz" 或 "-5Hz"' },
          outputFormat: {
            type: 'string',
            enum: ['mp3', 'wav'],
            description: '输出格式：mp3（默认）或 wav',
          },
        },
        required: ['text'],
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
    case 'mcp_manage_servers':
      return {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'add', 'update', 'remove', 'enable', 'disable'],
            description:
              '管理动作：list 列举；add/update 新增或覆盖；remove 移除；enable/disable 启停。',
          },
          server: {
            type: 'object',
            description:
              'add/update 时的服务器定义。内置 MCP（websearch / grep_app / codegraph / git_bash / lsp / omo）只接受 name 与 disabledTools。',
            properties: {
              id: {
                type: 'string',
                description: '服务器 id（小写字母 / 数字 / 短横线）；省略时由 name 生成。',
              },
              name: { type: 'string', description: '显示名称' },
              transport: { type: 'string', enum: ['sse', 'stdio'] },
              url: { type: 'string', description: 'sse 传输的完整 URL' },
              command: { type: 'string', description: 'stdio 传输的可执行命令' },
              args: { type: 'array', items: { type: 'string' } },
              cwd: { type: 'string', description: 'stdio 工作目录' },
              env: {
                type: 'object',
                additionalProperties: { type: 'string' },
                description: 'stdio 环境变量',
              },
              headers: {
                type: 'object',
                additionalProperties: { type: 'string' },
                description: 'sse 请求头（如 API Key）',
              },
              required: { type: 'boolean' },
              disabledTools: {
                type: 'array',
                items: { type: 'string' },
                description: '要禁用的工具名列表',
              },
              oauth: {
                description: 'OAuth 配置；false 表示显式关闭。省略时沿用原值。',
                oneOf: [
                  { type: 'boolean', enum: [false] },
                  {
                    type: 'object',
                    properties: {
                      clientId: { type: 'string' },
                      clientSecret: { type: 'string' },
                      scope: { type: 'string' },
                      redirectUri: { type: 'string' },
                    },
                    additionalProperties: false,
                  },
                ],
              },
            },
            required: ['name', 'transport'],
            additionalProperties: false,
          },
          serverId: {
            type: 'string',
            description: 'update/remove/enable/disable 的目标服务器 id。',
          },
          enabled: {
            type: 'boolean',
            description: 'add/update 时可显式指定启用状态；省略时保留原值（新增默认启用）。',
          },
        },
        required: ['action'],
        additionalProperties: false,
      };
    case 'memory_manage':
      return {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'add', 'update', 'delete'],
            description: '管理动作：list 检索/列举；add 新增；update 修改；delete 删除。',
          },
          memoryId: { type: 'string', description: 'update/delete 的目标记忆 id。' },
          memory: {
            type: 'object',
            description: '记忆内容。add 必须提供 type / key / value；update 可只传要修改的字段。',
            properties: {
              type: {
                type: 'string',
                enum: ['preference', 'fact', 'instruction', 'project_context', 'learned_pattern'],
              },
              key: { type: 'string', description: '记忆键（1–200 字符）。' },
              value: { type: 'string', description: '记忆内容（1–4000 字符）。' },
              priority: { type: 'integer', minimum: 0, maximum: 100 },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              workspaceRoot: {
                type: ['string', 'null'],
                description: '限定到某个工作区路径（可选）。',
              },
              roleLayers: {
                type: ['array', 'null'],
                items: {
                  type: 'string',
                  enum: ['reception', 'pm1', 'pm2', 'executor', 'reviewer'],
                },
              },
              enabled: { type: 'boolean', description: 'update 时可启停该记忆。' },
            },
            additionalProperties: false,
          },
          search: { type: 'string', description: 'list 的 key/value 关键词过滤。' },
          type: {
            type: 'string',
            enum: ['preference', 'fact', 'instruction', 'project_context', 'learned_pattern'],
            description: 'list 的类型过滤。',
          },
          enabled: { type: 'boolean', description: 'list 的启用态过滤。' },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'list 返回上限，默认 50。',
          },
        },
        required: ['action'],
        additionalProperties: false,
      };
    case 'skill_manage':
      return {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'install', 'uninstall', 'enable', 'disable'],
            description: '管理动作：list 列举；install 安装；uninstall 卸载；enable/disable 启停。',
          },
          skillId: {
            type: 'string',
            description:
              '目标技能 id（list 之外必填）。install 仅支持已配置注册源技能；github: / claude-marketplace: 前缀请在设置页安装。',
          },
          sourceId: {
            type: 'string',
            description: 'install 时可指定注册源 id；省略时由注册源解析。',
          },
        },
        required: ['action'],
        additionalProperties: false,
      };
    case 'plugin_manage':
      return {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'list',
              'search',
              'source_list',
              'install',
              'uninstall',
              'enable',
              'disable',
              'reload',
              'source_add',
              'source_remove',
            ],
            description:
              '管理动作：list 已安装插件；search 搜索市场；source_list/source_add/source_remove 市场来源；install 安装；uninstall 卸载；enable/disable 启停；reload 重载。',
          },
          query: { type: 'string', description: 'search 的关键字（可选）。' },
          sourceId: {
            type: 'string',
            description: '市场条目来源 id（owner/repo，install 与 source_remove 用）。',
          },
          name: { type: 'string', description: '市场条目插件名（install 与 sourceId 配套）。' },
          repo: {
            type: 'string',
            description:
              'GitHub 仓库（owner/repo 或 owner/repo@ref）；install 直装与 source_add 用。',
          },
          path: { type: 'string', description: '仓库内插件路径（install，可选）。' },
          ref: { type: 'string', description: '分支 / tag（install 与 source_add，可选）。' },
          installId: {
            type: 'string',
            description: '已安装插件目录名（uninstall / reload 必填）。',
          },
          pluginId: { type: 'string', description: '插件 id（enable / disable 必填）。' },
        },
        required: ['action'],
        additionalProperties: false,
      };
    case 'schedule_manage':
      return {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'add', 'update', 'remove', 'enable', 'disable', 'history'],
            description:
              '管理动作：list 列举；add 新建；update 修改；remove 删除；enable/disable 启停；history 执行历史。',
          },
          jobId: { type: 'string', description: 'list 之外的目标任务 id。' },
          job: {
            type: 'object',
            description: 'add 必须提供 name / schedule_kind / prompt；update 可只传要修改的字段。',
            properties: {
              name: { type: 'string' },
              schedule_kind: { type: 'string', enum: ['at', 'every', 'cron'] },
              schedule_at: {
                type: ['number', 'null'],
                description: 'at 调度的一次性触发时间（epoch 毫秒）。',
              },
              schedule_every: {
                type: ['number', 'null'],
                description: 'every 调度的间隔毫秒数。',
              },
              schedule_expr: {
                type: ['string', 'null'],
                description: 'cron 调度的 5 段表达式（分 时 日 月 周）。',
              },
              schedule_tz: { type: 'string', description: 'IANA 时区，默认 UTC。' },
              prompt: { type: 'string', description: '到点执行的任务提示词。' },
              agent_id: { type: ['string', 'null'] },
              model: { type: ['string', 'null'] },
              working_folder: { type: ['string', 'null'] },
              session_id: { type: ['string', 'null'] },
              delivery_mode: { type: 'string', enum: ['desktop', 'session', 'none'] },
              delivery_target: { type: ['string', 'null'] },
              plugin_id: { type: ['string', 'null'] },
              plugin_chat_id: { type: ['string', 'null'] },
              enabled: { type: 'boolean' },
              delete_after_run: { type: 'boolean', description: '一次性任务执行后自动删除。' },
              max_iterations: { type: 'integer', minimum: 1, maximum: 100 },
            },
            additionalProperties: false,
          },
        },
        required: ['action'],
        additionalProperties: false,
      };
    case 'agent_manage':
      return {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'create', 'update', 'delete', 'reset'],
            description:
              '管理动作：list 列举；create 新建；update 修改；delete 删除；reset 恢复默认。',
          },
          agentId: { type: 'string', description: 'update/delete/reset 的目标 Agent id。' },
          agent: {
            type: 'object',
            description:
              'create 需要 label 与 systemPrompt（可含 description / aliases / canonicalRole / model / variant / fallbackModels / note / enabled）；update 只需提供要改的字段。',
            additionalProperties: true,
          },
        },
        required: ['action'],
        additionalProperties: false,
      };
    case 'team_workspace_manage':
      return {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'create', 'update', 'delete'],
            description: '管理动作：list 列举；create 新建；update 修改；delete 删除。',
          },
          workspaceId: { type: 'string', description: 'update/delete 的目标工作区 id。' },
          workspace: {
            type: 'object',
            description:
              'create 需要 name；update 只需提供要改的字段。defaultTeamRoster 槽位需完整字段，能力绑定 skillIds/mcpServerIds 必须已安装/已配置。',
            properties: {
              name: { type: 'string' },
              description: { type: ['string', 'null'] },
              visibility: { type: 'string', enum: ['open', 'closed', 'private'] },
              defaultWorkingRoot: { type: ['string', 'null'] },
              defaultTeamRoster: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
                description:
                  '成员槽位数组；每项需 id / layer / specialty / displayName / personaKey / toolsets / required。',
              },
            },
            additionalProperties: false,
          },
        },
        required: ['action'],
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
              '要查看的目录绝对路径（代替缓存仓库）。除非 OPENAWORK_REPO_OVERVIEW_ALLOW_ANY_PATH=1，否则必须位于 repos 缓存根目录或已配置的 workspace root 内',
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
    case 'models':
      return {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '要在模型名称与 ID 中搜索的文本，按空白拆分为多个关键词。',
          },
          provider: {
            type: 'string',
            description: '按 Provider ID 或名称过滤；建议先试自身所在 Provider。',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: '返回的模型数量上限，默认 20。',
          },
          offset: {
            type: 'integer',
            minimum: 0,
            description: '分页偏移量，默认 0。',
          },
        },
        required: [],
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
      return {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: true,
      };
  }
}
