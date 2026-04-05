import { PassThrough } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageConnection } from 'vscode-jsonrpc';
import type { Diagnostic } from 'vscode-languageserver-types';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import type { LSPClientInfo, LSPServerHandle, LSPServerInfo } from '../types.js';

const { createLSPClientMock } = vi.hoisted(() => ({
  createLSPClientMock:
    vi.fn<
      (input: {
        serverID: string;
        server: LSPServerHandle;
        root: string;
        onDiagnostics?: (path: string, diagnostics: Diagnostic[]) => void;
      }) => Promise<LSPClientInfo>
    >(),
}));

vi.mock('../client.js', () => ({
  createLSPClient: createLSPClientMock,
}));

import { LSPManager } from '../index.js';

function createHandle(): LSPServerHandle {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const process = {
    stdout,
    stderr,
    stdin,
    pid: 1,
    kill: () => true,
  } as unknown as ChildProcessWithoutNullStreams;
  return { process };
}

function diagnostic(message: string, source: string): Diagnostic {
  return {
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    },
    message,
    source,
  };
}

describe('LSPManager multi-server routing', () => {
  const state = new Map<
    string,
    { open: ReturnType<typeof vi.fn>; hover: ReturnType<typeof vi.fn> }
  >();

  beforeEach(() => {
    state.clear();
    createLSPClientMock.mockReset();
    createLSPClientMock.mockImplementation(async (input) => {
      const diagnostics = new Map<string, Diagnostic[]>();
      const open = vi.fn(async ({ path }: { path: string }) => {
        const entries: Diagnostic[] = [];
        if (input.serverID === 'typescript') entries.push(diagnostic('ts error', 'tsserver'));
        if (input.serverID === 'biome') entries.push(diagnostic('biome warning', 'biome'));
        if (input.serverID === 'eslint') entries.push(diagnostic('eslint warning', 'eslint'));
        diagnostics.set(path, entries);
        input.onDiagnostics?.(path, entries);
      });
      const hover = vi.fn(async () => `${input.serverID}-hover`);
      state.set(input.serverID, { open, hover });
      return {
        serverID: input.serverID,
        root: input.root,
        connection: {} as MessageConnection,
        diagnostics,
        notify: {
          open,
          change: vi.fn(async () => undefined),
        },
        waitForDiagnostics: vi.fn(
          async ({ path }: { path: string }) => diagnostics.get(path) ?? [],
        ),
        hover,
        definition: vi.fn(async () => []),
        implementation: vi.fn(async () => []),
        references: vi.fn(async () => []),
        documentSymbols: vi.fn(async () => []),
        workspaceSymbols: vi.fn(async () => []),
        prepareRename: vi.fn(async () => null),
        rename: vi.fn(async () => null),
        prepareCallHierarchy: vi.fn(async () => []),
        incomingCalls: vi.fn(async () => []),
        outgoingCalls: vi.fn(async () => []),
        shutdown: vi.fn(async () => undefined),
      };
    });
  });

  it('touchFile opens the primary server and the highest-priority lint server', async () => {
    const servers: LSPServerInfo[] = [
      {
        id: 'typescript',
        extensions: ['.ts'],
        root: async () => '/repo',
        spawn: async () => createHandle(),
      },
      {
        id: 'eslint',
        extensions: ['.ts'],
        role: 'supplemental',
        slot: 'js-lint',
        priority: 1,
        root: async () => '/repo',
        spawn: async () => createHandle(),
      },
      {
        id: 'biome',
        extensions: ['.ts'],
        role: 'supplemental',
        slot: 'js-lint',
        priority: 2,
        root: async () => '/repo',
        spawn: async () => createHandle(),
      },
    ];

    const manager = new LSPManager({ servers });
    await manager.touchFile('/repo/src/app.ts', true);

    expect(state.get('typescript')?.open).toHaveBeenCalledTimes(1);
    expect(state.get('biome')?.open).toHaveBeenCalledTimes(1);
    expect(state.get('eslint')).toBeUndefined();
  });

  it('disabledServerIds can switch the selected lint server', async () => {
    const servers: LSPServerInfo[] = [
      {
        id: 'typescript',
        extensions: ['.ts'],
        root: async () => '/repo',
        spawn: async () => createHandle(),
      },
      {
        id: 'eslint',
        extensions: ['.ts'],
        role: 'supplemental',
        slot: 'js-lint',
        priority: 1,
        root: async () => '/repo',
        spawn: async () => createHandle(),
      },
      {
        id: 'biome',
        extensions: ['.ts'],
        role: 'supplemental',
        slot: 'js-lint',
        priority: 2,
        root: async () => '/repo',
        spawn: async () => createHandle(),
      },
    ];

    const manager = new LSPManager({ servers, disabledServerIds: ['biome'] });
    await manager.touchFile('/repo/src/app.ts', true);

    expect(state.get('typescript')?.open).toHaveBeenCalledTimes(1);
    expect(state.get('eslint')?.open).toHaveBeenCalledTimes(1);
    expect(state.get('biome')).toBeUndefined();
  });

  it('semantic queries still use the primary server', async () => {
    const servers: LSPServerInfo[] = [
      {
        id: 'typescript',
        extensions: ['.ts'],
        root: async () => '/repo',
        spawn: async () => createHandle(),
      },
      {
        id: 'eslint',
        extensions: ['.ts'],
        role: 'supplemental',
        slot: 'js-lint',
        priority: 1,
        root: async () => '/repo',
        spawn: async () => createHandle(),
      },
    ];

    const manager = new LSPManager({ servers });
    await manager.touchFile('/repo/src/app.ts', false);
    await expect(manager.hover({ file: '/repo/src/app.ts', line: 1, character: 1 })).resolves.toBe(
      'typescript-hover',
    );
  });

  it('diagnostics merges results from multiple matched servers', async () => {
    const servers: LSPServerInfo[] = [
      {
        id: 'typescript',
        extensions: ['.ts'],
        root: async () => '/repo',
        spawn: async () => createHandle(),
      },
      {
        id: 'biome',
        extensions: ['.ts'],
        role: 'supplemental',
        slot: 'js-lint',
        priority: 2,
        root: async () => '/repo',
        spawn: async () => createHandle(),
      },
    ];

    const manager = new LSPManager({ servers });
    await manager.touchFile('/repo/src/app.ts', false);
    const result = await manager.diagnostics();

    expect(result['/repo/src/app.ts']).toHaveLength(2);
    expect(result['/repo/src/app.ts']?.map((item) => item.source)).toEqual(['tsserver', 'biome']);
  });
});
