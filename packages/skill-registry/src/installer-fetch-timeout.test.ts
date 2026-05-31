import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillInstaller } from './installer.js';
import type { SkillEntry } from './types.js';

const OriginalFetch = globalThis.fetch;

function remoteEntry(): SkillEntry {
  return {
    id: 'skill-remote',
    name: 'remote',
    displayName: 'Remote',
    version: '1.0.0',
    description: 'remote skill',
    category: 'other',
    sourceId: 'official',
    tags: [],
    manifestUrl: 'https://registry.test/skills/remote/manifest.yaml',
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.fetch = OriginalFetch;
});

describe('SkillInstaller manifest fetch timeout', () => {
  it('远端 manifest 拉取挂起时在 8s 后 abort，而不是永久卡住', async () => {
    // A fetch that never resolves on its own but rejects when aborted.
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })) as typeof fetch;

    const installer = new SkillInstaller();
    const installPromise = installer.install(remoteEntry());
    const settled = expect(installPromise).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(8000);
    await settled;
  });

  it('正常返回 manifest 时透传解析', async () => {
    const manifestYaml = [
      'apiVersion: agent-skill/v1',
      'id: skill-remote',
      'name: remote',
      'displayName: Remote',
      'version: 1.0.0',
      'description: remote skill',
      'capabilities: []',
      'permissions: []',
    ].join('\n');

    globalThis.fetch = (() =>
      Promise.resolve(new Response(manifestYaml, { status: 200 }))) as typeof fetch;

    const installer = new SkillInstaller();
    const record = await installer.install(remoteEntry());
    expect(record.skillId).toBe('skill-remote');
  });
});
