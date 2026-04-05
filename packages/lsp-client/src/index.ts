import { findServerForFile, findServersForFile, ALL_SERVERS } from './server.js';
import { createLSPClient } from './client.js';
import type {
  LSPServerInfo,
  LSPClientInfo,
  LSPServerStatus,
  DiagnosticSummary,
  LSPManagerOptions,
} from './types.js';
import type { Diagnostic } from 'vscode-languageserver-types';

const SEVERITY_MAP: Record<number, DiagnosticSummary['severity']> = {
  1: 'error',
  2: 'warning',
  3: 'information',
  4: 'hint',
};

export class LSPManager {
  private clients: LSPClientInfo[] = [];
  private spawning = new Map<string, Promise<LSPClientInfo | undefined>>();
  private broken = new Set<string>();
  private servers: LSPServerInfo[];
  private diagnosticHandlers: Array<(path: string, diagnostics: Diagnostic[]) => void> = [];

  constructor(input: LSPServerInfo[] | LSPManagerOptions = ALL_SERVERS) {
    const opts = Array.isArray(input) ? { servers: input } : input;
    const disabled = new Set(opts.disabledServerIds ?? []);
    this.servers = (opts.servers ?? ALL_SERVERS).filter((server) => !disabled.has(server.id));
  }

  private clientKey(serverId: string, root: string): string {
    return `${serverId}::${root}`;
  }

  private findClient(serverId: string, root: string): LSPClientInfo | undefined {
    return this.clients.find((c) => c.serverID === serverId && c.root === root);
  }

  private async getOrSpawnClient(
    serverInfo: LSPServerInfo,
    root: string,
  ): Promise<LSPClientInfo | undefined> {
    const key = this.clientKey(serverInfo.id, root);

    if (this.broken.has(key)) return undefined;

    const existing = this.findClient(serverInfo.id, root);
    if (existing) return existing;

    const pending = this.spawning.get(key);
    if (pending) return pending;

    const spawning = (async () => {
      try {
        const handle = await serverInfo.spawn(root);
        if (!handle) {
          this.broken.add(key);
          return undefined;
        }
        const client = await createLSPClient({
          serverID: serverInfo.id,
          server: handle,
          root,
          onDiagnostics: (p, d) => {
            for (const h of this.diagnosticHandlers) h(p, d);
          },
        });
        this.clients.push(client);
        return client;
      } catch {
        this.broken.add(key);
        return undefined;
      } finally {
        this.spawning.delete(key);
      }
    })();

    this.spawning.set(key, spawning);
    return spawning;
  }

  private async resolveServers(
    filePath: string,
  ): Promise<Array<{ info: LSPServerInfo; root: string }>> {
    const selected = new Map<string, { info: LSPServerInfo; root: string }>();
    for (const info of findServersForFile(filePath, this.servers)) {
      const root = await info.root(filePath);
      if (!root) continue;
      const slot = info.slot ?? info.id;
      const prev = selected.get(slot);
      if (!prev || (info.priority ?? 0) > (prev.info.priority ?? 0)) {
        selected.set(slot, { info, root });
      }
    }
    return [...selected.values()];
  }

  private async clientsForFile(filePath: string): Promise<LSPClientInfo[]> {
    const infos = await this.resolveServers(filePath);
    const clients = await Promise.all(
      infos.map((entry) => this.getOrSpawnClient(entry.info, entry.root)),
    );
    return clients.filter((client): client is LSPClientInfo => client !== undefined);
  }

  async touchFile(filePath: string, waitForDiagnostics = false): Promise<void> {
    const clients = await this.clientsForFile(filePath);
    await Promise.all(clients.map((client) => client.notify.open({ path: filePath })));
    if (waitForDiagnostics) {
      await Promise.all(clients.map((client) => client.waitForDiagnostics({ path: filePath })));
    }
  }

  async diagnostics(): Promise<Record<string, DiagnosticSummary[]>> {
    const result: Record<string, DiagnosticSummary[]> = {};
    for (const client of this.clients) {
      for (const [filePath, diags] of client.diagnostics) {
        const next = diags.map((d) => ({
          severity: SEVERITY_MAP[d.severity ?? 1] ?? 'error',
          line: d.range.start.line + 1,
          col: d.range.start.character + 1,
          message: d.message,
          source: d.source ?? client.serverID,
          code: typeof d.code === 'number' || typeof d.code === 'string' ? d.code : undefined,
        }));
        result[filePath] = [...(result[filePath] ?? []), ...next];
      }
    }
    return result;
  }

  async hover(input: { file: string; line: number; character: number }): Promise<unknown> {
    const client = await this.clientForFile(input.file);
    return client?.hover(input) ?? null;
  }

  async definition(input: { file: string; line: number; character: number }): Promise<unknown[]> {
    const client = await this.clientForFile(input.file);
    return client?.definition(input) ?? [];
  }

  async implementation(input: {
    file: string;
    line: number;
    character: number;
  }): Promise<unknown[]> {
    const client = await this.clientForFile(input.file);
    return client?.implementation(input) ?? [];
  }

  async references(input: {
    file: string;
    line: number;
    character: number;
    includeDeclaration?: boolean;
  }): Promise<unknown[]> {
    const client = await this.clientForFile(input.file);
    return client?.references(input) ?? [];
  }

  async documentSymbols(input: { file: string }): Promise<unknown[]> {
    const client = await this.clientForFile(input.file);
    return client?.documentSymbols(input) ?? [];
  }

  async workspaceSymbols(input: { file: string; query: string }): Promise<unknown[]> {
    const client = await this.clientForFile(input.file);
    return client?.workspaceSymbols({ query: input.query }) ?? [];
  }

  async prepareRename(input: { file: string; line: number; character: number }): Promise<unknown> {
    const client = await this.clientForFile(input.file);
    return client?.prepareRename(input) ?? null;
  }

  async rename(input: {
    file: string;
    line: number;
    character: number;
    newName: string;
  }): Promise<unknown> {
    const client = await this.clientForFile(input.file);
    return client?.rename(input) ?? null;
  }

  async prepareCallHierarchy(input: {
    file: string;
    line: number;
    character: number;
  }): Promise<unknown[]> {
    const client = await this.clientForFile(input.file);
    return client?.prepareCallHierarchy(input) ?? [];
  }

  async incomingCalls(input: { file: string; item: unknown }): Promise<unknown[]> {
    const client = await this.clientForFile(input.file);
    return client?.incomingCalls({ item: input.item }) ?? [];
  }

  async outgoingCalls(input: { file: string; item: unknown }): Promise<unknown[]> {
    const client = await this.clientForFile(input.file);
    return client?.outgoingCalls({ item: input.item }) ?? [];
  }

  async status(): Promise<LSPServerStatus[]> {
    return this.clients.map((c) => ({
      id: c.serverID,
      root: c.root,
      running: true,
      fileCount: c.diagnostics.size,
      diagnosticCount: [...c.diagnostics.values()].reduce((sum, d) => sum + d.length, 0),
    }));
  }

  onDiagnosticsUpdate(handler: (path: string, diagnostics: Diagnostic[]) => void): () => void {
    this.diagnosticHandlers.push(handler);
    return () => {
      const idx = this.diagnosticHandlers.indexOf(handler);
      if (idx !== -1) this.diagnosticHandlers.splice(idx, 1);
    };
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(this.clients.map((c) => c.shutdown()));
    this.clients = [];
    this.spawning.clear();
    this.broken.clear();
  }

  private async clientForFile(filePath: string): Promise<LSPClientInfo | undefined> {
    const serverInfo = findServerForFile(filePath, this.servers);
    if (!serverInfo) return undefined;
    const root = await serverInfo.root(filePath);
    if (!root) return undefined;
    return this.getOrSpawnClient(serverInfo, root);
  }
}

export {
  ALL_SERVERS,
  TypescriptServer,
  GoplsServer,
  PyrightServer,
  JsonServer,
  HtmlServer,
  CssServer,
  YamlServer,
  DockerfileServer,
  DockerComposeServer,
  DockerBakeServer,
  ESLintServer,
  BiomeServer,
  ShellscriptServer,
  RustAnalyzerServer,
  NearestRoot,
  findServersForFile,
} from './server.js';
export { createLSPClient } from './client.js';
export { getLanguageId, LANGUAGE_EXTENSIONS } from './language.js';
export type {
  LSPServerInfo,
  LSPServerHandle,
  LSPClientInfo,
  LSPServerStatus,
  DiagnosticSummary,
  RootFunction,
  LSPManagerOptions,
} from './types.js';

export { LSPWebSocketClient } from './ws-client.js';
export type { LSPWebSocketClientOptions, LSPDiagnosticsHandler } from './ws-client.js';

export { createTauriLSPServerInfo, TAURI_EXTRA_SERVER_IDS } from './tauri.js';
export type { TauriSpawner, TauriExtraServerId } from './tauri.js';

export {
  LSP_FILETYPES,
  getLanguageIdByExtension,
  getLanguageIdForFilePath,
  getRootMarkersForLanguage,
  getRootMarkersForExtension,
  getRootMarkersForFilePath,
  getAllRootMarkers,
} from './lsp-filetypes.js';
export type { LanguageFiletypeEntry } from './lsp-filetypes.js';
