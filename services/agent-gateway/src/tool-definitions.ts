import { LSP_TOOLS, webSearchTool } from '@openAwork/agent-core';
import {
  globTool,
  grepTool,
  listTool,
  readTool,
  workspaceCreateDirectoryTool,
  workspaceCreateFileTool,
  workspaceReadFileTool,
  workspaceReviewRevertTool,
  workspaceReviewDiffTool,
  workspaceReviewStatusTool,
  workspaceSearchTool,
  workspaceTreeTool,
  workspaceWriteFileTool,
  writeTool,
} from './workspace-tools.js';
import {
  fileReadTool,
  fileWriteTool,
  readFileTool,
  websearchTool,
  writeFileTool,
} from './tool-aliases.js';
import { codesearchToolDefinition } from './codesearch-tools.js';
import { subTodoReadTool, subTodoWriteTool, todoReadTool, todoWriteTool } from './todo-tools.js';
import { webfetchTool } from './web-tools.js';
import { createEditTool } from './edit-tools.js';
import { batchToolDefinition } from './batch-tools.js';
import { createSkillTool } from './skill-tools.js';
import { bashToolDefinition } from './bash-tools.js';
import { applyPatchToolDefinition } from './apply-patch-tools.js';
import { questionToolDefinition } from './question-tools.js';
import { taskToolDefinition } from './task-tools.js';
import { readToolOutputToolDefinition } from './tool-output-tools.js';
import {
  backgroundCancelToolDefinition,
  backgroundOutputToolDefinition,
} from './background-task-tools.js';
import {
  sessionInfoToolDefinition,
  sessionListToolDefinition,
  sessionReadToolDefinition,
  sessionSearchToolDefinition,
} from './session-manager-tools.js';
import { astGrepReplaceToolDefinition, astGrepSearchToolDefinition } from './ast-grep-tools.js';
import { interactiveBashToolDefinition } from './interactive-bash-tools.js';
import { callOmoAgentToolDefinition } from './call-omo-agent-tools.js';
import { skillMcpToolDefinition } from './skill-mcp-tools.js';
import { lookAtToolDefinition } from './look-at-tools.js';
import {
  lspFindReferencesToolDefinition,
  lspGotoDefinitionToolDefinition,
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
import {
  buildToolSurface,
  filterToolDefinitionsForSurface,
  isValidProfileName,
} from './claude-code-tool-surface.js';
import type { ClaudeCodeProfileName } from './claude-code-tool-surface-profiles.js';

const CLAUDE_FIRST_VISIBLE_NAME_OVERRIDES = {
  skill: 'Skill',
  question: 'AskUserQuestion',
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
  description:
    'List enabled MCP servers and the tools available on each server for the current user.',
} as const;

const MCP_CALL_DEFINITION = {
  name: 'mcp_call',
  description:
    'Call a configured MCP server tool for the current user after permission approval. Use mcp_list_tools first to discover valid serverId and toolName pairs.',
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
  };
}

const editTool = createEditTool('__tool-definitions__');
const skillTool = createSkillTool('__tool-definitions__', '__tool-definitions__');

const MODEL_VISIBLE_GATEWAY_TOOLS = [
  websearchTool,
  codesearchToolDefinition,
  webfetchTool,
  ...LSP_TOOLS,
  lspGotoDefinitionToolDefinition,
  lspFindReferencesToolDefinition,
  lspSymbolsToolDefinition,
  lspPrepareRenameToolDefinition,
  lspRenameToolDefinition,
  taskCreateToolDefinition,
  taskGetToolDefinition,
  taskListToolDefinition,
  taskUpdateToolDefinition,
  listTool,
  readTool,
  globTool,
  grepTool,
  editTool,
  skillTool,
  batchToolDefinition,
  bashToolDefinition,
  applyPatchToolDefinition,
  questionToolDefinition,
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
] as const;

const LEGACY_COMPATIBILITY_TOOLS = [
  webSearchTool,
  fileReadTool,
  readFileTool,
  fileWriteTool,
  writeFileTool,
  workspaceTreeTool,
  workspaceReadFileTool,
  workspaceSearchTool,
  workspaceWriteFileTool,
  workspaceCreateFileTool,
] as const;

export function buildGatewayToolDefinitions(): GatewayToolDefinition[] {
  return MODEL_VISIBLE_GATEWAY_TOOLS.map((tool) => ({
    type: 'function',
    function: {
      name: getVisibleToolName(tool.name),
      description: tool.description,
      parameters: buildParameters({ ...tool, name: getVisibleToolName(tool.name) }),
      strict: false,
    },
  }));
}

export function forEachDefaultGatewayTool(
  register: (tool: (typeof MODEL_VISIBLE_GATEWAY_TOOLS)[number]) => void,
): void {
  for (const tool of MODEL_VISIBLE_GATEWAY_TOOLS) {
    register(tool);
  }
}

export function buildGatewayToolDefinitionsForProfile(profile: string): GatewayToolDefinition[] {
  const resolvedProfile: ClaudeCodeProfileName = isValidProfileName(profile)
    ? profile
    : 'openawork';
  const surface = buildToolSurface(resolvedProfile);
  return filterToolDefinitionsForSurface(buildGatewayToolDefinitions(), surface);
}

export function forEachLegacyCompatibilityTool(
  register: (tool: (typeof LEGACY_COMPATIBILITY_TOOLS)[number]) => void,
): void {
  for (const tool of LEGACY_COMPATIBILITY_TOOLS) {
    register(tool);
  }
}

function buildParameters(tool: GatewayToolLike): GatewayToolDefinition['function']['parameters'] {
  switch (tool.name) {
    case 'websearch':
      return {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Maximum number of search results to return',
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
          url: { type: 'string', description: 'Fully qualified URL to fetch' },
          format: {
            type: 'string',
            enum: ['markdown', 'text', 'html'],
            description: 'Response format to return',
          },
          timeout: {
            type: 'integer',
            minimum: 1,
            maximum: 120,
            description: 'Fetch timeout in seconds',
          },
        },
        required: ['url'],
        additionalProperties: false,
      };
    case 'Skill':
      return {
        type: 'object',
        properties: {
          skill: { type: 'string', description: 'Installed skill name to execute' },
          args: {
            type: 'string',
            description: 'Optional freeform args string passed by the model',
          },
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
            description: 'Optional metadata or UI annotations for the question flow',
          },
        },
        required: ['questions'],
        additionalProperties: false,
      };
    case 'codesearch':
      return {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Code search query' },
          tokensNum: {
            type: 'integer',
            minimum: 1000,
            maximum: 50000,
            description: 'Approximate number of tokens to return',
          },
        },
        required: ['query'],
        additionalProperties: false,
      };
    case 'lsp_diagnostics':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Optional file path filter' },
        },
        required: [],
        additionalProperties: false,
      };
    case 'lsp_touch':
      return {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Touched file path' },
          waitForDiagnostics: {
            type: 'boolean',
            description: 'Wait for diagnostics before returning',
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
    case 'task_create':
      return {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          description: { type: 'string' },
          blockedBy: { type: 'array', items: { type: 'string' } },
          blocks: { type: 'array', items: { type: 'string' } },
          metadata: { type: 'object' },
          parentID: { type: 'string' },
        },
        required: ['subject'],
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
          subject: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'deleted'] },
          addBlocks: { type: 'array', items: { type: 'string' } },
          addBlockedBy: { type: 'array', items: { type: 'string' } },
          owner: { type: 'string' },
          metadata: { type: 'object' },
        },
        required: ['id'],
        additionalProperties: false,
      };
    case 'list':
      return {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute workspace directory path to inspect' },
          depth: {
            type: 'integer',
            minimum: 1,
            maximum: 4,
            description: 'Maximum directory depth to traverse',
          },
        },
        required: ['path'],
        additionalProperties: false,
      };
    case 'read':
      return {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute workspace file path to read' },
          filePath: { type: 'string', description: 'Legacy alias for path' },
        },
        required: [],
        additionalProperties: false,
      };
    case 'glob':
      return {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional workspace directory path to search' },
          pattern: { type: 'string', description: 'Glob pattern used to match workspace files' },
        },
        required: ['pattern'],
        additionalProperties: false,
      };
    case 'edit':
      return {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Absolute workspace file path to edit' },
          oldString: {
            type: 'string',
            description:
              'Exact text to replace. Read the file first and match indentation exactly.',
          },
          newString: { type: 'string', description: 'Replacement text to write into the file' },
          replaceAll: {
            type: 'boolean',
            description: 'When true, replace every exact occurrence of oldString',
          },
        },
        required: ['filePath', 'oldString', 'newString'],
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
                tool: { type: 'string', description: 'Registered runtime tool name to execute' },
                parameters: {
                  type: 'object',
                  description: 'Input object to pass to the selected tool',
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
          name: { type: 'string', description: 'Exact installed skill name to load' },
        },
        required: ['name'],
        additionalProperties: false,
      };
    case 'bash':
      return {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Single-line shell command to run' },
          timeout: {
            type: 'integer',
            minimum: 1,
            maximum: 120000,
            description: 'Command timeout in milliseconds',
          },
          workdir: {
            type: 'string',
            description: 'Absolute workspace directory to run the command in',
          },
        },
        required: ['command'],
        additionalProperties: false,
      };
    case 'apply_patch':
      return {
        type: 'object',
        properties: {
          patchText: {
            type: 'string',
            description: 'Structured patch text wrapped by *** Begin Patch / *** End Patch',
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
              'Optional explicit toolCallId from a previous tool_result reference in the current session',
          },
          useLatestReferenced: {
            type: 'boolean',
            description:
              'When true and toolCallId is omitted, read the most recent large output that was replaced by a [tool_output_reference] in this session',
          },
          jsonPath: {
            type: 'string',
            description:
              'Optional dot path such as data.items[0] for structured outputs. Use this to drill into a nested field before reading.',
          },
          lineStart: {
            type: 'integer',
            minimum: 1,
            description: 'Starting line number for large text outputs (1-based)',
          },
          lineCount: {
            type: 'integer',
            minimum: 1,
            maximum: 400,
            description: 'How many lines of text to read',
          },
          itemStart: {
            type: 'integer',
            minimum: 0,
            description: 'Starting item index for array outputs (0-based)',
          },
          itemCount: {
            type: 'integer',
            minimum: 1,
            maximum: 200,
            description: 'How many array items to return',
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
            description: 'Short task description (3-5 words)',
          },
          prompt: {
            type: 'string',
            description: 'Full detailed prompt for the agent. Prompts MUST be in English.',
          },
          subagent_type: {
            type: 'string',
            description:
              'REQUIRED if category not provided. Do NOT provide both category and subagent_type.',
          },
          category: {
            type: 'string',
            description:
              'REQUIRED if subagent_type not provided. Do NOT provide both category and subagent_type.',
          },
          load_skills: {
            type: 'array',
            description: 'Skill names to inject. REQUIRED - pass [] if no skills needed.',
            items: { type: 'string' },
          },
          run_in_background: {
            type: 'boolean',
            description:
              'REQUIRED. true=async (returns task_id), false=sync (waits). Use false for task delegation, true ONLY for parallel exploration.',
          },
          session_id: {
            type: 'string',
            description: 'Existing Task session to continue',
          },
          task_id: {
            type: 'string',
            description: 'Legacy resume task id alias for existing child task/session',
          },
          command: {
            type: 'string',
            description: 'The command that triggered this task',
          },
        },
        required: ['description', 'prompt', 'load_skills', 'run_in_background'],
        additionalProperties: false,
      };
    case 'background_output':
      return {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Background task id to inspect' },
          block: {
            type: 'boolean',
            description: 'Wait until the task finishes before returning',
          },
          full_session: {
            type: 'boolean',
            description: 'Return filtered child-session messages instead of only task summary',
          },
          include_thinking: {
            type: 'boolean',
            description: 'Include assistant thinking blocks when full_session=true',
          },
          include_tool_results: {
            type: 'boolean',
            description: 'Include tool result messages when full_session=true',
          },
          message_limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'Maximum number of messages to return',
          },
          since_message_id: {
            type: 'string',
            description: 'Only return messages after this message id',
          },
          thinking_max_chars: {
            type: 'integer',
            minimum: 1,
            maximum: 20000,
            description: 'Maximum characters of thinking text to include per message',
          },
          timeout: {
            type: 'integer',
            minimum: 1,
            maximum: 600000,
            description: 'Maximum wait time in milliseconds when block=true',
          },
        },
        required: ['task_id'],
        additionalProperties: false,
      };
    case 'background_cancel':
      return {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'Task id to cancel. Required when all=false.',
          },
          all: {
            type: 'boolean',
            description:
              'When true, cancel all cancellable background child tasks for this session.',
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
          lang: { type: 'string' },
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
          lang: { type: 'string' },
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
    case 'call_omo_agent':
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
          file_path: { type: 'string' },
          image_data: { type: 'string' },
          goal: { type: 'string' },
        },
        required: ['goal'],
        additionalProperties: false,
      };
    case 'grep':
      return {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for in file contents' },
          path: { type: 'string', description: 'Optional workspace directory path to search' },
          include: {
            type: 'string',
            description: 'Optional glob pattern to include matching files',
          },
          output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'] },
          head_limit: { type: 'integer', minimum: 0, maximum: 500 },
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
            description: 'Absolute workspace root path to inspect git changes',
          },
        },
        required: ['path'],
        additionalProperties: false,
      };
    case 'workspace_review_diff':
      return {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute workspace root path to inspect git diff' },
          filePath: {
            type: 'string',
            description:
              'Changed file path, relative to workspace root or absolute inside the workspace',
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
            description: 'Absolute workspace file path to write, creating the file if missing',
          },
          filePath: { type: 'string', description: 'Legacy alias for path' },
          content: {
            type: 'string',
            description: 'UTF-8 content to write into the file. Overwrites existing files.',
          },
        },
        required: ['content'],
        additionalProperties: false,
      };
    case 'workspace_create_directory':
      return {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute workspace directory path to create' },
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
            description: 'Absolute workspace root path that contains the git change',
          },
          filePath: {
            type: 'string',
            description:
              'Changed file path, relative to workspace root or absolute inside the workspace',
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
            description: 'The updated todo list',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'Brief description of the task' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed', 'cancelled'],
                  description:
                    'Current status of the task: pending, in_progress, completed, cancelled',
                },
                priority: {
                  type: 'string',
                  enum: ['high', 'medium', 'low'],
                  description: 'Priority level of the task: high, medium, low',
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
            description:
              'Optional configured MCP server id to inspect. Omit to list all enabled servers.',
          },
        },
        required: [],
        additionalProperties: false,
      };
    case 'mcp_call':
      return {
        type: 'object',
        properties: {
          serverId: { type: 'string', description: 'Configured MCP server id to call' },
          toolName: {
            type: 'string',
            description: 'MCP tool name exposed by the configured server',
          },
          arguments: {
            type: 'object',
            description: 'JSON object of arguments to send to the MCP tool',
          },
        },
        required: ['serverId', 'toolName', 'arguments'],
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
