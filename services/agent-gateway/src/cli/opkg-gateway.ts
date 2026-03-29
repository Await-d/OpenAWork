import { createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';

export interface OpkgGatewayOptions {
  gatewayBaseUrl: string;
  authToken: string;
}

export interface InstallResult {
  skillId: string;
  version: string;
  installed: boolean;
}

export interface RemoveResult {
  skillId: string;
  removed: boolean;
}

export interface PushResult {
  skillId: string;
  version: string;
  registryUrl: string;
}

async function gatewayFetch<T>(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: BodyInit,
  contentType?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (contentType) headers['Content-Type'] = contentType;

  const res = await fetch(`${baseUrl}${path}`, { method, headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`opkg gateway error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function installSkill(
  opts: OpkgGatewayOptions,
  skillId: string,
): Promise<InstallResult> {
  return gatewayFetch<InstallResult>(
    opts.gatewayBaseUrl,
    opts.authToken,
    'POST',
    '/skills/install',
    JSON.stringify({ skillId }),
    'application/json',
  );
}

export async function removeSkill(
  opts: OpkgGatewayOptions,
  skillId: string,
): Promise<RemoveResult> {
  return gatewayFetch<RemoveResult>(
    opts.gatewayBaseUrl,
    opts.authToken,
    'DELETE',
    `/skills/${encodeURIComponent(skillId)}`,
  );
}

export async function pushSkill(opts: OpkgGatewayOptions, localPath: string): Promise<PushResult> {
  const absPath = resolve(localPath);
  const stat = statSync(absPath);
  if (!stat.isDirectory() && !absPath.endsWith('.zip')) {
    throw new Error('push requires a directory or .zip archive');
  }

  const form = new FormData();
  if (stat.isDirectory()) {
    throw new Error('Directory push: zip the skill directory first, then run opkg push <file>.zip');
  }
  form.set('skill', createReadStream(absPath) as unknown as Blob, absPath.split('/').pop());

  const res = await fetch(`${opts.gatewayBaseUrl}/skills/push`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.authToken}` },
    body: form as unknown as BodyInit,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`opkg push error ${res.status}: ${text}`);
  }
  return res.json() as Promise<PushResult>;
}

type SubCommand = 'install' | 'remove' | 'push';

const USAGE = `
Usage: opkg <command> [args]

Commands:
  install <skill-id>   Install a skill from the registry
  remove  <skill-id>   Remove an installed skill
  push    <local-path> Upload a local skill package to the gateway
`.trim();

export async function runOpkg(opts: OpkgGatewayOptions, argv: string[]): Promise<void> {
  const [sub, arg] = argv;
  const validCommands: SubCommand[] = ['install', 'remove', 'push'];

  if (!sub || !validCommands.includes(sub as SubCommand)) {
    process.stdout.write(USAGE + '\n');
    return;
  }

  if (!arg) {
    throw new Error(`opkg ${sub}: missing required argument`);
  }

  const cmd = sub as SubCommand;

  if (cmd === 'install') {
    const result = await installSkill(opts, arg);
    process.stdout.write(`Installed ${result.skillId}@${result.version}\n`);
    return;
  }

  if (cmd === 'remove') {
    const result = await removeSkill(opts, arg);
    process.stdout.write(result.removed ? `Removed ${arg}\n` : `Skill ${arg} was not found\n`);
    return;
  }

  if (cmd === 'push') {
    const result = await pushSkill(opts, arg);
    process.stdout.write(
      `Pushed ${result.skillId}@${result.version} \u2192 ${result.registryUrl}\n`,
    );
    return;
  }
}
