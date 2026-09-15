import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickToolPathInput, readToolPathInput } from '../../tools/tool-path-aliases.js';
import type * as WorkspaceToolsModule from '../../tools/workspace-tools.js';

const state = vi.hoisted(() => ({
  workspaceRoot: '',
  workingDirectory: '' as string | null,
}));

const mocks = vi.hoisted(() => ({
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn((query: string) => {
    if (query.includes('metadata_json, user_id')) {
      return {
        metadata_json: state.workingDirectory
          ? JSON.stringify({ workingDirectory: state.workingDirectory })
          : '{}',
        user_id: 'user-1',
      };
    }
    return undefined;
  }),
  sqliteRun: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  get WORKSPACE_ROOT() {
    return state.workspaceRoot;
  },
  get WORKSPACE_ROOTS() {
    return [state.workspaceRoot];
  },
  sqliteAll: mocks.sqliteAll,
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
  sqliteRunWithRowId: vi.fn(() => 1),
}));

const SESSION_ID = 'session-alias';

let workspaceRoot: string;
let outsideRoot: string;
let skillRoot: string;
let readTool: (typeof WorkspaceToolsModule)['readTool'];
let listTool: (typeof WorkspaceToolsModule)['listTool'];
let executeReadTool: (typeof WorkspaceToolsModule)['executeReadTool'];
let executeListTool: (typeof WorkspaceToolsModule)['executeListTool'];
let executeWriteTool: (typeof WorkspaceToolsModule)['executeWriteTool'];
let executeWorkspaceCreateDirectory: (typeof WorkspaceToolsModule)['executeWorkspaceCreateDirectory'];
let executeWorkspaceReviewStatus: (typeof WorkspaceToolsModule)['executeWorkspaceReviewStatus'];
let executeWorkspaceReviewRevert: (typeof WorkspaceToolsModule)['executeWorkspaceReviewRevert'];

beforeAll(async () => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'openawork-wt-alias-workspace-'));
  outsideRoot = mkdtempSync(join(tmpdir(), 'openawork-wt-alias-outside-'));
  skillRoot = mkdtempSync(join(tmpdir(), 'openawork-wt-alias-skills-'));
  state.workspaceRoot = workspaceRoot;
  const tools = await import('../../tools/workspace-tools.js');
  readTool = tools.readTool;
  listTool = tools.listTool;
  executeReadTool = tools.executeReadTool;
  executeListTool = tools.executeListTool;
  executeWriteTool = tools.executeWriteTool;
  executeWorkspaceCreateDirectory = tools.executeWorkspaceCreateDirectory;
  executeWorkspaceReviewStatus = tools.executeWorkspaceReviewStatus;
  executeWorkspaceReviewRevert = tools.executeWorkspaceReviewRevert;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  state.workingDirectory = workspaceRoot;
  vi.stubEnv('OPENWORK_SKILLS_DIR', skillRoot);
});

describe('tool path aliases', () => {
  it('按 path > filePath > file_path 的优先级解析非空字符串', () => {
    expect(readToolPathInput({ path: '/a', filePath: '/b', file_path: '/c' })).toBe('/a');
    expect(readToolPathInput({ filePath: '/b', file_path: '/c' })).toBe('/b');
    expect(readToolPathInput({ file_path: '/c' })).toBe('/c');
  });

  it('忽略空白与非字符串取值', () => {
    expect(readToolPathInput({ path: '   ' })).toBeUndefined();
    expect(readToolPathInput({ path: 42, filePath: '' })).toBeUndefined();
    expect(readToolPathInput({ path: '  ', file_path: '/c' })).toBe('/c');
  });

  it('pickToolPathInput 在没有可用路径时抛错', () => {
    expect(pickToolPathInput({ file_path: '/c' })).toBe('/c');
    expect(() => pickToolPathInput({})).toThrow('Either path or filePath is required');
    expect(() => pickToolPathInput({ path: ' ' })).toThrow('Either path or filePath is required');
  });
});

describe('workspace read/list path alias schema', () => {
  it('read 接受 path | filePath | file_path，且三者全空时拒绝', () => {
    expect(readTool.inputSchema.safeParse({ file_path: '/tmp/a.txt' }).success).toBe(true);
    expect(readTool.inputSchema.safeParse({ filePath: '/tmp/a.txt' }).success).toBe(true);
    expect(readTool.inputSchema.safeParse({ path: '/tmp/a.txt' }).success).toBe(true);
    expect(readTool.inputSchema.safeParse({ path: '  ', file_path: '' }).success).toBe(false);
    expect(readTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it('list 接受 file_path 并保留 depth 默认值', () => {
    const parsed = listTool.inputSchema.safeParse({ file_path: '/tmp' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.depth).toBe(2);
    expect(listTool.inputSchema.safeParse({}).success).toBe(false);
  });
});

describe('workspace tools resolve file_path under the session workspace', () => {
  it('read 只带 file_path 且位于工作区内时成功读取', async () => {
    const filePath = join(workspaceRoot, 'inside.txt');
    writeFileSync(filePath, 'inside-content\n', 'utf8');

    const result = await executeReadTool({ file_path: filePath }, SESSION_ID);

    expect(result.path).toBe(filePath);
    expect(result.content).toBe('inside-content\n');
  });

  it('read 只带 file_path 且位于工作区外时被拒绝', async () => {
    const filePath = join(outsideRoot, 'outside.txt');
    writeFileSync(filePath, 'outside-content\n', 'utf8');

    await expect(executeReadTool({ file_path: filePath }, SESSION_ID)).rejects.toThrow(
      /outside current session workspace/,
    );
  });

  it('list 只带 file_path 且位于工作区外时被拒绝', async () => {
    await expect(executeListTool({ file_path: outsideRoot, depth: 1 }, SESSION_ID)).rejects.toThrow(
      /outside current session workspace/,
    );
  });

  it('path(工作区内) 与 file_path(工作区外) 同时存在时以 path 为准', async () => {
    const insidePath = join(workspaceRoot, 'precedence.txt');
    const outsidePath = join(outsideRoot, 'precedence.txt');
    writeFileSync(insidePath, 'inside-precedence\n', 'utf8');
    writeFileSync(outsidePath, 'outside-precedence\n', 'utf8');

    const result = await executeReadTool({ path: insidePath, file_path: outsidePath }, SESSION_ID);

    expect(result.path).toBe(insidePath);
    expect(result.content).toBe('inside-precedence\n');
  });

  it('path(工作区外) 与 file_path(工作区内) 同时存在时以 path 为准并拒绝', async () => {
    const insidePath = join(workspaceRoot, 'precedence-reverse.txt');
    const outsidePath = join(outsideRoot, 'precedence-reverse.txt');
    writeFileSync(insidePath, 'inside-precedence\n', 'utf8');
    writeFileSync(outsidePath, 'outside-precedence\n', 'utf8');

    await expect(
      executeReadTool({ path: outsidePath, file_path: insidePath }, SESSION_ID),
    ).rejects.toThrow(/outside current session workspace/);
  });
});

describe('workspace tools skill resource boundary', () => {
  it('read/list 可读取会话工作区外的技能资源', async () => {
    const assetDir = join(skillRoot, 'templates');
    mkdirSync(assetDir, { recursive: true });
    const assetPath = join(assetDir, 'viewer.html');
    writeFileSync(assetPath, '<!doctype html>\n', 'utf8');

    const readResult = await executeReadTool({ file_path: assetPath }, SESSION_ID);
    expect(readResult.content).toBe('<!doctype html>\n');

    const rootListing = await executeListTool({ path: skillRoot, depth: 1 }, SESSION_ID);
    expect(rootListing.path).toBe(skillRoot);
    expect(rootListing.nodes.some((node) => node.name === 'templates')).toBe(true);
  });

  it('write 与 workspace_create_directory 对技能资源保持阻断', async () => {
    const assetPath = join(skillRoot, 'templates', 'viewer.html');

    await expect(
      executeWriteTool({ path: assetPath, content: 'overwrite' }, undefined, {
        sessionId: SESSION_ID,
      }),
    ).rejects.toThrow(/outside current session workspace/);

    await expect(
      executeWorkspaceCreateDirectory({ path: join(skillRoot, 'new-dir') }, SESSION_ID),
    ).rejects.toThrow(/outside current session workspace/);
  });

  it('workspace_review_status/revert 对技能资源保持严格，read/list 同路径仍可读', async () => {
    const assetDir = join(skillRoot, 'templates');
    mkdirSync(assetDir, { recursive: true });
    const assetPath = join(assetDir, 'viewer.html');
    writeFileSync(assetPath, '<!doctype html>\n', 'utf8');

    const readResult = await executeReadTool({ file_path: assetPath }, SESSION_ID);
    expect(readResult.content).toBe('<!doctype html>\n');
    const rootListing = await executeListTool({ path: skillRoot, depth: 1 }, SESSION_ID);
    expect(rootListing.path).toBe(skillRoot);

    await expect(executeWorkspaceReviewStatus({ path: skillRoot }, SESSION_ID)).rejects.toThrow(
      /outside current session workspace/,
    );
    await expect(
      executeWorkspaceReviewRevert(
        { path: skillRoot, filePath: 'templates/viewer.html' },
        SESSION_ID,
      ),
    ).rejects.toThrow(/outside current session workspace/);
  });
});
