import { unzipSync, strFromU8 } from 'fflate';
import { parse as parseYaml } from 'yaml';
import type { SkillManifest } from '@openAwork/skill-types';
import type { InstallOptions, InstalledSkillRecord, SkillEntry } from '../types.js';
import { SkillInstaller } from '../installer.js';

export interface GitHubInstallerOptions {
  installer?: SkillInstaller;
  fetchFn?: typeof fetch;
  execFn?: (cmd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  installBaseDir?: string;
}

export interface GitHubRef {
  owner: string;
  repo: string;
  ref?: string;
}

export function parseGitHubRef(input: string): GitHubRef {
  const cleaned = input.replace(/^github:/, '');

  const urlMatch = cleaned.match(
    /^https?:\/\/github\.com\/(\w[\w.-]*)\/([\w.-]+?)(?:\.git)?(?:@([\w./-]+))?\/?$/,
  );
  if (urlMatch) {
    const owner = urlMatch[1];
    const repo = urlMatch[2];
    if (!owner || !repo) throw new Error(`Invalid GitHub URL: "${input}"`);
    return { owner, repo, ref: urlMatch[3] };
  }

  const shortMatch = cleaned.match(/^(\w[\w.-]*)\/([\w.-]+?)(?:@([\w./-]+))?$/);
  if (shortMatch) {
    const owner = shortMatch[1];
    const repo = shortMatch[2];
    if (!owner || !repo) throw new Error(`Invalid GitHub ref: "${input}"`);
    return { owner, repo, ref: shortMatch[3] };
  }

  throw new Error(
    `Invalid GitHub reference: "${input}". Expected: owner/repo, owner/repo@tag, or https://github.com/owner/repo`,
  );
}

const GITHUB_ZIPBALL_URL = (owner: string, repo: string, ref?: string): string =>
  ref
    ? `https://api.github.com/repos/${owner}/${repo}/zipball/${ref}`
    : `https://api.github.com/repos/${owner}/${repo}/zipball`;

export class GitHubInstaller {
  private readonly installer: SkillInstaller;
  private readonly fetchFn: typeof fetch;
  private readonly execFn: (
    cmd: string,
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  private readonly installBaseDir: string;

  constructor(options: GitHubInstallerOptions = {}) {
    this.installer = options.installer ?? new SkillInstaller();
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.execFn = options.execFn ?? this.stubExec.bind(this);
    this.installBaseDir = options.installBaseDir ?? '/tmp/openwork-skills';
  }

  async installFromGitHub(
    repoRef: string,
    options: InstallOptions = {},
  ): Promise<InstalledSkillRecord> {
    const parsed = parseGitHubRef(repoRef);
    const manifest = await this.acquireManifest(parsed);
    const entry = this.buildSkillEntry(manifest, parsed, repoRef);
    return this.installer.install(entry, {
      ...options,
      sourceId: options.sourceId ?? `github:${parsed.owner}/${parsed.repo}`,
      skipSignatureVerification: options.skipSignatureVerification ?? true,
    });
  }

  private async acquireManifest(parsed: GitHubRef): Promise<SkillManifest> {
    const cloneResult = await this.tryGitClone(parsed);
    if (cloneResult) return cloneResult;
    return this.downloadAndExtractManifest(parsed);
  }

  private async tryGitClone(parsed: GitHubRef): Promise<SkillManifest | undefined> {
    const cloneUrl = `https://github.com/${parsed.owner}/${parsed.repo}.git`;
    const destDir = `${this.installBaseDir}/${parsed.owner}-${parsed.repo}`;
    const branchFlag = parsed.ref ? ` --branch ${parsed.ref}` : '';
    const cmd = `git clone --depth 1${branchFlag} ${cloneUrl} ${destDir}`;

    const result = await this.execFn(cmd).catch(() => ({ exitCode: 1, stdout: '', stderr: '' }));
    if (result.exitCode !== 0) return undefined;

    const manifestPath = `${destDir}/skill.yaml`;
    const rawManifest = await this.readLocalFile(manifestPath).catch(() => undefined);
    if (!rawManifest) return undefined;
    return this.parseManifest(rawManifest);
  }

  private async downloadAndExtractManifest(parsed: GitHubRef): Promise<SkillManifest> {
    const zipUrl = GITHUB_ZIPBALL_URL(parsed.owner, parsed.repo, parsed.ref);
    const response = await this.fetchFn(zipUrl, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to download GitHub repo ${parsed.owner}/${parsed.repo}, HTTP ${response.status}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const files = unzipSync(uint8);

    // GitHub zipball entries are under a root directory like "owner-repo-sha/"
    // Find skill.yaml at any depth within the zip
    const skillYamlEntry = Object.keys(files).find(
      (p) => p.endsWith('/skill.yaml') || p === 'skill.yaml',
    );
    if (!skillYamlEntry) {
      throw new Error(`skill.yaml not found in GitHub repo ${parsed.owner}/${parsed.repo}`);
    }

    const raw = strFromU8(files[skillYamlEntry]!);
    return this.parseManifest(raw);
  }

  private buildSkillEntry(
    manifest: SkillManifest,
    parsed: GitHubRef,
    _repoRef: string,
  ): SkillEntry {
    return {
      id: manifest.id,
      name: manifest.name,
      displayName: manifest.displayName,
      version: manifest.version,
      description: manifest.description,
      category: 'other',
      sourceId: `github:${parsed.owner}/${parsed.repo}`,
      tags: ['github'],
      manifest,
      manifestUrl: `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${parsed.ref ?? 'HEAD'}/skill.yaml`,
    };
  }

  private parseManifest(raw: string): SkillManifest {
    const parsed = parseYaml(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Invalid skill.yaml: expected object root');
    }
    return parsed as SkillManifest;
  }

  private async readLocalFile(path: string): Promise<string> {
    const fileUrl = `file://${path}`;
    const response = await this.fetchFn(fileUrl);
    if (!response.ok) throw new Error(`Cannot read file: ${path}`);
    return response.text();
  }

  private async stubExec(
    _cmd: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return { exitCode: 1, stdout: '', stderr: 'git not available in this runtime' };
  }
}
