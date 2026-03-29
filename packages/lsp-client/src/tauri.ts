import type { ChildProcessWithoutNullStreams } from 'child_process';
import type { LSPServerInfo } from './types.js';
import { NearestRoot } from './server.js';

export interface TauriSpawnHandle {
  kill(): Promise<void>;
  stdout: AsyncIterable<string>;
  stdin: { write(data: string): Promise<void> };
}

export type TauriSpawner = (
  program: string,
  args: string[],
  cwd: string,
) => Promise<TauriSpawnHandle>;

export interface LSPServerHandleTauri {
  process: TauriSpawnHandle;
  initialization?: Record<string, unknown>;
}

export function createTauriLSPServerInfo(spawner: TauriSpawner): Record<string, LSPServerInfo> {
  const RustAnalyzerServer: LSPServerInfo = {
    id: 'rust-analyzer',
    extensions: ['.rs'],
    root: NearestRoot(['Cargo.toml', 'Cargo.lock']),
    async spawn(root: string) {
      const handle = await spawner('rust-analyzer', [], root).catch(() => null);
      if (!handle) return undefined;
      return {
        process: handle as unknown as ChildProcessWithoutNullStreams,
      };
    },
  };

  const ESLintServer: LSPServerInfo = {
    id: 'eslint',
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    root: NearestRoot([
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.json',
      '.eslintrc.cjs',
      'eslint.config.js',
      'eslint.config.ts',
    ]),
    async spawn(root: string) {
      const handle = await spawner('vscode-eslint-language-server', ['--stdio'], root).catch(
        () => null,
      );
      if (!handle) return undefined;
      return {
        process: handle as unknown as ChildProcessWithoutNullStreams,
        initialization: {
          validate: 'on',
          codeAction: { disableRuleComment: { enable: true }, showDocumentation: { enable: true } },
        },
      };
    },
  };

  const BiomeServer: LSPServerInfo = {
    id: 'biome',
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json', '.jsonc'],
    root: NearestRoot(['biome.json', 'biome.jsonc']),
    async spawn(root: string) {
      const handle = await spawner('biome', ['lsp-proxy'], root).catch(() => null);
      if (!handle) return undefined;
      return {
        process: handle as unknown as ChildProcessWithoutNullStreams,
      };
    },
  };

  return {
    'rust-analyzer': RustAnalyzerServer,
    eslint: ESLintServer,
    biome: BiomeServer,
  };
}

export const TAURI_EXTRA_SERVER_IDS = ['rust-analyzer', 'eslint', 'biome'] as const;
export type TauriExtraServerId = (typeof TAURI_EXTRA_SERVER_IDS)[number];
