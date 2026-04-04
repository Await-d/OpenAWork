import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node.js';
import type { MessageConnection } from 'vscode-jsonrpc';
import type { Diagnostic } from 'vscode-languageserver-types';
import { promises as fs } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import type { LSPClientInfo, LSPServerHandle } from './types.js';
import { getLanguageId } from './language.js';

const DIAGNOSTICS_DEBOUNCE_MS = 150;
const INITIALIZE_TIMEOUT_MS = 45_000;
const DIAGNOSTICS_TIMEOUT_MS = 3_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
    ),
  ]);
}

/** SymbolKind values 1–26 per LSP 3.17 spec. */
const SYMBOL_KIND_VALUE_SET = Array.from({ length: 26 }, (_, i) => i + 1);

function buildInitializeParams(root: string, initialization?: Record<string, unknown>) {
  return {
    processId: globalThis.process?.pid ?? null,
    clientInfo: { name: 'openAwork-lsp-client', version: '0.0.1' },
    rootUri: pathToFileURL(root).href,
    workspaceFolders: [{ name: 'workspace', uri: pathToFileURL(root).href }],
    capabilities: {
      workspace: {
        configuration: true,
        workspaceFolders: true,
        didChangeConfiguration: { dynamicRegistration: true },
        symbol: {
          dynamicRegistration: false,
          symbolKind: { valueSet: SYMBOL_KIND_VALUE_SET },
        },
      },
      textDocument: {
        publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
        hover: { contentFormat: ['markdown', 'plaintext'] },
        definition: { linkSupport: false },
        implementation: { dynamicRegistration: false, linkSupport: false },
        references: { dynamicRegistration: false },
        documentSymbol: {
          dynamicRegistration: false,
          hierarchicalDocumentSymbolSupport: true,
          symbolKind: { valueSet: SYMBOL_KIND_VALUE_SET },
        },
        rename: { prepareSupport: true, prepareSupportDefaultBehavior: 1 },
      },
    },
    initializationOptions: initialization ?? {},
  };
}

function normalizeFilePath(fp: string): string {
  return fp.replace(/\\/g, '/');
}

export async function createLSPClient(input: {
  serverID: string;
  server: LSPServerHandle;
  root: string;
  onDiagnostics?: (path: string, diagnostics: Diagnostic[]) => void;
}): Promise<LSPClientInfo> {
  const connection: MessageConnection = createMessageConnection(
    new StreamMessageReader(input.server.process.stdout),
    new StreamMessageWriter(input.server.process.stdin),
  );

  const diagnostics = new Map<string, Diagnostic[]>();
  const diagnosticListeners = new Map<string, Array<(d: Diagnostic[]) => void>>();
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  connection.onNotification(
    'textDocument/publishDiagnostics',
    (params: { uri: string; diagnostics: Diagnostic[] }) => {
      const filePath = normalizeFilePath(fileURLToPath(params.uri));
      diagnostics.set(filePath, params.diagnostics);

      const existing = debounceTimers.get(filePath);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        debounceTimers.delete(filePath);
        input.onDiagnostics?.(filePath, params.diagnostics);
        const listeners = diagnosticListeners.get(filePath);
        if (listeners) {
          for (const l of listeners) l(params.diagnostics);
          diagnosticListeners.delete(filePath);
        }
      }, DIAGNOSTICS_DEBOUNCE_MS);

      debounceTimers.set(filePath, timer);
    },
  );

  connection.onRequest('workspace/configuration', async () => [input.server.initialization ?? {}]);
  connection.onRequest('client/registerCapability', async () => null);
  connection.onRequest('workspace/workspaceFolders', async () => [
    { name: 'workspace', uri: pathToFileURL(input.root).href },
  ]);

  connection.listen();

  await withTimeout(
    connection.sendRequest(
      'initialize',
      buildInitializeParams(input.root, input.server.initialization),
    ),
    INITIALIZE_TIMEOUT_MS,
  );
  await connection.sendNotification('initialized', {});

  return {
    serverID: input.serverID,
    root: input.root,
    connection,
    diagnostics,

    notify: {
      async open({ path: filePath }) {
        const text = await fs.readFile(filePath, 'utf-8');
        const languageId = getLanguageId(filePath);
        await connection.sendNotification('textDocument/didOpen', {
          textDocument: { uri: pathToFileURL(filePath).href, languageId, version: 0, text },
        });
      },
      async change({ path: filePath, text }) {
        await connection.sendNotification('textDocument/didChange', {
          textDocument: { uri: pathToFileURL(filePath).href, version: Date.now() },
          contentChanges: [{ text }],
        });
      },
    },

    async waitForDiagnostics({ path: filePath, timeoutMs = DIAGNOSTICS_TIMEOUT_MS }) {
      const normalized = normalizeFilePath(filePath);
      const existing = diagnostics.get(normalized);
      if (existing) return existing;

      return new Promise<Diagnostic[]>((resolve) => {
        const timer = setTimeout(() => {
          const listeners = diagnosticListeners.get(normalized);
          if (listeners) {
            const idx = listeners.indexOf(resolve);
            if (idx !== -1) listeners.splice(idx, 1);
          }
          resolve([]);
        }, timeoutMs);

        const wrapped = (d: Diagnostic[]) => {
          clearTimeout(timer);
          resolve(d);
        };

        const existing2 = diagnosticListeners.get(normalized);
        if (existing2) {
          existing2.push(wrapped);
        } else {
          diagnosticListeners.set(normalized, [wrapped]);
        }
      });
    },

    async hover({ file, line, character }) {
      return connection
        .sendRequest('textDocument/hover', {
          textDocument: { uri: pathToFileURL(file).href },
          position: { line, character },
        })
        .catch(() => null);
    },

    async definition({ file, line, character }) {
      const result = await connection
        .sendRequest('textDocument/definition', {
          textDocument: { uri: pathToFileURL(file).href },
          position: { line, character },
        })
        .catch(() => []);
      return Array.isArray(result) ? result : result ? [result] : [];
    },

    async implementation({ file, line, character }) {
      const result = await connection
        .sendRequest('textDocument/implementation', {
          textDocument: { uri: pathToFileURL(file).href },
          position: { line, character },
        })
        .catch(() => []);
      return Array.isArray(result) ? result : result ? [result] : [];
    },

    async references({ file, line, character, includeDeclaration = true }) {
      const result = await connection
        .sendRequest('textDocument/references', {
          textDocument: { uri: pathToFileURL(file).href },
          position: { line, character },
          context: { includeDeclaration },
        })
        .catch(() => []);
      return Array.isArray(result) ? result : [];
    },

    async documentSymbols({ file }) {
      const result = await connection
        .sendRequest('textDocument/documentSymbol', {
          textDocument: { uri: pathToFileURL(file).href },
        })
        .catch(() => []);
      return Array.isArray(result) ? result : result ? [result] : [];
    },

    async workspaceSymbols({ query }) {
      const result = await connection
        .sendRequest('workspace/symbol', {
          query,
        })
        .catch(() => []);
      return Array.isArray(result) ? result : result ? [result] : [];
    },

    async prepareRename({ file, line, character }) {
      return connection
        .sendRequest('textDocument/prepareRename', {
          textDocument: { uri: pathToFileURL(file).href },
          position: { line, character },
        })
        .catch(() => null);
    },

    async rename({ file, line, character, newName }) {
      return connection
        .sendRequest('textDocument/rename', {
          textDocument: { uri: pathToFileURL(file).href },
          position: { line, character },
          newName,
        })
        .catch(() => null);
    },

    async shutdown() {
      try {
        await connection.sendRequest('shutdown');
        await connection.sendNotification('exit');
      } catch (_e) {
        void _e;
      } finally {
        connection.end();
        connection.dispose();
        input.server.process.kill();
      }
    },
  };
}

export type { MessageConnection };
export type { Diagnostic };
