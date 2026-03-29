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
import { websearchTool } from './tool-aliases.js';
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
  webfetchTool,
  ...LSP_TOOLS,
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
      name: tool.name,
      description: tool.description,
      parameters: buildParameters(tool),
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
    case 'list':
      return {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'The absolute path to the directory to list (must be absolute, not relative)',
          },
          ignore: {
            type: 'array',
            description: 'List of glob patterns to ignore',
            items: { type: 'string' },
          },
        },
        required: [],
        additionalProperties: false,
      };
    case 'read':
      return {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'The absolute path to the file or directory to read',
          },
          offset: {
            type: 'integer',
            minimum: 1,
            description: 'The line number to start reading from (1-indexed)',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            description: 'The maximum number of lines to read (defaults to 2000)',
          },
        },
        required: ['filePath'],
        additionalProperties: false,
      };
    case 'glob':
      return {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'The glob pattern to match files against' },
          path: {
            type: 'string',
            description:
              'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
          },
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
          command: { type: 'string', description: 'The command to execute' },
          timeout: {
            type: 'integer',
            minimum: 1,
            maximum: 120000,
            description: 'Optional timeout in milliseconds',
          },
          workdir: {
            type: 'string',
            description:
              "The working directory to run the command in. Defaults to /home/await/project/OpenAWork. Use this instead of 'cd' commands.",
          },
          description: {
            type: 'string',
            description:
              "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
          },
        },
        required: ['command', 'description'],
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
          description: { type: 'string' },
          prompt: { type: 'string' },
          subagent_type: { type: 'string' },
          category: { type: 'string' },
          load_skills: {
            type: 'array',
            items: { type: 'string' },
          },
          run_in_background: { type: 'boolean' },
          session_id: { type: 'string' },
          task_id: { type: 'string' },
          command: { type: 'string' },
        },
        required: ['description', 'prompt'],
        additionalProperties: false,
      };
    case 'grep':
      return {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The regex pattern to search for in file contents',
          },
          path: {
            type: 'string',
            description: 'The directory to search in. Defaults to the current working directory.',
          },
          include: {
            type: 'string',
            description: 'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")',
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
          content: {
            type: 'string',
            description: 'UTF-8 content to write into the file. Overwrites existing files.',
          },
        },
        required: ['path', 'content'],
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
