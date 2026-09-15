import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_CORE_IGNORED_DIRS,
  WORKSPACE_FILE_INDEX_IGNORED_DIRS,
} from '../../workspace/workspace-ignored-dirs.js';
import { IGNORED_NAMES } from '../../tools/workspace-tools.js';

const LEGACY_TOOL_DENYLIST = [
  'node_modules',
  '.git',
  'dist',
  '.next',
  '__pycache__',
  '.DS_Store',
  '.vs',
  '.idea',
  '.omo',
  '.venv',
  'target',
  'coverage',
] as const;

const FILE_INDEX_ONLY_EXTRAS = [
  '.hg',
  '.svn',
  'build',
  'out',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.nx',
  'venv',
  '.pnpm-store',
  '.yarn',
  '.vscode',
  '.codegraph',
  '.claude',
  '.husky',
  'temp',
  '.sisyphus',
] as const;

describe('workspace 忽略目录集合', () => {
  it('核心集合与 agent 工具遍历的历史 denylist 完全一致（不得放宽或收紧）', () => {
    expect([...WORKSPACE_CORE_IGNORED_DIRS].sort()).toEqual([...LEGACY_TOOL_DENYLIST].sort());
    expect(IGNORED_NAMES).toBe(WORKSPACE_CORE_IGNORED_DIRS);
  });

  it('索引集合在核心集合之上追加构建产物与工具状态目录', () => {
    for (const name of LEGACY_TOOL_DENYLIST) {
      expect(WORKSPACE_FILE_INDEX_IGNORED_DIRS.has(name), name).toBe(true);
    }
    for (const name of FILE_INDEX_ONLY_EXTRAS) {
      expect(WORKSPACE_FILE_INDEX_IGNORED_DIRS.has(name), name).toBe(true);
    }
    expect(WORKSPACE_FILE_INDEX_IGNORED_DIRS.size).toBe(
      LEGACY_TOOL_DENYLIST.length + FILE_INDEX_ONLY_EXTRAS.length,
    );
  });

  it('索引集合不会把 agent 工具遍历收紧到构建产物目录', () => {
    for (const name of ['build', 'out', 'temp', '.husky']) {
      expect(WORKSPACE_CORE_IGNORED_DIRS.has(name), name).toBe(false);
    }
  });

  it('两个集合都不含 .agentdocs（其工作流文档可被提及与遍历）', () => {
    expect(WORKSPACE_CORE_IGNORED_DIRS.has('.agentdocs')).toBe(false);
    expect(WORKSPACE_FILE_INDEX_IGNORED_DIRS.has('.agentdocs')).toBe(false);
  });
});
