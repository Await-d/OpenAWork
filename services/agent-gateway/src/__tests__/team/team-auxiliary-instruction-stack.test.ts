import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as MemoryStoreModule from '../../memory/memory-store.js';
import type * as AuxiliaryStackModule from '../../team/team-auxiliary-instruction-stack.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let memoryStore: typeof MemoryStoreModule;
let auxiliaryStack: typeof AuxiliaryStackModule;

const USER_ID = 'u-aux-stack';
const TEAM_WORKSPACE_ID = 'tw-aux-stack';
const RECEPTION_SESSION_ID = 's-aux-stack-reception';
const PM1_SESSION_ID = 's-aux-stack-pm1';
const workspaceRoots: string[] = [];

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'aux-stack@example.com',
  ]);
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  memoryStore = await import('../../memory/memory-store.js');
  auxiliaryStack = await import('../../team/team-auxiliary-instruction-stack.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
});

afterAll(async () => {
  await dbModule.closeDb();
  for (const root of workspaceRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('buildAuxiliaryTeamInstructionPrefix', () => {
  it('沿 team parent session 读取工作区文件和当前层可读知识', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'openawork-aux-stack-'));
    workspaceRoots.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.agentdocs'), { recursive: true });
    writeFileSync(join(workspaceRoot, 'architecture.md'), '# 架构\n辅助路径也要遵守架构边界。');
    writeFileSync(
      join(workspaceRoot, '.agentdocs', 'project-memory.md'),
      '# 项目记忆\n辅助路径应读取项目记忆。',
    );

    dbModule.sqliteRun(
      `INSERT INTO team_workspaces (id, user_id, name, default_working_root)
       VALUES (?, ?, '辅助栈工作区', ?)`,
      [TEAM_WORKSPACE_ID, USER_ID, workspaceRoot],
    );
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, role_layer)
       VALUES (?, ?, 'Reception', ?, 'reception')`,
      [
        RECEPTION_SESSION_ID,
        USER_ID,
        JSON.stringify({
          teamWorkspaceId: TEAM_WORKSPACE_ID,
          workingDirectory: workspaceRoot,
        }),
      ],
    );
    dbModule.sqliteRun(
      `INSERT INTO sessions (
         id, user_id, title, metadata_json, role_layer, team_parent_session_id
       ) VALUES (?, ?, 'PM1', '{}', 'pm1', ?)`,
      [PM1_SESSION_ID, USER_ID, RECEPTION_SESSION_ID],
    );
    memoryStore.createMemory(USER_ID, {
      key: 'knowledge:pm1-only',
      roleLayers: ['pm1'],
      source: 'manual',
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      type: 'project_context',
      value: 'PM1 辅助路径必须读取这条工作区知识。',
    });
    memoryStore.createMemory(USER_ID, {
      key: 'knowledge:executor-only',
      roleLayers: ['executor'],
      source: 'manual',
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      type: 'project_context',
      value: '执行层专用知识不应进入 PM1 辅助路径。',
    });

    const prefix = await auxiliaryStack.buildAuxiliaryTeamInstructionPrefix({
      userId: USER_ID,
      sessionId: PM1_SESSION_ID,
      teamWorkspaceId: null,
      roleLayer: 'pm1',
    });

    expect(prefix).toContain('辅助路径也要遵守架构边界。');
    expect(prefix).toContain('辅助路径应读取项目记忆。');
    expect(prefix).toContain('workspace-knowledge:pm1');
    expect(prefix).toContain('PM1 辅助路径必须读取这条工作区知识。');
    expect(prefix).not.toContain('执行层专用知识不应进入 PM1 辅助路径。');
  });

  it('显式团队工作区与 session 归属不一致时回退显式工作区默认根目录', async () => {
    const targetRoot = mkdtempSync(join(tmpdir(), 'openawork-aux-target-'));
    const otherRoot = mkdtempSync(join(tmpdir(), 'openawork-aux-other-'));
    workspaceRoots.push(targetRoot, otherRoot);
    writeFileSync(join(targetRoot, 'architecture.md'), '# 架构\n当前团队默认根目录架构。');
    writeFileSync(join(otherRoot, 'architecture.md'), '# 架构\n其它团队目录架构不应注入。');

    const otherTeamWorkspaceId = 'tw-aux-stack-other';
    dbModule.sqliteRun(
      `INSERT INTO team_workspaces (id, user_id, name, default_working_root)
       VALUES (?, ?, '显式目标工作区', ?)`,
      [TEAM_WORKSPACE_ID, USER_ID, targetRoot],
    );
    dbModule.sqliteRun(
      `INSERT INTO team_workspaces (id, user_id, name, default_working_root)
       VALUES (?, ?, '其它工作区', ?)`,
      [otherTeamWorkspaceId, USER_ID, otherRoot],
    );
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, role_layer)
       VALUES (?, ?, '其它团队会话', ?, 'pm1')`,
      [
        's-aux-stack-other-team',
        USER_ID,
        JSON.stringify({
          teamWorkspaceId: otherTeamWorkspaceId,
          workingDirectory: otherRoot,
        }),
      ],
    );

    const prefix = await auxiliaryStack.buildAuxiliaryTeamInstructionPrefix({
      userId: USER_ID,
      sessionId: 's-aux-stack-other-team',
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      roleLayer: 'pm1',
    });

    expect(prefix).toContain('当前团队默认根目录架构。');
    expect(prefix).not.toContain('其它团队目录架构不应注入。');
  });
});
