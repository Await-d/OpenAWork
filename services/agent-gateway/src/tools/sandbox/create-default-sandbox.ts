import { sqliteGet } from '../../infra/db.js';
import { logGatewayWarn } from '../../infra/gateway-logger.js';
import { getPluginToolRegistry } from '../../plugin/tool-registry.js';
import { readWebsearchPolicy, WEBSEARCH_POLICY_KEY } from '../../provider/websearch-policy.js';
import { DEFAULT_TOOL_TIMEOUT_MS, TOOL_WHITELIST, ToolSandbox } from '../tool-sandbox.js';
import { gatewayLspDiagnosticsTool, gatewayLspTouchTool } from './context.js';
import { applyPatchToolDefinition } from '../apply-patch-tools.js';
import { astGrepReplaceToolDefinition, astGrepSearchToolDefinition } from '../ast-grep-tools.js';
import { codesearchToolDefinition } from '../codesearch-tools.js';
import { createEditTool } from '../edit-tools.js';
import { interactiveBashToolDefinition } from '../interactive-bash-tools.js';
import { repoCloneToolDefinition } from '../repo-clone-tools.js';
import { repoOverviewToolDefinition } from '../repo-overview-tools.js';
import {
  lspCallHierarchyToolDefinition,
  lspFindReferencesToolDefinition,
  lspGotoDefinitionToolDefinition,
  lspGotoImplementationToolDefinition,
  lspHoverToolDefinition,
  lspPrepareRenameToolDefinition,
  lspRenameToolDefinition,
  lspSymbolsToolDefinition,
} from '../lsp-tools.js';
import { createMultiEditTool } from '../multi-edit-tool.js';
import { createWebsearchTool, websearchTool } from '../tool-aliases.js';
import { webfetchTool } from '../web-tools.js';
import {
  globTool,
  grepTool,
  listTool,
  readTool,
  workspaceCreateDirectoryTool,
  workspaceReviewDiffTool,
  workspaceReviewRevertTool,
  workspaceReviewStatusTool,
  writeTool,
} from '../workspace-tools.js';
export interface CreateDefaultSandboxOptions {
  /**
   * When supplied, the sandbox registers a user-aware `websearch`
   * tool that consults the persisted `WEBSEARCH_POLICY_KEY` row
   * before falling back to the legacy single-provider call. Callers
   * that have no user context (verification scripts, ad-hoc tools)
   * keep the legacy registration so behaviour is unchanged.
   */
  userId?: string;
}

export function createDefaultSandbox(
  allowedTools: string[] = [],
  options: CreateDefaultSandboxOptions = {},
): ToolSandbox {
  const editTool = createEditTool('__sandbox__', '__sandbox__', '__sandbox__');
  const sandbox = new ToolSandbox({
    allowedTools: [...allowedTools, ...TOOL_WHITELIST],
    defaultTimeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
  });
  // v2 plugin platform: plugin-contributed tool names join the whitelist;
  // execution dispatches to the plugin executor inside
  // `executeGatewayManagedToolImpl`. Sandboxes are rebuilt every turn, so
  // plugin tool changes take effect on the next turn.
  for (const entry of getPluginToolRegistry().listDefinitions()) {
    sandbox.registerPluginToolName(entry.definition.name);
  }
  // P2-WEBSEARCH: when we know the caller, swap in the factory
  // variant that consults `user_settings.websearch_policy` and falls
  // back to the legacy single-provider path otherwise. The resolver
  // is invoked per-call so a `PUT /settings/websearch` takes effect
  // for the very next tool invocation without rebuilding sandboxes.
  if (options.userId) {
    const userId = options.userId;
    const userAwareWebsearchTool = createWebsearchTool({
      resolveMultiConfig: () => {
        try {
          const row = sqliteGet<{ value: string }>(
            `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
            [userId, WEBSEARCH_POLICY_KEY],
          );
          if (!row?.value) return null;
          let parsed: unknown;
          try {
            parsed = JSON.parse(row.value);
          } catch {
            return null;
          }
          const policy = readWebsearchPolicy(parsed);
          // `readWebsearchPolicy` always returns a defaulted shape;
          // we only forward to the multi-call path when the user
          // actually opted in (≥1 provider configured).
          if (policy.providers.length === 0) return null;
          return {
            providers: policy.providers,
            rolloutMode: policy.rolloutMode,
            ...(policy.timeoutMs !== undefined ? { timeoutMs: policy.timeoutMs } : {}),
          };
        } catch (err) {
          logGatewayWarn('[websearch-policy] resolve failed —', String(err));
          return null;
        }
      },
    });
    sandbox.register<
      typeof userAwareWebsearchTool.inputSchema,
      typeof userAwareWebsearchTool.outputSchema
    >(userAwareWebsearchTool);
  } else {
    sandbox.register<typeof websearchTool.inputSchema, typeof websearchTool.outputSchema>(
      websearchTool,
    );
  }
  sandbox.register<
    typeof codesearchToolDefinition.inputSchema,
    typeof codesearchToolDefinition.outputSchema
  >(codesearchToolDefinition);
  sandbox.register<typeof webfetchTool.inputSchema, typeof webfetchTool.outputSchema>(webfetchTool);
  sandbox.register<
    typeof applyPatchToolDefinition.inputSchema,
    typeof applyPatchToolDefinition.outputSchema
  >(applyPatchToolDefinition);
  sandbox.register<typeof editTool.inputSchema, typeof editTool.outputSchema>(editTool);
  const multiEditTool = createMultiEditTool('__sandbox__', '__sandbox__', '__sandbox__');
  sandbox.register<typeof multiEditTool.inputSchema, typeof multiEditTool.outputSchema>(
    multiEditTool,
  );
  sandbox.register<
    typeof gatewayLspDiagnosticsTool.inputSchema,
    typeof gatewayLspDiagnosticsTool.outputSchema
  >(gatewayLspDiagnosticsTool);
  sandbox.register<typeof gatewayLspTouchTool.inputSchema, typeof gatewayLspTouchTool.outputSchema>(
    gatewayLspTouchTool,
  );
  sandbox.register<
    typeof lspGotoDefinitionToolDefinition.inputSchema,
    typeof lspGotoDefinitionToolDefinition.outputSchema
  >(lspGotoDefinitionToolDefinition);
  sandbox.register<
    typeof lspGotoImplementationToolDefinition.inputSchema,
    typeof lspGotoImplementationToolDefinition.outputSchema
  >(lspGotoImplementationToolDefinition);
  sandbox.register<
    typeof lspFindReferencesToolDefinition.inputSchema,
    typeof lspFindReferencesToolDefinition.outputSchema
  >(lspFindReferencesToolDefinition);
  sandbox.register<
    typeof lspSymbolsToolDefinition.inputSchema,
    typeof lspSymbolsToolDefinition.outputSchema
  >(lspSymbolsToolDefinition);
  sandbox.register<
    typeof lspPrepareRenameToolDefinition.inputSchema,
    typeof lspPrepareRenameToolDefinition.outputSchema
  >(lspPrepareRenameToolDefinition);
  sandbox.register<
    typeof lspRenameToolDefinition.inputSchema,
    typeof lspRenameToolDefinition.outputSchema
  >(lspRenameToolDefinition);
  sandbox.register<
    typeof lspHoverToolDefinition.inputSchema,
    typeof lspHoverToolDefinition.outputSchema
  >(lspHoverToolDefinition);
  sandbox.register<
    typeof lspCallHierarchyToolDefinition.inputSchema,
    typeof lspCallHierarchyToolDefinition.outputSchema
  >(lspCallHierarchyToolDefinition);
  sandbox.register<typeof listTool.inputSchema, typeof listTool.outputSchema>(listTool);
  sandbox.register<typeof readTool.inputSchema, typeof readTool.outputSchema>(readTool);
  sandbox.register<typeof globTool.inputSchema, typeof globTool.outputSchema>(globTool);
  sandbox.register<typeof grepTool.inputSchema, typeof grepTool.outputSchema>(grepTool);
  sandbox.register<
    typeof astGrepSearchToolDefinition.inputSchema,
    typeof astGrepSearchToolDefinition.outputSchema
  >(astGrepSearchToolDefinition);
  sandbox.register<
    typeof astGrepReplaceToolDefinition.inputSchema,
    typeof astGrepReplaceToolDefinition.outputSchema
  >(astGrepReplaceToolDefinition);
  sandbox.register<
    typeof workspaceReviewStatusTool.inputSchema,
    typeof workspaceReviewStatusTool.outputSchema
  >(workspaceReviewStatusTool);
  sandbox.register<
    typeof workspaceReviewDiffTool.inputSchema,
    typeof workspaceReviewDiffTool.outputSchema
  >(workspaceReviewDiffTool);
  sandbox.register<typeof writeTool.inputSchema, typeof writeTool.outputSchema>(writeTool);
  sandbox.register<
    typeof workspaceCreateDirectoryTool.inputSchema,
    typeof workspaceCreateDirectoryTool.outputSchema
  >(workspaceCreateDirectoryTool);
  sandbox.register<
    typeof workspaceReviewRevertTool.inputSchema,
    typeof workspaceReviewRevertTool.outputSchema
  >(workspaceReviewRevertTool);
  sandbox.register<
    typeof interactiveBashToolDefinition.inputSchema,
    typeof interactiveBashToolDefinition.outputSchema
  >(interactiveBashToolDefinition);
  sandbox.register<
    typeof repoCloneToolDefinition.inputSchema,
    typeof repoCloneToolDefinition.outputSchema
  >(repoCloneToolDefinition);
  sandbox.register<
    typeof repoOverviewToolDefinition.inputSchema,
    typeof repoOverviewToolDefinition.outputSchema
  >(repoOverviewToolDefinition);
  return sandbox;
}
