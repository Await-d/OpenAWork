import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DirectoryAgentsInjector, ToolCallResult } from '@openAwork/agent-core';
import { DirectoryAgentsInjectorImpl } from '@openAwork/agent-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DirectoryAgentsInjectionTracker,
  injectDirectoryAgentsIntoReadResult,
} from '../../session/directory-agents-injection.js';

const temporaryDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'openawork-read-agents-'));
  temporaryDirectories.push(directory);
  return directory;
}

function makeReadResult(filePath: string, content = 'file body'): ToolCallResult {
  return {
    toolCallId: 'call-1',
    toolName: 'read',
    output: { path: filePath, content, truncated: false },
    isError: false,
    durationMs: 1,
  };
}

function readContent(result: ToolCallResult): string {
  const output = result.output as { content: string };
  return output.content;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('injectDirectoryAgentsIntoReadResult', () => {
  it('首次 read 注入最近的 AGENTS.md', async () => {
    const workspaceRoot = await createWorkspace();
    const subDirectory = join(workspaceRoot, 'sub');
    await mkdir(subDirectory, { recursive: true });
    await writeFile(join(subDirectory, 'AGENTS.md'), 'SUB RULES', 'utf8');
    const filePath = join(subDirectory, 'file.ts');
    await writeFile(filePath, 'export const x = 1;\n', 'utf8');

    const result = await injectDirectoryAgentsIntoReadResult(makeReadResult(filePath), {
      sessionId: 'session-1',
      workspaceRoot,
      injector: new DirectoryAgentsInjectorImpl(),
      tracker: new DirectoryAgentsInjectionTracker(),
    });

    expect(readContent(result)).toContain('file body');
    expect(readContent(result)).toContain('SUB RULES');
    expect(readContent(result)).toContain(`Instructions from: ${join(subDirectory, 'AGENTS.md')}`);
  });

  it('同一会话第二次 read 不重复注入', async () => {
    const workspaceRoot = await createWorkspace();
    await writeFile(join(workspaceRoot, 'AGENTS.md'), 'ROOT RULES', 'utf8');
    const subDirectory = join(workspaceRoot, 'sub');
    await mkdir(subDirectory, { recursive: true });
    await writeFile(join(subDirectory, 'AGENTS.md'), 'SUB RULES', 'utf8');
    const filePath = join(subDirectory, 'file.ts');
    await writeFile(filePath, 'body\n', 'utf8');

    const tracker = new DirectoryAgentsInjectionTracker();
    const injector = new DirectoryAgentsInjectorImpl();

    const first = await injectDirectoryAgentsIntoReadResult(makeReadResult(filePath), {
      sessionId: 'session-1',
      workspaceRoot,
      injector,
      tracker,
    });
    expect(readContent(first)).toContain('SUB RULES');

    const second = await injectDirectoryAgentsIntoReadResult(makeReadResult(filePath), {
      sessionId: 'session-1',
      workspaceRoot,
      injector,
      tracker,
    });
    expect(readContent(second)).toBe('file body');
  });

  it('不同会话各自注入', async () => {
    const workspaceRoot = await createWorkspace();
    const subDirectory = join(workspaceRoot, 'sub');
    await mkdir(subDirectory, { recursive: true });
    await writeFile(join(subDirectory, 'AGENTS.md'), 'SUB RULES', 'utf8');
    const filePath = join(subDirectory, 'file.ts');
    await writeFile(filePath, 'body\n', 'utf8');

    const tracker = new DirectoryAgentsInjectionTracker();
    const injector = new DirectoryAgentsInjectorImpl();

    const first = await injectDirectoryAgentsIntoReadResult(makeReadResult(filePath), {
      sessionId: 'session-a',
      workspaceRoot,
      injector,
      tracker,
    });
    const second = await injectDirectoryAgentsIntoReadResult(makeReadResult(filePath), {
      sessionId: 'session-b',
      workspaceRoot,
      injector,
      tracker,
    });

    expect(readContent(first)).toContain('SUB RULES');
    expect(readContent(second)).toContain('SUB RULES');
  });

  it('不存在 AGENTS.md 时不注入且不改动 read 输出', async () => {
    const workspaceRoot = await createWorkspace();
    const subDirectory = join(workspaceRoot, 'sub');
    await mkdir(subDirectory, { recursive: true });
    const filePath = join(subDirectory, 'file.ts');
    await writeFile(filePath, 'body\n', 'utf8');

    const original = makeReadResult(filePath);
    const result = await injectDirectoryAgentsIntoReadResult(original, {
      sessionId: 'session-1',
      workspaceRoot,
      injector: new DirectoryAgentsInjectorImpl(),
      tracker: new DirectoryAgentsInjectionTracker(),
    });

    expect(result).toEqual(original);
  });

  it('排除工作区根自身的 AGENTS.md', async () => {
    const workspaceRoot = await createWorkspace();
    await writeFile(join(workspaceRoot, 'AGENTS.md'), 'ROOT RULES', 'utf8');
    const filePath = join(workspaceRoot, 'file.ts');
    await writeFile(filePath, 'body\n', 'utf8');

    const original = makeReadResult(filePath);
    const result = await injectDirectoryAgentsIntoReadResult(original, {
      sessionId: 'session-1',
      workspaceRoot,
      injector: new DirectoryAgentsInjectorImpl(),
      tracker: new DirectoryAgentsInjectionTracker(),
    });

    expect(readContent(result)).not.toContain('ROOT RULES');
    expect(result).toEqual(original);
  });

  it('read 失败时不尝试注入', async () => {
    const workspaceRoot = await createWorkspace();
    await writeFile(join(workspaceRoot, 'AGENTS.md'), 'ROOT RULES', 'utf8');
    const filePath = join(workspaceRoot, 'sub', 'file.ts');
    await mkdir(join(workspaceRoot, 'sub'), { recursive: true });

    const findNearestAgentsFile = vi.fn(async () => null);
    const injector: DirectoryAgentsInjector = {
      findNearestAgentsFile,
      collectAllAgentsFiles: async () => [],
      buildInjectionBlock: () => '',
    };
    const failedResult: ToolCallResult = {
      ...makeReadResult(filePath),
      isError: true,
      output: 'read failed',
    };

    const result = await injectDirectoryAgentsIntoReadResult(failedResult, {
      sessionId: 'session-1',
      workspaceRoot,
      injector,
      tracker: new DirectoryAgentsInjectionTracker(),
    });

    expect(findNearestAgentsFile).not.toHaveBeenCalled();
    expect(result).toEqual(failedResult);
  });

  it('注入过程抛错时不影响 read 结果', async () => {
    const workspaceRoot = await createWorkspace();
    const filePath = join(workspaceRoot, 'file.ts');
    await writeFile(filePath, 'body\n', 'utf8');

    const injector: DirectoryAgentsInjector = {
      findNearestAgentsFile: async () => {
        throw new Error('injector boom');
      },
      collectAllAgentsFiles: async () => [],
      buildInjectionBlock: () => '',
    };
    const onError = vi.fn();

    const original = makeReadResult(filePath);
    const result = await injectDirectoryAgentsIntoReadResult(original, {
      sessionId: 'session-1',
      workspaceRoot,
      injector,
      tracker: new DirectoryAgentsInjectionTracker(),
      onError,
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(result).toEqual(original);
  });
});

describe('DirectoryAgentsInjectionTracker', () => {
  it('单会话记录数有界（丢弃最早记录）', () => {
    const tracker = new DirectoryAgentsInjectionTracker();
    for (let index = 0; index < 70; index += 1) {
      tracker.markInjected('session-1', `/p/${index}/AGENTS.md`);
    }

    expect(tracker.isInjected('session-1', '/p/69/AGENTS.md')).toBe(true);
    expect(tracker.isInjected('session-1', '/p/0/AGENTS.md')).toBe(false);
  });

  it('跟随的会话数有界（淘汰最旧会话）', () => {
    const tracker = new DirectoryAgentsInjectionTracker();
    for (let index = 0; index < 300; index += 1) {
      tracker.markInjected(`session-${index}`, '/x/AGENTS.md');
    }

    expect(tracker.isInjected('session-0', '/x/AGENTS.md')).toBe(false);
    expect(tracker.isInjected('session-299', '/x/AGENTS.md')).toBe(true);
  });
});
