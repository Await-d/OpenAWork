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
import { bashToolDefinition } from './bash-tools.js';
import { applyPatchToolDefinition } from './apply-patch-tools.js';
import { questionToolDefinition } from './question-tools.js';
import { taskToolDefinition } from '../task/task-tools.js';
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
import { astGrepReplaceToolDefinition, astGrepSearchToolDefinition } from './ast-grep-tools.js';
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
import { buildChannelToolParameters } from './channel-tool-parameters.js';
import { buildToolParameters } from './tool-parameters/index.js';
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

  return (
    buildToolParameters(tool.name) ?? {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: true,
    }
  );
}
