import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import { ALL_LSP_TOOL_NAMES } from '@openAwork/agent-core';
import type { DiagnosticSummary } from '@openAwork/lsp-client';
import authPlugin from '../auth.js';
import { closeDb, connectDb, migrate, sqliteRun } from '../db.js';
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
import { lspManager } from '../lsp/router.js';
import requestWorkflowPlugin from '../request-workflow.js';
import { capabilitiesRoutes } from '../routes/capabilities.js';
import { buildGatewayToolDefinitions } from '../tool-definitions.js';
import {
  isGatewayToolEnabledForSessionMetadata,
  filterEnabledGatewayToolsForSession,
} from '../session-tool-visibility.js';
import { assert, withTempEnv } from './task-verification-helpers.js';

const LSP_VISIBILITY_CLASSIFICATION: Record<string, 'read' | 'edit'> = {
  lsp_diagnostics: 'read',
  lsp_touch: 'read',
  lsp_goto_definition: 'read',
  lsp_goto_implementation: 'read',
  lsp_find_references: 'read',
  lsp_symbols: 'read',
  lsp_prepare_rename: 'read',
  lsp_rename: 'edit',
  lsp_hover: 'read',
  lsp_call_hierarchy: 'read',
};

const EMPTY_DIAGNOSTICS: Record<string, DiagnosticSummary[]> = {};

async function main(): Promise<void> {
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
    },
    async () => {
      await connectDb();
      await migrate();

      const userId = randomUUID();
      const email = `lsp-verify-${userId}@openawork.local`;

      sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
        userId,
        email,
        'hash',
      ]);

      const app = Fastify();
      await app.register(requestWorkflowPlugin);
      await app.register(authPlugin);
      await app.register(capabilitiesRoutes);
      await app.ready();

      try {
        const accessToken = app.jwt.sign({ sub: userId, email });

        assert(
          ALL_LSP_TOOL_NAMES.length === 10,
          `ALL_LSP_TOOL_NAMES should have 10 entries, got ${String(ALL_LSP_TOOL_NAMES.length)}`,
        );

        const expectedToolNames = [
          'lsp_diagnostics',
          'lsp_touch',
          'lsp_goto_definition',
          'lsp_goto_implementation',
          'lsp_find_references',
          'lsp_symbols',
          'lsp_prepare_rename',
          'lsp_rename',
          'lsp_hover',
          'lsp_call_hierarchy',
        ];

        for (const name of expectedToolNames) {
          assert(
            (ALL_LSP_TOOL_NAMES as readonly string[]).includes(name),
            `ALL_LSP_TOOL_NAMES should include '${name}'`,
          );
        }

        console.log('  ✓ ALL_LSP_TOOL_NAMES has 10 entries');

        const capRes = await app.inject({
          method: 'GET',
          url: '/capabilities',
          headers: { authorization: `Bearer ${accessToken}` },
        });

        assert(
          capRes.statusCode === 200,
          `capabilities route should return 200, got ${String(capRes.statusCode)}`,
        );

        const capBody = JSON.parse(capRes.body) as {
          capabilities: Array<{ id: string; kind: string; description: string }>;
        };

        const toolCapabilities = capBody.capabilities.filter((cap) => cap.kind === 'tool');
        const toolNames = toolCapabilities.map((cap) => cap.id);

        for (const name of expectedToolNames) {
          assert(toolNames.includes(name), `capabilities response should include tool '${name}'`);
        }

        console.log('  ✓ /capabilities response includes all 10 LSP tools');

        const gatewayTools = buildGatewayToolDefinitions();

        for (const name of expectedToolNames) {
          const tool = gatewayTools.find((t) => t.function.name === name);
          assert(tool !== undefined, `gateway tool definitions should include '${name}'`);
          assert(
            typeof tool.function.description === 'string' && tool.function.description.length > 0,
            `tool '${name}' should have a non-empty description`,
          );
          assert(
            tool.function.parameters !== undefined && tool.function.parameters.type === 'object',
            `tool '${name}' should have an object-typed input schema`,
          );
          assert(
            typeof tool.function.parameters.properties === 'object',
            `tool '${name}' should have properties in its input schema`,
          );
          assert(
            Array.isArray(tool.function.parameters.required),
            `tool '${name}' should have a required array in its input schema`,
          );
        }

        console.log('  ✓ all 10 LSP tools have proper descriptions and input schemas');

        const readOnlyChannelMetadata: Record<string, unknown> = {
          source: 'channel',
          channel: {
            tools: {
              read: true,
              edit: false,
              bash: false,
              web_search: false,
              mcp: false,
              task: false,
            },
            permissions: {},
          },
        };

        const editOnlyChannelMetadata: Record<string, unknown> = {
          source: 'channel',
          channel: {
            tools: {
              read: false,
              edit: true,
              bash: false,
              web_search: false,
              mcp: false,
              task: false,
            },
            permissions: {},
          },
        };

        for (const [toolName, expectedKey] of Object.entries(LSP_VISIBILITY_CLASSIFICATION)) {
          if (expectedKey === 'read') {
            assert(
              isGatewayToolEnabledForSessionMetadata(toolName, readOnlyChannelMetadata),
              `tool '${toolName}' should be enabled with read-only channel (classified as '${expectedKey}')`,
            );
            assert(
              !isGatewayToolEnabledForSessionMetadata(toolName, editOnlyChannelMetadata),
              `tool '${toolName}' should be disabled with edit-only channel (classified as '${expectedKey}')`,
            );
          } else {
            assert(
              !isGatewayToolEnabledForSessionMetadata(toolName, readOnlyChannelMetadata),
              `tool '${toolName}' should be disabled with read-only channel (classified as '${expectedKey}')`,
            );
            assert(
              isGatewayToolEnabledForSessionMetadata(toolName, editOnlyChannelMetadata),
              `tool '${toolName}' should be enabled with edit-only channel (classified as '${expectedKey}')`,
            );
          }
        }

        console.log('  ✓ LSP tool visibility: read tools → read, lsp_rename → edit');

        const readOnlyMetadataJson = JSON.stringify(readOnlyChannelMetadata);
        const filteredForReadOnly = filterEnabledGatewayToolsForSession(
          gatewayTools,
          readOnlyMetadataJson,
        );
        const filteredReadNames = filteredForReadOnly.map((t) => t.function.name);

        for (const name of [
          'lsp_diagnostics',
          'lsp_touch',
          'lsp_goto_definition',
          'lsp_goto_implementation',
          'lsp_find_references',
          'lsp_symbols',
          'lsp_prepare_rename',
          'lsp_hover',
          'lsp_call_hierarchy',
        ]) {
          assert(
            filteredReadNames.includes(name),
            `filterEnabledGatewayToolsForSession with read-only should include '${name}'`,
          );
        }

        assert(
          !filteredReadNames.includes('lsp_rename'),
          'filterEnabledGatewayToolsForSession with read-only should exclude lsp_rename',
        );

        console.log('  ✓ filterEnabledGatewayToolsForSession correctly filters LSP tools');

        const originalTouchFile = lspManager.touchFile.bind(lspManager);
        const originalDefinition = lspManager.definition.bind(lspManager);
        const originalImplementation = lspManager.implementation.bind(lspManager);
        const originalReferences = lspManager.references.bind(lspManager);
        const originalWorkspaceSymbols = lspManager.workspaceSymbols.bind(lspManager);
        const originalDocumentSymbols = lspManager.documentSymbols.bind(lspManager);
        const originalPrepareRename = lspManager.prepareRename.bind(lspManager);
        const originalRename = lspManager.rename.bind(lspManager);
        const originalDiagnostics = lspManager.diagnostics.bind(lspManager);
        const originalHover = lspManager.hover.bind(lspManager);
        const originalPrepareCallHierarchy = lspManager.prepareCallHierarchy.bind(lspManager);
        const originalIncomingCalls = lspManager.incomingCalls.bind(lspManager);
        const originalOutgoingCalls = lspManager.outgoingCalls.bind(lspManager);

        try {
          const signal = new AbortController().signal;
          const definitionCalls: string[] = [];
          const definitionFile = '/tmp/verify-lsp-definition.ts';

          lspManager.touchFile = async (path, waitForDiagnostics) => {
            definitionCalls.push(`touch:${path}:${String(waitForDiagnostics)}`);
          };
          lspManager.definition = async ({ file }) => {
            definitionCalls.push(`definition:${file}`);
            return [
              {
                uri: pathToFileURL('/tmp/target-definition.ts').toString(),
                range: {
                  start: { line: 9, character: 2 },
                  end: { line: 9, character: 8 },
                },
              },
            ];
          };

          const definitionResult = await lspGotoDefinitionToolDefinition.execute(
            {
              filePath: definitionFile,
              line: 10,
              character: 2,
            },
            signal,
          );

          assert(
            definitionCalls.join(' -> ') ===
              `touch:${definitionFile}:true -> definition:${definitionFile}`,
            'lsp_goto_definition should touch(true) before definition query',
          );
          assert(
            definitionResult === '/tmp/target-definition.ts:10:2',
            `lsp_goto_definition should format target location, got '${definitionResult}'`,
          );

          console.log('  ✓ semantic query tools pre-touch before execution');

          const implementationCalls: string[] = [];
          lspManager.touchFile = async (path, waitForDiagnostics) => {
            implementationCalls.push(`touch:${path}:${String(waitForDiagnostics)}`);
          };
          lspManager.implementation = async ({ file }) => {
            implementationCalls.push(`implementation:${file}`);
            return [
              {
                uri: pathToFileURL('/tmp/target-impl.ts').toString(),
                range: {
                  start: { line: 19, character: 4 },
                  end: { line: 19, character: 12 },
                },
              },
            ];
          };

          const implementationResult = await lspGotoImplementationToolDefinition.execute(
            {
              filePath: definitionFile,
              line: 10,
              character: 2,
            },
            signal,
          );

          assert(
            implementationCalls.join(' -> ') ===
              `touch:${definitionFile}:true -> implementation:${definitionFile}`,
            'lsp_goto_implementation should touch(true) before implementation query',
          );
          assert(
            implementationResult === '/tmp/target-impl.ts:20:4',
            `lsp_goto_implementation should format target location, got '${implementationResult}'`,
          );

          console.log('  ✓ lsp_goto_implementation positive path: pre-touches, formats location');

          const referencesCalls: Array<{ file: string; includeDeclaration?: boolean }> = [];
          lspManager.touchFile = async () => undefined;
          lspManager.references = async ({ file, includeDeclaration }) => {
            referencesCalls.push({ file, includeDeclaration });
            return [
              {
                uri: pathToFileURL('/tmp/ref-target-a.ts').toString(),
                range: {
                  start: { line: 3, character: 4 },
                  end: { line: 3, character: 10 },
                },
              },
              {
                uri: pathToFileURL('/tmp/ref-target-b.ts').toString(),
                range: {
                  start: { line: 7, character: 0 },
                  end: { line: 7, character: 6 },
                },
              },
            ];
          };

          const referencesResult = await lspFindReferencesToolDefinition.execute(
            {
              filePath: definitionFile,
              line: 5,
              character: 2,
              includeDeclaration: true,
            },
            signal,
          );

          assert(
            referencesResult.includes('/tmp/ref-target-a.ts:4:4'),
            `lsp_find_references should format first location, got '${referencesResult}'`,
          );
          assert(
            referencesResult.includes('/tmp/ref-target-b.ts:8:0'),
            `lsp_find_references should format second location, got '${referencesResult}'`,
          );
          assert(
            referencesCalls.length === 1 && referencesCalls[0]!.includeDeclaration === true,
            'lsp_find_references should pass includeDeclaration=true to lspManager',
          );

          referencesCalls.length = 0;
          const refsExcludeDecl = await lspFindReferencesToolDefinition.execute(
            {
              filePath: definitionFile,
              line: 5,
              character: 2,
              includeDeclaration: false,
            },
            signal,
          );

          const secondCallDeclaration = referencesCalls[0]?.includeDeclaration;
          assert(
            referencesCalls.length === 1 &&
              secondCallDeclaration !== true &&
              secondCallDeclaration !== undefined,
            'lsp_find_references should pass includeDeclaration=false when explicitly set',
          );
          assert(
            typeof refsExcludeDecl === 'string' && refsExcludeDecl.length > 0,
            'lsp_find_references should return formatted results even with includeDeclaration=false',
          );

          console.log(
            '  ✓ lsp_find_references positive path: formats locations, plumbs includeDeclaration',
          );

          lspManager.touchFile = async () => undefined;
          lspManager.workspaceSymbols = async () => [
            {
              name: 'MyClass',
              kind: 5,
              location: {
                uri: pathToFileURL('/tmp/my-class.ts').toString(),
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 7 },
                },
              },
              containerName: 'module',
            },
          ];

          const workspaceSymbolsResult = await lspSymbolsToolDefinition.execute(
            {
              filePath: definitionFile,
              scope: 'workspace',
              query: 'MyClass',
              limit: 10,
            },
            signal,
          );

          assert(
            workspaceSymbolsResult.includes('MyClass (kind 5)'),
            `workspace symbols positive path should format symbol info, got '${workspaceSymbolsResult}'`,
          );
          assert(
            workspaceSymbolsResult.includes('in module'),
            `workspace symbols positive path should include containerName, got '${workspaceSymbolsResult}'`,
          );
          assert(
            workspaceSymbolsResult.includes('/tmp/my-class.ts:1:0'),
            `workspace symbols positive path should include location, got '${workspaceSymbolsResult}'`,
          );

          lspManager.documentSymbols = async () => [
            {
              name: 'doStuff',
              kind: 12,
              range: {
                start: { line: 4, character: 0 },
                end: { line: 10, character: 1 },
              },
              selectionRange: {
                start: { line: 4, character: 9 },
                end: { line: 4, character: 16 },
              },
              children: [
                {
                  name: 'innerVar',
                  kind: 13,
                  range: {
                    start: { line: 5, character: 2 },
                    end: { line: 5, character: 20 },
                  },
                  selectionRange: {
                    start: { line: 5, character: 8 },
                    end: { line: 5, character: 16 },
                  },
                },
              ],
            },
          ];

          const documentSymbolsResult = await lspSymbolsToolDefinition.execute(
            {
              filePath: definitionFile,
              scope: 'document',
              limit: 50,
            },
            signal,
          );

          assert(
            documentSymbolsResult.includes('doStuff (kind 12) - line 5'),
            `document symbols positive path should format DocumentSymbol, got '${documentSymbolsResult}'`,
          );
          assert(
            documentSymbolsResult.includes('  innerVar (kind 13) - line 6'),
            `document symbols positive path should format nested children with indent, got '${documentSymbolsResult}'`,
          );

          console.log(
            '  ✓ lsp_symbols positive path: formats workspace SymbolInfo and document DocumentSymbol with children',
          );

          const callHierarchyCalls: string[] = [];
          const preparedItem = {
            name: 'doWork',
            kind: 12,
            detail: 'function doWork(): void',
            uri: pathToFileURL('/tmp/do-work.ts').toString(),
            range: {
              start: { line: 10, character: 0 },
              end: { line: 15, character: 1 },
            },
            selectionRange: {
              start: { line: 10, character: 9 },
              end: { line: 10, character: 15 },
            },
            data: { opaque: 'keep-me' },
          };
          const incomingRootRefs: unknown[] = [];
          const outgoingRootRefs: unknown[] = [];

          lspManager.touchFile = async (path, waitForDiagnostics) => {
            callHierarchyCalls.push(`touch:${path}:${String(waitForDiagnostics)}`);
          };
          lspManager.prepareCallHierarchy = async ({ file }) => {
            callHierarchyCalls.push(`prepare:${file}`);
            return [preparedItem];
          };
          lspManager.incomingCalls = async ({ item }) => {
            incomingRootRefs.push(item);
            callHierarchyCalls.push('incoming');
            return [
              {
                from: {
                  name: 'callerFn',
                  kind: 12,
                  uri: pathToFileURL('/tmp/caller.ts').toString(),
                  range: {
                    start: { line: 4, character: 0 },
                    end: { line: 8, character: 1 },
                  },
                  selectionRange: {
                    start: { line: 4, character: 9 },
                    end: { line: 4, character: 17 },
                  },
                },
                fromRanges: [{ start: { line: 5, character: 2 }, end: { line: 5, character: 8 } }],
              },
            ];
          };
          lspManager.outgoingCalls = async ({ item }) => {
            outgoingRootRefs.push(item);
            callHierarchyCalls.push('outgoing');
            return [
              {
                to: {
                  name: 'calleeFn',
                  kind: 12,
                  uri: pathToFileURL('/tmp/callee.ts').toString(),
                  range: {
                    start: { line: 20, character: 0 },
                    end: { line: 24, character: 1 },
                  },
                  selectionRange: {
                    start: { line: 20, character: 9 },
                    end: { line: 20, character: 17 },
                  },
                },
                fromRanges: [
                  { start: { line: 11, character: 4 }, end: { line: 11, character: 12 } },
                ],
              },
            ];
          };

          const callHierarchyResult = await lspCallHierarchyToolDefinition.execute(
            {
              filePath: definitionFile,
              line: 11,
              character: 9,
              direction: 'both',
            },
            signal,
          );

          assert(
            callHierarchyCalls.join(' -> ') ===
              `touch:${definitionFile}:true -> prepare:${definitionFile} -> incoming -> outgoing`,
            'lsp_call_hierarchy should touch(true) before prepare/incoming/outgoing sequence',
          );
          assert(
            incomingRootRefs[0] === preparedItem && outgoingRootRefs[0] === preparedItem,
            'lsp_call_hierarchy should pass the exact prepared item (including opaque data) to incoming/outgoing calls',
          );
          assert(
            callHierarchyResult.includes(
              'Symbol: doWork (function doWork(): void) - /tmp/do-work.ts:11:9',
            ),
            `lsp_call_hierarchy should include root symbol heading, got '${callHierarchyResult}'`,
          );
          assert(
            callHierarchyResult.includes('Incoming calls:') &&
              callHierarchyResult.includes('callerFn - /tmp/caller.ts:5:9'),
            `lsp_call_hierarchy should format incoming call section, got '${callHierarchyResult}'`,
          );
          assert(
            callHierarchyResult.includes('Outgoing calls:') &&
              callHierarchyResult.includes('calleeFn - /tmp/callee.ts:21:9'),
            `lsp_call_hierarchy should format outgoing call section, got '${callHierarchyResult}'`,
          );

          lspManager.prepareCallHierarchy = async () => [];
          const noCallHierarchy = await lspCallHierarchyToolDefinition.execute(
            {
              filePath: definitionFile,
              line: 1,
              character: 0,
              direction: 'both',
            },
            signal,
          );
          assert(
            noCallHierarchy === 'No call hierarchy found',
            'lsp_call_hierarchy should degrade cleanly when prepare returns no items',
          );

          lspManager.prepareCallHierarchy = async () => [preparedItem];
          lspManager.incomingCalls = async () => [];
          lspManager.outgoingCalls = async () => [
            {
              to: {
                name: 'onlyOutgoing',
                kind: 12,
                uri: pathToFileURL('/tmp/only-outgoing.ts').toString(),
                range: {
                  start: { line: 30, character: 0 },
                  end: { line: 34, character: 1 },
                },
                selectionRange: {
                  start: { line: 30, character: 9 },
                  end: { line: 30, character: 21 },
                },
              },
              fromRanges: [{ start: { line: 12, character: 2 }, end: { line: 12, character: 14 } }],
            },
          ];
          const noIncomingResult = await lspCallHierarchyToolDefinition.execute(
            {
              filePath: definitionFile,
              line: 11,
              character: 9,
              direction: 'both',
            },
            signal,
          );
          assert(
            noIncomingResult.includes('No incoming calls found') &&
              noIncomingResult.includes('Outgoing calls:') &&
              noIncomingResult.includes('onlyOutgoing - /tmp/only-outgoing.ts:31:9'),
            `lsp_call_hierarchy should preserve outgoing results when incoming is empty, got '${noIncomingResult}'`,
          );

          lspManager.incomingCalls = async () => [
            {
              from: {
                name: 'onlyIncoming',
                kind: 12,
                uri: pathToFileURL('/tmp/only-incoming.ts').toString(),
                range: {
                  start: { line: 40, character: 0 },
                  end: { line: 44, character: 1 },
                },
                selectionRange: {
                  start: { line: 40, character: 9 },
                  end: { line: 40, character: 21 },
                },
              },
              fromRanges: [{ start: { line: 41, character: 2 }, end: { line: 41, character: 14 } }],
            },
          ];
          lspManager.outgoingCalls = async () => [];
          const noOutgoingResult = await lspCallHierarchyToolDefinition.execute(
            {
              filePath: definitionFile,
              line: 11,
              character: 9,
              direction: 'both',
            },
            signal,
          );
          assert(
            noOutgoingResult.includes('Incoming calls:') &&
              noOutgoingResult.includes('onlyIncoming - /tmp/only-incoming.ts:41:9') &&
              noOutgoingResult.includes('No outgoing calls found'),
            `lsp_call_hierarchy should preserve incoming results when outgoing is empty, got '${noOutgoingResult}'`,
          );

          console.log(
            '  ✓ lsp_call_hierarchy positive path, fallback sections, and opaque item passthrough',
          );

          lspManager.definition = async () => [];
          lspManager.implementation = async () => [];
          lspManager.references = async () => [];
          lspManager.workspaceSymbols = async () => [];
          lspManager.documentSymbols = async () => [];
          lspManager.hover = async () => null;

          const noDefinition = await lspGotoDefinitionToolDefinition.execute(
            {
              filePath: definitionFile,
              line: 1,
              character: 0,
            },
            signal,
          );
          const noImplementation = await lspGotoImplementationToolDefinition.execute(
            {
              filePath: definitionFile,
              line: 1,
              character: 0,
            },
            signal,
          );
          const unsupportedLanguageDefinition = await lspGotoDefinitionToolDefinition.execute(
            {
              filePath: '/tmp/verify-lsp-unsupported.txt',
              line: 1,
              character: 0,
            },
            signal,
          );
          const noReferences = await lspFindReferencesToolDefinition.execute(
            {
              filePath: definitionFile,
              line: 1,
              character: 0,
              includeDeclaration: true,
            },
            signal,
          );
          const noWorkspaceSymbols = await lspSymbolsToolDefinition.execute(
            {
              filePath: definitionFile,
              scope: 'workspace',
              query: 'MissingSymbol',
              limit: 10,
            },
            signal,
          );
          const noDocumentSymbols = await lspSymbolsToolDefinition.execute(
            {
              filePath: definitionFile,
              scope: 'document',
              limit: 10,
            },
            signal,
          );
          const noHover = await lspHoverToolDefinition.execute(
            {
              filePath: definitionFile,
              line: 1,
              character: 0,
            },
            signal,
          );

          assert(
            noDefinition === 'No definition found',
            'definition empty result should degrade cleanly',
          );
          assert(
            noImplementation === 'No implementation found',
            'implementation empty result should degrade cleanly',
          );
          assert(
            unsupportedLanguageDefinition === 'No definition found',
            'unsupported-language-like files should degrade to the same stable fallback string',
          );
          assert(
            noReferences === 'No references found',
            'references empty result should degrade cleanly',
          );
          assert(
            noWorkspaceSymbols === 'No symbols found',
            'workspace symbols empty result should degrade cleanly',
          );
          assert(
            noDocumentSymbols === 'No symbols found',
            'document symbols empty result should degrade cleanly',
          );
          assert(
            noHover === 'No hover information available',
            'hover empty result should degrade cleanly',
          );

          console.log(
            '  ✓ no-result and unsupported-language negative paths return stable fallback strings',
          );

          const hoverCalls: string[] = [];
          lspManager.touchFile = async (path, waitForDiagnostics) => {
            hoverCalls.push(`touch:${path}:${String(waitForDiagnostics)}`);
          };
          lspManager.hover = async ({ file }) => {
            hoverCalls.push(`hover:${file}`);
            return {
              contents: { kind: 'markdown', value: '```typescript\nconst x: number\n```' },
            };
          };

          const hoverResult = await lspHoverToolDefinition.execute(
            {
              filePath: definitionFile,
              line: 5,
              character: 10,
            },
            signal,
          );

          assert(
            hoverCalls.join(' -> ') === `touch:${definitionFile}:true -> hover:${definitionFile}`,
            'lsp_hover should touch(true) before hover query',
          );
          assert(
            hoverResult === '```typescript\nconst x: number\n```',
            `lsp_hover should extract MarkupContent value, got '${hoverResult}'`,
          );

          lspManager.hover = async () => ({
            contents: [
              { language: 'typescript', value: 'function foo(): void' },
              'A helper function.',
            ],
          });

          const arrayHover = await lspHoverToolDefinition.execute(
            {
              filePath: definitionFile,
              line: 1,
              character: 0,
            },
            signal,
          );

          assert(
            arrayHover === 'function foo(): void\n\nA helper function.',
            `lsp_hover should join MarkedString array, got '${arrayHover}'`,
          );

          console.log('  ✓ lsp_hover pre-touches, formats MarkupContent and MarkedString[] output');

          const tmpWorkspace = await fsp.mkdtemp(join(tmpdir(), 'openawork-lsp-verify-'));
          const renameFile = join(tmpWorkspace, 'rename-sample.ts');
          await fsp.writeFile(renameFile, 'const oldName = 1;\nconsole.log(oldName);\n', 'utf8');

          const renameCalls: string[] = [];

          lspManager.touchFile = async (path, waitForDiagnostics) => {
            renameCalls.push(`touch:${path}:${String(waitForDiagnostics)}`);
          };
          lspManager.prepareRename = async ({ file }) => {
            renameCalls.push(`prepare:${file}`);
            return {
              range: {
                start: { line: 0, character: 6 },
                end: { line: 0, character: 13 },
              },
            };
          };
          lspManager.rename = async ({ file, newName }) => {
            renameCalls.push(`rename:${file}:${newName}`);
            return {
              changes: {
                [pathToFileURL(file).toString()]: [
                  {
                    range: {
                      start: { line: 1, character: 12 },
                      end: { line: 1, character: 19 },
                    },
                    newText: newName,
                  },
                  {
                    range: {
                      start: { line: 0, character: 6 },
                      end: { line: 0, character: 13 },
                    },
                    newText: newName,
                  },
                ],
              },
            };
          };
          lspManager.diagnostics = async () => ({
            ...EMPTY_DIAGNOSTICS,
            [renameFile]: [
              {
                severity: 'warning',
                line: 2,
                col: 1,
                message: 'simulated diagnostic after rename',
                source: 'tsserver',
              },
            ],
          });

          const prepareResult = await lspPrepareRenameToolDefinition.execute(
            {
              filePath: renameFile,
              line: 1,
              character: 6,
            },
            signal,
          );
          assert(
            prepareResult.includes('Rename available at 1:6-1:13'),
            `prepare rename should report availability, got '${prepareResult}'`,
          );

          const renameResult = await lspRenameToolDefinition.execute(
            {
              filePath: renameFile,
              line: 1,
              character: 6,
              newName: 'newName',
            },
            signal,
          );
          const renamedContent = await fsp.readFile(renameFile, 'utf8');

          assert(
            renameCalls[0] === `touch:${renameFile}:true`,
            'rename chain should pre-touch before prepare/rename execution',
          );
          assert(
            renameCalls.includes(`prepare:${renameFile}`),
            'prepareRename should hit lspManager.prepareRename',
          );
          assert(
            renameCalls.includes(`rename:${renameFile}:newName`),
            'rename should hit lspManager.rename with newName',
          );
          assert(
            renameCalls.filter((item) => item === `touch:${renameFile}:true`).length >= 2,
            'rename chain should touch(true) both before query and after workspace edit',
          );
          assert(
            renamedContent.includes('const newName = 1;') &&
              renamedContent.includes('console.log(newName);'),
            'rename should apply workspace edits to disk',
          );
          assert(
            renameResult.diagnostics?.[0]?.message === 'simulated diagnostic after rename',
            'rename should append post-write diagnostics to tool output',
          );

          console.log('  ✓ prepareRename + rename chain applies edits and returns diagnostics');

          lspManager.touchFile = async () => {
            throw new Error('simulated touch failure');
          };
          lspManager.rename = async ({ file, newName }) => ({
            changes: {
              [pathToFileURL(file).toString()]: [
                {
                  range: {
                    start: { line: 0, character: 6 },
                    end: { line: 0, character: 13 },
                  },
                  newText: newName,
                },
              ],
            },
          });
          lspManager.diagnostics = async () => {
            throw new Error('simulated diagnostics failure');
          };

          await fsp.writeFile(renameFile, 'const oldName = 1;\n', 'utf8');
          const bestEffortRename = await lspRenameToolDefinition.execute(
            {
              filePath: renameFile,
              line: 1,
              character: 6,
              newName: 'safeName',
            },
            signal,
          );
          const bestEffortContent = await fsp.readFile(renameFile, 'utf8');

          assert(
            bestEffortRename.result.includes('Applied 1 edit(s) to 1 file(s)'),
            'rename should still succeed when touch/diagnostics fail',
          );
          assert(
            bestEffortRename.diagnostics === undefined,
            'rename should omit diagnostics when best-effort retrieval fails',
          );
          assert(
            bestEffortContent.includes('const safeName = 1;'),
            'rename should keep file modification even if LSP sync fails',
          );

          console.log('  ✓ post-write touch/diagnostics failures stay best-effort');
        } finally {
          lspManager.touchFile = originalTouchFile;
          lspManager.definition = originalDefinition;
          lspManager.implementation = originalImplementation;
          lspManager.references = originalReferences;
          lspManager.workspaceSymbols = originalWorkspaceSymbols;
          lspManager.documentSymbols = originalDocumentSymbols;
          lspManager.prepareRename = originalPrepareRename;
          lspManager.rename = originalRename;
          lspManager.diagnostics = originalDiagnostics;
          lspManager.hover = originalHover;
          lspManager.prepareCallHierarchy = originalPrepareCallHierarchy;
          lspManager.incomingCalls = originalIncomingCalls;
          lspManager.outgoingCalls = originalOutgoingCalls;
        }

        console.log('verify-lsp-tools: ok');
      } finally {
        await app.close();
        await closeDb();
      }
    },
  );
}

void main().catch((error) => {
  console.error('verify-lsp-tools: failed');
  console.error(error);
  process.exitCode = 1;
});
