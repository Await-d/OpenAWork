import { SkillRegistryClientImpl } from '../client.js';
import { RegistrySourceManager } from '../source.js';
import { SkillLifecycle } from '../lifecycle.js';
import type { RegistrySource, RegistryTrustLevel } from '../types.js';

const defaultStdout = (msg: string): void => {
  globalThis.console.log(msg);
};
const defaultStderr = (msg: string): void => {
  globalThis.console.error(msg);
};

export interface OpkgCliOptions {
  client?: SkillRegistryClientImpl;
  sourceManager?: RegistrySourceManager;
  lifecycle?: SkillLifecycle;
  stdout?: (msg: string) => void;
  stderr?: (msg: string) => void;
}

type ExitCode = 0 | 1;

export class OpkgCli {
  private readonly client: SkillRegistryClientImpl;
  private readonly sourceManager: RegistrySourceManager;
  private readonly lifecycle: SkillLifecycle;
  private readonly stdout: (msg: string) => void;
  private readonly stderr: (msg: string) => void;

  constructor(options: OpkgCliOptions = {}) {
    this.sourceManager = options.sourceManager ?? new RegistrySourceManager();
    this.client = options.client ?? new SkillRegistryClientImpl(this.sourceManager);
    this.lifecycle = options.lifecycle ?? new SkillLifecycle({ client: this.client });
    this.stdout = options.stdout ?? defaultStdout;
    this.stderr = options.stderr ?? defaultStderr;
  }

  async run(argv: string[]): Promise<ExitCode> {
    const [cmd, sub, ...rest] = argv;

    if (!cmd) {
      this.printUsage();
      return 0;
    }

    try {
      if (cmd === 'registry') {
        return await this.runRegistry(sub, rest);
      }
      if (cmd === 'install') return await this.runInstall(sub, rest);
      if (cmd === 'update') return await this.runUpdate(sub);
      if (cmd === 'remove') return await this.runRemove(sub);
      if (cmd === 'search') return await this.runSearch(sub);
      if (cmd === 'info') return await this.runInfo(sub);
      if (cmd === 'list') return this.runList();

      this.stderr(`Unknown command: ${cmd}`);
      this.printUsage();
      return 1;
    } catch (err) {
      this.stderr(`Error: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  private async runRegistry(sub: string | undefined, args: string[]): Promise<ExitCode> {
    if (sub === 'add') return this.registryAdd(args);
    if (sub === 'remove') return this.registryRemove(args[0]);
    if (sub === 'list') return this.registryList();
    if (sub === 'enable') return this.registryToggle(args[0], true);
    if (sub === 'disable') return this.registryToggle(args[0], false);
    this.stderr(`Unknown registry subcommand: ${sub ?? '(none)'}`);
    this.stdout('Usage: opkg registry <add|remove|list|enable|disable>');
    return 1;
  }

  private registryAdd(args: string[]): ExitCode {
    const url = args[0];
    if (!url) {
      this.stderr('Usage: opkg registry add <url> [--name <name>] [--trust standard|restricted]');
      return 1;
    }
    const name = this.parseFlag(args, '--name') ?? url;
    const trustRaw = this.parseFlag(args, '--trust') ?? 'standard';
    const trust = this.parseTrustLevel(trustRaw);

    const id = url
      .replace(/^https?:\/\//, '')
      .replace(/[^\w-]/g, '-')
      .slice(0, 40);

    const source: RegistrySource = {
      id,
      name,
      url,
      type: 'community',
      trust,
      enabled: true,
      priority: 10,
    };
    this.sourceManager.addSource(source);
    this.stdout(`[+] Registry added: ${name} (${id})`);
    this.stdout(`    URL:   ${url}`);
    this.stdout(`    Trust: ${trust}`);
    return 0;
  }

  private registryRemove(id: string | undefined): ExitCode {
    if (!id) {
      this.stderr('Usage: opkg registry remove <id>');
      return 1;
    }
    this.sourceManager.removeSource(id);
    this.stdout(`[-] Registry removed: ${id}`);
    return 0;
  }

  private registryList(): ExitCode {
    const sources = this.sourceManager.listSources();
    if (sources.length === 0) {
      this.stdout('No registries configured.');
      return 0;
    }
    this.stdout('Configured registries:');
    for (const src of sources) {
      const status = src.enabled ? '\u2713' : '\u2717';
      this.stdout(
        `  ${status} ${src.id.padEnd(20)} ${src.name.padEnd(30)} [${src.trust}] ${src.url}`,
      );
    }
    return 0;
  }

  private registryToggle(id: string | undefined, enabled: boolean): ExitCode {
    if (!id) {
      this.stderr(`Usage: opkg registry ${enabled ? 'enable' : 'disable'} <id>`);
      return 1;
    }
    if (enabled) {
      this.sourceManager.enableSource(id);
      this.stdout(`[\u2713] Registry enabled: ${id}`);
    } else {
      this.sourceManager.disableSource(id);
      this.stdout(`[\u2717] Registry disabled: ${id}`);
    }
    return 0;
  }

  private async runInstall(skillId: string | undefined, args: string[]): Promise<ExitCode> {
    if (!skillId) {
      this.stderr('Usage: opkg install <skill-id> [--source <registry-id>]');
      return 1;
    }
    const sourceId = this.parseFlag(args, '--source');
    this.stdout(`Installing ${skillId}...`);
    const record = await this.client.install(skillId, { sourceId });
    this.stdout(`[\u2713] Installed ${record.manifest.displayName} v${record.manifest.version}`);
    return 0;
  }

  private async runUpdate(skillId: string | undefined): Promise<ExitCode> {
    if (!skillId) {
      const updates = await this.lifecycle.checkUpdates();
      if (updates.length === 0) {
        this.stdout('All skills are up to date.');
        return 0;
      }
      this.stdout(`Updating ${updates.length} skill(s)...`);
      for (const u of updates) {
        const record = await this.lifecycle.update(u.skillId).catch((err: unknown) => {
          this.stderr(
            `  [!] Failed to update ${u.skillId}: ${err instanceof Error ? err.message : String(err)}`,
          );
          return undefined;
        });
        if (record) {
          this.stdout(`  [\u2713] ${u.skillId}: ${u.currentVersion} -> ${u.latestVersion}`);
        }
      }
      return 0;
    }
    this.stdout(`Updating ${skillId}...`);
    const record = await this.lifecycle.update(skillId);
    this.stdout(`[\u2713] Updated ${record.manifest.displayName} to v${record.manifest.version}`);
    return 0;
  }

  private async runRemove(skillId: string | undefined): Promise<ExitCode> {
    if (!skillId) {
      this.stderr('Usage: opkg remove <skill-id>');
      return 1;
    }
    await this.lifecycle.uninstall(skillId);
    this.stdout(`[-] Removed ${skillId}`);
    return 0;
  }

  private async runSearch(query: string | undefined): Promise<ExitCode> {
    if (!query) {
      this.stderr('Usage: opkg search <query>');
      return 1;
    }
    this.stdout(`Searching for "${query}"...`);
    const results = await this.client.search({ query });
    if (results.length === 0) {
      this.stdout('No results found.');
      return 0;
    }
    for (const entry of results) {
      this.stdout(
        `  ${entry.id.padEnd(30)} ${entry.displayName.padEnd(30)} v${entry.version}  [${entry.sourceId}]`,
      );
    }
    return 0;
  }

  private async runInfo(skillId: string | undefined): Promise<ExitCode> {
    if (!skillId) {
      this.stderr('Usage: opkg info <skill-id>');
      return 1;
    }
    const detail = await this.client.getDetail(skillId);
    if (!detail) {
      this.stderr(`Skill not found: ${skillId}`);
      return 1;
    }
    this.stdout(`Name:        ${detail.displayName}`);
    this.stdout(`ID:          ${detail.id}`);
    this.stdout(`Version:     ${detail.version}`);
    this.stdout(`Description: ${detail.description}`);
    this.stdout(`Author:      ${detail.author ?? 'unknown'}`);
    this.stdout(`Source:      ${detail.sourceId}`);
    this.stdout(`Tags:        ${detail.tags.join(', ')}`);
    return 0;
  }

  private runList(): ExitCode {
    const installed = this.client.listInstalled();
    if (installed.length === 0) {
      this.stdout('No skills installed.');
      return 0;
    }
    this.stdout('Installed skills:');
    for (const record of installed) {
      this.stdout(
        `  ${record.skillId.padEnd(30)} v${record.manifest.version.padEnd(10)} [${record.sourceId}]`,
      );
    }
    return 0;
  }

  private parseFlag(args: string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) return undefined;
    return args[idx + 1];
  }

  private parseTrustLevel(raw: string): RegistryTrustLevel {
    if (raw === 'full' || raw === 'verified' || raw === 'untrusted') return raw;
    return 'verified';
  }

  private printUsage(): void {
    const lines = [
      'Usage: opkg <command> [args]',
      '',
      'Registry management:',
      '  opkg registry add <url> [--name <n>] [--trust standard|restricted]',
      '  opkg registry remove <id>',
      '  opkg registry list',
      '  opkg registry enable <id>',
      '  opkg registry disable <id>',
      '',
      'Skill management:',
      '  opkg install <skill-id> [--source <registry-id>]',
      '  opkg update [skill-id]',
      '  opkg remove <skill-id>',
      '  opkg search <query>',
      '  opkg info <skill-id>',
      '  opkg list',
    ];
    this.stdout(lines.join('\n'));
  }
}

export async function runOpkgCli(argv?: string[]): Promise<void> {
  const args =
    argv ??
    (globalThis as unknown as { process?: { argv?: string[] } }).process?.argv?.slice(2) ??
    [];
  const cli = new OpkgCli();
  const code = await cli.run(args);
  const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
  if (proc) proc.exitCode = code;
}
