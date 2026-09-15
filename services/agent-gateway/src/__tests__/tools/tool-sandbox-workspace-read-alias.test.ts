import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MessageStoreV2 from '../../message/message-store-v2.js';

const { TEST_WORKSPACE, OUTSIDE_ROOT, SKILL_ROOT, SKILL_EVIL_ROOT } = vi.hoisted(() => ({
  TEST_WORKSPACE: `/tmp/openawork-tool-sandbox-alias-${process.pid}`,
  OUTSIDE_ROOT: `/tmp/openawork-tool-sandbox-alias-outside-${process.pid}`,
  SKILL_ROOT: `/tmp/openawork-tool-sandbox-alias-skills-${process.pid}`,
  SKILL_EVIL_ROOT: `/tmp/openawork-tool-sandbox-alias-skills-evil-${process.pid}`,
}));

const mocks = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(() => []),
  roleLayer: 'executor' as string | null,
  teamParentSessionId: null as string | null,
  handoffState: null as string | null,
  requireBoundWorkspace: false,
  metadataJson: '{}' as string,
  sqliteGetMock: vi.fn((query: string) => {
    if (query.includes('SELECT user_id FROM sessions')) {
      return { user_id: 'user-1' };
    }
    if (query.includes('role_layer') && query.includes('team_parent_session_id')) {
      return {
        metadata_json: mocks.metadataJson,
        user_id: 'user-1',
        role_layer: mocks.requireBoundWorkspace ? mocks.roleLayer : null,
        team_parent_session_id: mocks.requireBoundWorkspace ? mocks.teamParentSessionId : null,
        handoff_state: mocks.requireBoundWorkspace ? mocks.handoffState : null,
      };
    }
    if (query.includes('SELECT metadata_json, user_id FROM sessions')) {
      return { metadata_json: mocks.metadataJson, user_id: 'user-1' };
    }
    if (query.includes('SELECT metadata_json FROM sessions')) {
      return { metadata_json: mocks.metadataJson };
    }
    if (query.includes('SELECT role_layer FROM sessions')) {
      return { role_layer: mocks.roleLayer };
    }
    return undefined;
  }),
  sqliteRunMock: vi.fn(),
  transitionToolToRunningMock: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: TEST_WORKSPACE,
  WORKSPACE_ROOTS: [TEST_WORKSPACE],
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
  sqliteRunWithRowId: vi.fn(() => 1),
}));

vi.mock('../../message/message-store-v2.js', async () => {
  const actual = await vi.importActual<typeof MessageStoreV2>('../../message/message-store-v2.js');
  return {
    ...actual,
    transitionToolToRunning: mocks.transitionToolToRunningMock,
  };
});

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: vi.fn(),
}));

import { createDefaultSandbox } from '../../tools/tool-sandbox.js';

const INSIDE_FILE = join(TEST_WORKSPACE, 'inside.txt');
const OUTSIDE_FILE = join(OUTSIDE_ROOT, 'outside.txt');
const SKILL_ASSET = join(SKILL_ROOT, 'templates', 'viewer.html');
const SKILL_ENV_FILE = join(SKILL_ROOT, '.env');
const SKILL_ESCAPE_LINK = join(SKILL_ROOT, 'escape.html');
const SKILL_EVIL_ASSET = join(SKILL_EVIL_ROOT, 'asset.html');

function outputText(output: unknown): string {
  return typeof output === 'string' ? output : JSON.stringify(output);
}

async function runTool(
  toolName: string,
  rawInput: Record<string, unknown>,
): Promise<{ isError: boolean | undefined; output: unknown }> {
  const sandbox = createDefaultSandbox();
  const result = await sandbox.execute(
    { toolCallId: `call-${toolName}-${Math.random().toString(36).slice(2)}`, toolName, rawInput },
    new AbortController().signal,
    'plain-session',
  );
  return { isError: result.isError, output: result.output };
}

describe('tool-sandbox workspace path alias and skill resource boundary', () => {
  beforeAll(() => {
    process.env['OPENWORK_SKILLS_DIR'] = SKILL_ROOT;
  });

  afterAll(() => {
    delete process.env['OPENWORK_SKILLS_DIR'];
  });

  beforeEach(() => {
    for (const dir of [TEST_WORKSPACE, OUTSIDE_ROOT, SKILL_ROOT, SKILL_EVIL_ROOT]) {
      rmSync(dir, { recursive: true, force: true });
    }
    mkdirSync(TEST_WORKSPACE, { recursive: true });
    mkdirSync(OUTSIDE_ROOT, { recursive: true });
    mkdirSync(join(SKILL_ROOT, 'templates'), { recursive: true });
    mkdirSync(SKILL_EVIL_ROOT, { recursive: true });
    writeFileSync(INSIDE_FILE, 'inside-content\n', 'utf8');
    writeFileSync(OUTSIDE_FILE, 'outside-content\n', 'utf8');
    writeFileSync(SKILL_ASSET, 'skill-asset-content\n', 'utf8');
    writeFileSync(SKILL_ENV_FILE, 'SECRET=1\n', 'utf8');
    writeFileSync(SKILL_EVIL_ASSET, 'evil-content\n', 'utf8');
    symlinkSync(OUTSIDE_FILE, SKILL_ESCAPE_LINK);

    mocks.sqliteAllMock.mockReset();
    mocks.sqliteAllMock.mockImplementation(() => []);
    mocks.sqliteGetMock.mockClear();
    mocks.sqliteRunMock.mockReset();
    mocks.transitionToolToRunningMock.mockReset();
    mocks.roleLayer = 'executor';
    mocks.teamParentSessionId = null;
    mocks.handoffState = null;
    mocks.requireBoundWorkspace = false;
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });
  });

  afterEach(() => {
    vi.clearAllMocks();
    for (const dir of [TEST_WORKSPACE, OUTSIDE_ROOT, SKILL_ROOT, SKILL_EVIL_ROOT]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('read 只带 file_path 且位于工作区内时成功读取', async () => {
    const result = await runTool('read', { file_path: INSIDE_FILE });

    expect(result.isError).toBe(false);
    expect(outputText(result.output)).toContain('inside-content');
  });

  it('read 只带 file_path 且位于工作区外时被 layer 1 拒绝', async () => {
    const result = await runTool('read', { file_path: OUTSIDE_FILE });

    expect(result.isError).toBe(true);
    expect(outputText(result.output)).toContain('目标路径超出当前工作区范围');
    expect(outputText(result.output)).not.toContain('outside-content');
  });

  it('list 只带 file_path 且位于工作区外时被 layer 1 拒绝', async () => {
    const result = await runTool('list', { file_path: OUTSIDE_ROOT });

    expect(result.isError).toBe(true);
    expect(outputText(result.output)).toContain('目标路径超出当前工作区范围');
  });

  it('path(工作区内) 与 file_path(工作区外) 同时存在时两层都以 path 为准', async () => {
    const result = await runTool('read', { path: INSIDE_FILE, file_path: OUTSIDE_FILE });

    expect(result.isError).toBe(false);
    expect(outputText(result.output)).toContain('inside-content');
    expect(outputText(result.output)).not.toContain('outside-content');
  });

  it('path(工作区外) 与 file_path(工作区内) 同时存在时以 path 为准并拒绝', async () => {
    const result = await runTool('read', { path: OUTSIDE_FILE, file_path: INSIDE_FILE });

    expect(result.isError).toBe(true);
    expect(outputText(result.output)).toContain('目标路径超出当前工作区范围');
  });

  it('绑定但缺少 workingDirectory 的会话 + 仅 file_path 的 read 返回缺工作区错误', async () => {
    mocks.requireBoundWorkspace = true;
    mocks.metadataJson = '{}';

    const result = await runTool('read', { file_path: INSIDE_FILE });

    expect(result.isError).toBe(true);
    expect(outputText(result.output)).toContain('当前会话未绑定工作区');
    expect(
      mocks.sqliteRunMock.mock.calls.some(
        ([query]) => typeof query === 'string' && query.includes('INSERT INTO permission_requests'),
      ),
    ).toBe(false);
  });

  it('read 可读取会话工作区外的技能资源', async () => {
    const result = await runTool('read', { file_path: SKILL_ASSET });

    expect(result.isError).toBe(false);
    expect(outputText(result.output)).toContain('skill-asset-content');
  });

  it('write 对技能资源保持阻断', async () => {
    const result = await runTool('write', { path: SKILL_ASSET, content: 'overwritten' });

    expect(result.isError).toBe(true);
    expect(outputText(result.output)).toContain('目标路径超出当前工作区范围');
    expect(outputText(result.output)).not.toContain('overwritten');
  });

  it('edit 与 multi_edit 对技能资源保持阻断', async () => {
    const editResult = await runTool('edit', {
      filePath: SKILL_ASSET,
      oldString: 'a',
      newString: 'b',
    });
    expect(editResult.isError).toBe(true);
    expect(outputText(editResult.output)).toContain('目标路径超出当前工作区范围');

    const multiEditResult = await runTool('multi_edit', {
      filePath: SKILL_ASSET,
      edits: [{ oldString: 'a', newString: 'b' }],
    });
    expect(multiEditResult.isError).toBe(true);
    expect(outputText(multiEditResult.output)).toContain('目标路径超出当前工作区范围');
  });

  it('符号链接逃逸技能根、同名前缀兄弟目录都被拒绝', async () => {
    const escapeResult = await runTool('read', { file_path: SKILL_ESCAPE_LINK });
    expect(escapeResult.isError).toBe(true);
    expect(outputText(escapeResult.output)).toContain('目标路径超出当前工作区范围');

    const evilResult = await runTool('read', { file_path: SKILL_EVIL_ASSET });
    expect(evilResult.isError).toBe(true);
    expect(outputText(evilResult.output)).toContain('目标路径超出当前工作区范围');
  });

  it('技能根自身可作为 read/list 目标', async () => {
    const result = await runTool('read', { file_path: SKILL_ROOT });

    expect(result.isError).toBe(false);
    expect(outputText(result.output)).toContain('templates');
  });

  it('技能资源读取仍然执行 agentignore 规则', async () => {
    const result = await runTool('read', { file_path: SKILL_ENV_FILE });

    expect(result.isError).toBe(true);
    expect(outputText(result.output)).toContain('agentignore rules');
    expect(outputText(result.output)).not.toContain('SECRET=1');
  });
});
