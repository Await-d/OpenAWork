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
// Per-request wall-clock ceiling. A language server that connects but
// never answers a request (deadlocked indexer, hung child process) would
// otherwise leave the `sendRequest` promise pending forever — the tool
// call that awaits it (hover/definition/references/...) hangs, and on the
// editor side every cursor move can stack another never-settling request.
// Racing each request against this deadline converts the hang into the
// same fallback the existing `.catch()` already returns.
export const REQUEST_TIMEOUT_MS = 10_000;

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  // Clear the timer on settle so wrapping high-frequency requests (hover on
  // every cursor move) doesn't accumulate thousands of live timers waiting
  // out their full `ms`. `unref` keeps a pending timer from holding the
  // process open during shutdown.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
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
        callHierarchy: { dynamicRegistration: false },
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
  const child = input.server.process;

  // A spawned child emits an asynchronous `error` event when it fails to
  // start (ENOENT/EACCES) or dies unexpectedly. Without a listener Node
  // rethrows it as an uncaught exception that can crash the whole gateway.
  // Attach a swallowing listener so a broken language server degrades to a
  // dead connection instead of taking the process down. The pool's
  // operation-retry / broken-set logic handles recovery.
  child.on('error', () => {
    // Intentionally swallowed: stream readers below surface the failure to
    // callers, and LSPManager marks the server broken on the rejected init.
  });

  // If spawn already failed, stdio pipes may be missing — fail fast with a
  // clear error the caller (getOrSpawnClient) catches, rather than letting
  // createMessageConnection throw an opaque error on a null stream.
  if (!child.stdout || !child.stdin) {
    throw new Error(`LSP server ${input.serverID} has no stdio pipes (spawn likely failed)`);
  }

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

  // Timeout-wrapped request helper. Each LSP request is raced against
  // REQUEST_TIMEOUT_MS so a hung server surfaces as a rejection that the
  // per-method `.catch()` fallbacks already handle (null / []).
  const request = <T>(method: string, params: unknown): Promise<T> =>
    withTimeout<T>(connection.sendRequest(method, params), REQUEST_TIMEOUT_MS);

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
      return request('textDocument/hover', {
        textDocument: { uri: pathToFileURL(file).href },
        position: { line, character },
      }).catch(() => null);
    },

    async definition({ file, line, character }) {
      const result = await request('textDocument/definition', {
        textDocument: { uri: pathToFileURL(file).href },
        position: { line, character },
      }).catch(() => []);
      return Array.isArray(result) ? result : result ? [result] : [];
    },

    async implementation({ file, line, character }) {
      const result = await request('textDocument/implementation', {
        textDocument: { uri: pathToFileURL(file).href },
        position: { line, character },
      }).catch(() => []);
      return Array.isArray(result) ? result : result ? [result] : [];
    },

    async references({ file, line, character, includeDeclaration = true }) {
      const result = await request('textDocument/references', {
        textDocument: { uri: pathToFileURL(file).href },
        position: { line, character },
        context: { includeDeclaration },
      }).catch(() => []);
      return Array.isArray(result) ? result : [];
    },

    async documentSymbols({ file }) {
      const result = await request('textDocument/documentSymbol', {
        textDocument: { uri: pathToFileURL(file).href },
      }).catch(() => []);
      return Array.isArray(result) ? result : result ? [result] : [];
    },

    async workspaceSymbols({ query }) {
      const result = await request('workspace/symbol', {
        query,
      }).catch(() => []);
      return Array.isArray(result) ? result : result ? [result] : [];
    },

    async prepareRename({ file, line, character }) {
      return request('textDocument/prepareRename', {
        textDocument: { uri: pathToFileURL(file).href },
        position: { line, character },
      }).catch(() => null);
    },

    async rename({ file, line, character, newName }) {
      return request('textDocument/rename', {
        textDocument: { uri: pathToFileURL(file).href },
        position: { line, character },
        newName,
      }).catch(() => null);
    },

    async prepareCallHierarchy({ file, line, character }) {
      const result = await request('textDocument/prepareCallHierarchy', {
        textDocument: { uri: pathToFileURL(file).href },
        position: { line, character },
      }).catch(() => []);
      return Array.isArray(result) ? result : result ? [result] : [];
    },

    async incomingCalls({ item }) {
      const result = await request('callHierarchy/incomingCalls', { item }).catch(() => []);
      return Array.isArray(result) ? result : [];
    },

    async outgoingCalls({ item }) {
      const result = await request('callHierarchy/outgoingCalls', { item }).catch(() => []);
      return Array.isArray(result) ? result : [];
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
