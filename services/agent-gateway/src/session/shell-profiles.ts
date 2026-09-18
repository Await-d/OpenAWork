/**
 * Shell profile allowlist — the server-side mapping from an opaque profile id
 * to a concrete executable.
 *
 * Security boundary: the client only ever supplies an opaque `shellProfileId`
 * string. The id→executable mapping is built exclusively from this host's own
 * detection (never from client input), the argv is server-defined, and the
 * resolved path is re-checked for executability right before spawning.
 *
 * All probes are injectable (`ShellProfileDetectionDeps`) so tests are
 * hermetic and never depend on which shells exist on the host.
 */

import { spawnSync } from 'node:child_process';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveShellChoiceForPlatform, type ShellSelectionEnv } from '../tools/shell-choice.js';

/** A server-owned shell choice. `shell` is never returned to clients. */
export interface ShellProfile {
  /** Stable opaque id derived server-side from the executable basename. */
  id: string;
  /** Human-readable label derived from the id (never a path). */
  label: string;
  /** Server-side executable path / bare command. Never exposed to clients. */
  shell: string;
  isPowerShell: boolean;
}

/** Client-facing profile shape — deliberately free of filesystem paths. */
export interface PublicShellProfile {
  id: string;
  label: string;
  isDefault: boolean;
}

/** Injectable probes so detection and spawn re-checks are testable. */
export interface ShellProfileDetectionDeps {
  /** POSIX: true when `candidate` is an existing executable file. */
  fileExists?: (candidate: string) => boolean;
  /** Reads a text file (defaults to `/etc/shells`). Returns `''` when unreadable. */
  readTextFile?: (filePath: string) => string;
  /** Windows: true when a bare command resolves on PATH. */
  commandExists?: (command: string) => boolean;
  /**
   * Independent spawn-time re-check that the resolved executable still exists.
   * Defaults to the platform existence probe.
   */
  isExecutable?: (shell: string) => boolean;
}

/** Raised when a client-supplied id is not in the live allowlist. */
export class InvalidShellProfileError extends Error {
  readonly shellProfileId: string;
  constructor(shellProfileId: string) {
    super(`未知的 shell profile：${shellProfileId}`);
    this.name = 'InvalidShellProfileError';
    this.shellProfileId = shellProfileId;
  }
}

/** Server-side argv is fully defined here; clients can never inject args. */
export function shellArgsForProfile(profile: { isPowerShell: boolean }): string[] {
  return profile.isPowerShell ? ['-NoLogo', '-NoProfile'] : ['-i'];
}

const KNOWN_SHELL_LABELS: Record<string, string> = {
  bash: 'Bash',
  sh: 'POSIX sh',
  zsh: 'Zsh',
  fish: 'Fish',
  dash: 'Dash',
  ksh: 'Ksh',
  csh: 'Csh',
  tcsh: 'Tcsh',
  'pwsh.exe': 'PowerShell',
  'powershell.exe': 'Windows PowerShell',
  'cmd.exe': 'Command Prompt',
};

/** Derive a human label from an opaque id; never includes a path. */
export function shellProfileLabelForId(id: string): string {
  const known = KNOWN_SHELL_LABELS[id];
  if (known !== undefined) return known;
  const base = id.replace(/\.exe$/i, '');
  if (base.length === 0) return id;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Derive the opaque profile id from a shell path / command basename. */
function deriveShellProfileId(shell: string): string {
  // Normalize Windows separators so win32 paths derive the same basename
  // regardless of the host platform running detection (e.g. tests on Linux).
  const normalized = shell.trim().replace(/\\/g, '/');
  return path.posix.basename(normalized).toLowerCase();
}

const WELL_KNOWN_POSIX_SHELLS: readonly string[] = [
  '/bin/bash',
  '/usr/bin/bash',
  '/bin/sh',
  '/usr/bin/sh',
  '/bin/zsh',
  '/usr/bin/zsh',
  '/bin/fish',
  '/usr/bin/fish',
  '/usr/local/bin/fish',
];

interface ShellCandidate {
  shell: string;
  isPowerShell: boolean;
}

function defaultFileExists(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultReadTextFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function defaultCommandExists(command: string): boolean {
  const result = spawnSync(command, ['-NoLogo', '-NoProfile', '-Command', 'exit'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  return result.status === 0 && !result.error;
}

function isPathLike(shell: string): boolean {
  return /[\\/]/.test(shell);
}

function candidateExists(
  platform: NodeJS.Platform,
  shell: string,
  deps: ShellProfileDetectionDeps,
): boolean {
  if (platform === 'win32' && !isPathLike(shell)) {
    const commandExists = deps.commandExists ?? defaultCommandExists;
    return commandExists(shell);
  }
  const fileExists = deps.fileExists ?? defaultFileExists;
  return fileExists(shell);
}

function posixCandidates(
  env: ShellSelectionEnv,
  deps: ShellProfileDetectionDeps,
): ShellCandidate[] {
  const candidates: ShellCandidate[] = [];
  const envShell = env.SHELL?.trim();
  if (envShell && envShell.length > 0) {
    candidates.push({ shell: envShell, isPowerShell: false });
  }
  const readTextFile = deps.readTextFile ?? defaultReadTextFile;
  const shellsFile = readTextFile('/etc/shells');
  for (const line of shellsFile.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    candidates.push({ shell: trimmed, isPowerShell: false });
  }
  for (const wellKnown of WELL_KNOWN_POSIX_SHELLS) {
    candidates.push({ shell: wellKnown, isPowerShell: false });
  }
  return candidates;
}

function windowsCandidates(env: ShellSelectionEnv): ShellCandidate[] {
  const candidates: ShellCandidate[] = [];
  const configured = env.OPENAWORK_WINDOWS_SHELL?.trim();
  if (configured && configured.length > 0) {
    candidates.push({ shell: configured, isPowerShell: /powershell|pwsh/i.test(configured) });
  }
  candidates.push({ shell: 'pwsh.exe', isPowerShell: true });
  candidates.push({ shell: 'powershell.exe', isPowerShell: true });
  const comSpec = env.ComSpec?.trim();
  candidates.push({
    shell: comSpec && comSpec.length > 0 ? comSpec : 'cmd.exe',
    isPowerShell: false,
  });
  return candidates;
}

/**
 * Build the allowlist of shell profiles available on this host. Existence is
 * checked with the injected probes; ids are derived from the basename,
 * lowercased, and deduplicated (first candidate wins).
 */
export function detectShellProfiles(
  platform: NodeJS.Platform,
  env: ShellSelectionEnv = process.env,
  deps: ShellProfileDetectionDeps = {},
): ShellProfile[] {
  const candidates = platform === 'win32' ? windowsCandidates(env) : posixCandidates(env, deps);
  const seen = new Set<string>();
  const profiles: ShellProfile[] = [];
  for (const candidate of candidates) {
    if (!candidateExists(platform, candidate.shell, deps)) continue;
    const id = deriveShellProfileId(candidate.shell);
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    profiles.push({
      id,
      label: shellProfileLabelForId(id),
      shell: candidate.shell,
      isPowerShell: candidate.isPowerShell,
    });
  }
  return profiles;
}

let allowlistCache: ShellProfile[] | undefined;

/**
 * The live allowlist snapshot. Built once from detection so spawn-time
 * resolution can distinguish "id never existed" (→ 400) from "id exists but
 * its executable vanished since detection" (→ safe fallback).
 */
export function getShellProfileAllowlist(
  platform: NodeJS.Platform,
  env: ShellSelectionEnv = process.env,
  deps?: ShellProfileDetectionDeps,
): ShellProfile[] {
  if (allowlistCache === undefined) {
    allowlistCache = detectShellProfiles(platform, env, deps);
  }
  return allowlistCache;
}

/** Test hook — clears the cached allowlist snapshot. */
export function __resetShellProfilesCacheForTest(): void {
  allowlistCache = undefined;
}

function defaultShellProfileId(platform: NodeJS.Platform, env: ShellSelectionEnv): string {
  // Must mirror what today's `getShell()` picks, without changing its behaviour.
  const choice = resolveShellChoiceForPlatform(platform, env);
  return deriveShellProfileId(choice.shell);
}

/** Public (path-free) projections from the live allowlist. */
export function listPublicShellProfiles(
  platform: NodeJS.Platform,
  env: ShellSelectionEnv = process.env,
  deps?: ShellProfileDetectionDeps,
): PublicShellProfile[] {
  const profiles = getShellProfileAllowlist(platform, env, deps);
  const defaultId = defaultShellProfileId(platform, env);
  return profiles.map((profile) => ({
    id: profile.id,
    label: profile.label,
    isDefault: profile.id === defaultId,
  }));
}

/**
 * Resolve an opaque id against the live allowlist. A path-like or unknown
 * value is always `undefined` — client input is never interpreted as a path.
 */
export function resolveShellProfile(
  id: string | undefined,
  platform: NodeJS.Platform,
  env: ShellSelectionEnv = process.env,
  deps?: ShellProfileDetectionDeps,
): ShellProfile | undefined {
  if (id === undefined) return undefined;
  const normalized = id.trim();
  if (normalized.length === 0) return undefined;
  return getShellProfileAllowlist(platform, env, deps).find((profile) => profile.id === normalized);
}

export interface ResolveShellForSpawnInput {
  shellProfileId?: string;
  platform: NodeJS.Platform;
  env: ShellSelectionEnv;
  deps?: ShellProfileDetectionDeps;
  /** Default shell / argv resolved by the caller (today's `getShell()`). */
  defaultShell: string;
  defaultArgs: string[];
  /** Observability hook fired when an allowlisted executable vanished. */
  onFallback?: (details: { requestedId: string; missingShell: string }) => void;
}

export interface ResolvedShellForSpawn {
  shell: string;
  args: string[];
  /** Present only when a non-default profile was actually used. */
  shellProfileId?: string;
}

/**
 * Resolve the executable for a spawn. Absent id → runtime default (unchanged
 * behaviour). Unknown id → typed error (never spawn). Allowlisted id whose
 * executable vanished → logged fallback to the default.
 */
export function resolveShellForSpawn(input: ResolveShellForSpawnInput): ResolvedShellForSpawn {
  const requested = input.shellProfileId?.trim();
  if (requested === undefined || requested.length === 0) {
    return { shell: input.defaultShell, args: input.defaultArgs };
  }

  const profile = resolveShellProfile(requested, input.platform, input.env, input.deps);
  if (profile === undefined) {
    throw new InvalidShellProfileError(requested);
  }

  const isExecutable =
    input.deps?.isExecutable ??
    ((shell: string) =>
      input.platform === 'win32' && !isPathLike(shell)
        ? (input.deps?.commandExists ?? defaultCommandExists)(shell)
        : (input.deps?.fileExists ?? defaultFileExists)(shell));

  if (!isExecutable(profile.shell)) {
    input.onFallback?.({ requestedId: requested, missingShell: profile.shell });
    return { shell: input.defaultShell, args: input.defaultArgs };
  }

  return {
    shell: profile.shell,
    args: shellArgsForProfile(profile),
    shellProfileId: profile.id,
  };
}
