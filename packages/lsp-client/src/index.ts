import { exec } from 'node:child_process';
import { findServerForFile, findServersForFile, ALL_SERVERS, whichSync } from './server.js';
import { createLSPClient } from './client.js';
import type {
  LSPServerInfo,
  LSPClientInfo,
  LSPServerStatus,
  LSPMissingServer,
  DiagnosticSummary,
  LSPManagerOptions,
} from './types.js';
import type { Diagnostic } from 'vscode-languageserver-types';

/**
 * 自动安装语言服务的超时（毫秒）与「失败后的冷却」。
 *
 * 安装命令形如 `npm install -g typescript-language-server`，是**网络操作**：实测在
 * 容器里首次执行要 17~33 秒（probe 三次 `npm install` 分别耗时 3s / 32.8s / 17.1s，
 * 与 `event-loop-lag` 告警的时间戳逐条吻合）。失败（离线 / 代理不可达）时会一直卡到
 * 超时。因此：
 *   - 安装期间**绝不能**同步阻塞事件循环（网关是单线程，阻塞期间 SSE 心跳、/status、
 *     首 token 全部排队，实测一次 32.8 秒）；
 *   - 同一 server 并发只装一次（两个 npm 同时写全局 node_modules 会互相破坏）；
 *   - 失败后冷却一段时间，避免每个 LSP 请求都重试一次、把用户反复拖满超时。
 */
const INSTALL_TIMEOUT_MS = 120_000;
const INSTALL_FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
/** npm 安装输出可能很长（依赖树 + warning），给足缓冲避免回调被截断成 error。 */
const INSTALL_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

const SEVERITY_MAP: Record<number, DiagnosticSummary['severity']> = {
  1: 'error',
  2: 'warning',
  3: 'information',
  4: 'hint',
};

function isBinaryInstalled(binary: string | string[] | undefined): boolean {
  if (!binary) return false;
  const binaries = Array.isArray(binary) ? binary : [binary];
  // Resolve via the pure-Node PATH scan (whichSync) rather than a `which`/`where`
  // subprocess: no event-loop-blocking unbounded child, no shell, no injection.
  return binaries.some((bin) => whichSync(bin) !== undefined);
}

export class LSPManager {
  private clients: LSPClientInfo[] = [];
  private spawning = new Map<string, Promise<LSPClientInfo | undefined>>();
  /** serverId → 进行中的安装（并发去重，见 `ensureInstalled`）。 */
  private installs = new Map<string, Promise<boolean>>();
  /** serverId → 冷却截止时刻：安装失败后短期内不再重试。 */
  private installCooldownUntil = new Map<string, number>();
  private broken = new Set<string>();
  private servers: LSPServerInfo[];
  private autoInstall: boolean;
  private diagnosticHandlers: Array<(path: string, diagnostics: Diagnostic[]) => void> = [];

  constructor(input: LSPServerInfo[] | LSPManagerOptions = ALL_SERVERS) {
    const opts = Array.isArray(input) ? { servers: input } : input;
    const disabled = new Set(opts.disabledServerIds ?? []);
    this.servers = (opts.servers ?? ALL_SERVERS).filter((server) => !disabled.has(server.id));
    this.autoInstall = opts.autoInstall ?? false;
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

    if (this.broken.has(key)) {
      // If autoInstall is enabled, try installing the missing binary
      if (this.autoInstall && serverInfo.installCommand) {
        const wasInstalled = await this.ensureInstalled(serverInfo.id);
        if (wasInstalled) {
          this.broken.delete(key);
        } else {
          return undefined;
        }
      } else {
        return undefined;
      }
    }

    const existing = this.findClient(serverInfo.id, root);
    if (existing) return existing;

    const pending = this.spawning.get(key);
    if (pending) return pending;

    const spawning = (async () => {
      try {
        let handle = await serverInfo.spawn(root);
        // If spawn fails and autoInstall is enabled, try installing then retry
        if (!handle && this.autoInstall && serverInfo.installCommand) {
          const wasInstalled = await this.ensureInstalled(serverInfo.id);
          if (wasInstalled) {
            handle = await serverInfo.spawn(root);
          }
        }
        if (!handle) {
          this.broken.add(key);
          return undefined;
        }
        const client = await createLSPClient({
          serverID: serverInfo.id,
          server: handle,
          root,
          onDiagnostics: (p, d) => {
            this.dispatchDiagnostics(p, d);
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

  /**
   * Fan a diagnostics push out to every subscriber while isolating
   * faults: a throwing handler (e.g. a closed SSE/WS socket whose
   * write rejects) must not abort delivery to the remaining
   * subscribers, nor bubble back into the LSP client's notification
   * loop and poison the connection. We snapshot the handler list so a
   * handler that unsubscribes itself mid-dispatch doesn't shift the
   * iterator.
   */
  private dispatchDiagnostics(path: string, diagnostics: Diagnostic[]): void {
    for (const handler of [...this.diagnosticHandlers]) {
      try {
        handler(path, diagnostics);
      } catch (err) {
        console.warn('[lsp] diagnostics handler threw, isolating:', err);
      }
    }
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(this.clients.map((c) => c.shutdown()));
    this.clients = [];
    this.spawning.clear();
    this.broken.clear();
  }

  /**
   * Attempt to install a missing LSP server binary.
   * Returns true if the binary is available after the install attempt.
   * Safe to call multiple times — no-op if already installed.
   *
   * 安装是**网络操作**（`npm install -g …`，首次实测 17~33 秒），因此这里只做
   * 「异步 spawn + 并发去重 + 失败冷却」。历史实现用 `execSync`，把整个网关的事件
   * 循环按住直到 npm 返回——这正是 `event-loop-lag` 里 32.8s / 17.1s 两次阻塞的
   * 直接原因（同期的 `/root/.npm/_logs` 时间戳与告警逐条对齐）。
   */
  async ensureInstalled(serverId: string): Promise<boolean> {
    const server = this.servers.find((s) => s.id === serverId);
    if (!server?.installCommand || !server.binary) return false;

    if (isBinaryInstalled(server.binary)) return true;

    const cooldownUntil = this.installCooldownUntil.get(serverId) ?? 0;
    if (Date.now() < cooldownUntil) return false;

    // 同一个 server 的并发安装必须合并：两个 npm 同时写全局 node_modules 会互相
    // 破坏，最终两边都可能装出不可用的二进制。
    const pending = this.installs.get(serverId);
    if (pending) return pending;

    const running = this.runInstall(serverId, server.installCommand, server.binary).finally(() => {
      this.installs.delete(serverId);
    });
    this.installs.set(serverId, running);
    return running;
  }

  /** 执行一次安装并复核结果；失败时开启冷却（见 `INSTALL_FAILURE_COOLDOWN_MS`）。 */
  private async runInstall(
    serverId: string,
    installCommand: string,
    binary: string | string[],
  ): Promise<boolean> {
    const spawned = await new Promise<boolean>((resolve) => {
      exec(
        installCommand,
        {
          timeout: INSTALL_TIMEOUT_MS,
          maxBuffer: INSTALL_MAX_BUFFER_BYTES,
          windowsHide: true,
        },
        (error) => {
          // 安装输出不转发（可能很大且没有诊断价值），只看退出状态。
          resolve(error === null);
        },
      );
    });

    // 退出码为 0 也可能没装上（命令是 `a || b` 之类）：一律以「二进制是否真的
    // 出现在 PATH 上」为准，与 `isBinaryInstalled` 的判定口径保持一致。
    const installed = spawned && isBinaryInstalled(binary);
    if (!installed) {
      this.installCooldownUntil.set(serverId, Date.now() + INSTALL_FAILURE_COOLDOWN_MS);
    } else {
      this.installCooldownUntil.delete(serverId);
    }
    return installed;
  }

  /**
   * Ensure all configured LSP server binaries are installed (when autoInstall is on).
   * Returns a map of serverId → install success.
   */
  async ensureAllInstalled(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const server of this.servers) {
      if (server.binary && server.installCommand) {
        results[server.id] = await this.ensureInstalled(server.id);
      }
    }
    return results;
  }

  /**
   * List all configured servers and their installation status.
   * Useful for UI to show which LSP servers are available or need installation.
   */
  missingServers(): LSPMissingServer[] {
    return this.servers
      .filter((s) => s.binary)
      .map((s) => ({
        id: s.id,
        extensions: s.extensions,
        binary: s.binary!,
        installCommand: s.installCommand,
        installed: isBinaryInstalled(s.binary),
      }));
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
  LSPMissingServer,
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
