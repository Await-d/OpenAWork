import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as PlannerModule from '../../team/init/team-init-planner.js';
import type * as StoreModule from '../../team/init/team-init-store.js';
import type * as RunnerModule from '../../team/init/team-init-runner.js';
import type * as AutorunModule from '../../team/init/team-init-autorun.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

// 无 LLM：understand-architecture 走启发式兜底。
vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: async () => null,
}));

let dbModule: typeof DbModule;
let planner: typeof PlannerModule;
let store: typeof StoreModule;
let runner: typeof RunnerModule;
let autorun: typeof AutorunModule;

const USER_ID = 'u-team-init';
const TEAM_WORKSPACE_ID = 'tw-team-init';

let workspaceRoots: string[] = [];

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
}

function seedSessionWithMetadata(sessionId: string, metadata: Record<string, unknown>): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, state_status, role_layer)
     VALUES (?, ?, 'team-session', ?, 'idle', 'reception')`,
    [sessionId, USER_ID, JSON.stringify(metadata)],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  // 测试环境未设置 WORKSPACE_ROOTS / WORKSPACE_ROOT，access 非受限，
  // validateWorkspacePath 直接返回 resolve 后路径，临时目录可直接使用。
  const root = mkdtempSync(join(tmpdir(), 'openawork-team-init-'));
  workspaceRoots = [root];

  planner = await import('../../team/init/team-init-planner.js');
  store = await import('../../team/init/team-init-store.js');
  runner = await import('../../team/init/team-init-runner.js');
  autorun = await import('../../team/init/team-init-autorun.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
});

afterAll(async () => {
  await dbModule.closeDb();
  for (const root of workspaceRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('planTeamInit', () => {
  it('空目录判定为 empty，architecture/记忆步骤标 not_applicable', async () => {
    const emptyDir = join(workspaceRoots[0]!, 'empty-project');
    mkdirSync(emptyDir, { recursive: true });

    const state = await planner.planTeamInit({
      workingRoot: emptyDir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });

    expect(state.projectKind).toBe('empty');
    expect(state.phase).toBe('proposed');
    const scan = state.steps.find((s) => s.key === 'scan-shared-record');
    expect(scan?.status).toBe('done');
    expect(state.steps.find((s) => s.key === 'understand-architecture')?.status).toBe(
      'not_applicable',
    );
    expect(state.steps.find((s) => s.key === 'scaffold-memory')?.status).toBe('proposed');
    expect(state.steps.find((s) => s.key === 'bind-tools-per-layer')?.status).toBe('proposed');
  });

  it('含 package.json 的目录判定为 existing，理解架构步骤可执行', async () => {
    const existingDir = join(workspaceRoots[0]!, 'existing-project');
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(join(existingDir, 'package.json'), '{"name":"demo"}', 'utf8');

    const state = await planner.planTeamInit({
      workingRoot: existingDir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });

    expect(state.projectKind).toBe('existing');
    expect(state.steps.find((s) => s.key === 'understand-architecture')?.status).toBe('proposed');
    expect(state.steps.find((s) => s.key === 'scaffold-memory')?.status).toBe('not_applicable');
  });
});

describe('team-init-store + runner', () => {
  it('确认执行 read-project-level1 后回写 result 并推进 phase', async () => {
    const existingDir = join(workspaceRoots[0]!, 'proj-level1');
    mkdirSync(join(existingDir, 'src'), { recursive: true });
    writeFileSync(join(existingDir, 'package.json'), '{"name":"demo"}', 'utf8');

    const state = await planner.planTeamInit({
      workingRoot: existingDir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    seedSessionWithMetadata('s-init-1', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      workingDirectory: existingDir,
      teamInit: state,
    });

    const result = await runner.runTeamInitStep({
      sessionId: 's-init-1',
      userId: USER_ID,
      stepKey: 'read-project-level1',
    });

    expect(result.ok).toBe(true);
    const step = result.state?.steps.find((s) => s.key === 'read-project-level1');
    expect(step?.status).toBe('done');
    expect((step?.result?.['directories'] as string[]) ?? []).toContain('src');
  });

  it('并发确认同一步骤时只执行一次（in-flight 守卫，防重复 LLM / 写入）', async () => {
    const existingDir = join(workspaceRoots[0]!, 'proj-concurrent');
    mkdirSync(join(existingDir, 'src'), { recursive: true });
    writeFileSync(join(existingDir, 'package.json'), '{"name":"demo"}', 'utf8');

    const state = await planner.planTeamInit({
      workingRoot: existingDir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    seedSessionWithMetadata('s-init-concurrent', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      workingDirectory: existingDir,
      teamInit: state,
    });

    // Two confirms for the SAME step land before the first settles (double-click
    // / client retry). The in-flight guard must let exactly one execute and make
    // the other a no-op (`step-already-running`) instead of re-running the step.
    const [first, second] = await Promise.all([
      runner.runTeamInitStep({
        sessionId: 's-init-concurrent',
        userId: USER_ID,
        stepKey: 'read-project-level1',
      }),
      runner.runTeamInitStep({
        sessionId: 's-init-concurrent',
        userId: USER_ID,
        stepKey: 'read-project-level1',
      }),
    ]);

    const oks = [first, second].filter((r) => r.ok);
    const rejected = [first, second].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBe('step-already-running');

    // After the guard releases, a subsequent confirm short-circuits on `done`.
    const third = await runner.runTeamInitStep({
      sessionId: 's-init-concurrent',
      userId: USER_ID,
      stepKey: 'read-project-level1',
    });
    expect(third.ok).toBe(true);
    expect(third.state?.steps.find((s) => s.key === 'read-project-level1')?.status).toBe('done');
  });

  it('bind-tools-per-layer 把绑定同步进 teamDefinition.memberSlots', async () => {
    const existingDir = join(workspaceRoots[0]!, 'proj-bind');
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(join(existingDir, 'package.json'), '{"name":"demo"}', 'utf8');

    const state = await planner.planTeamInit({
      workingRoot: existingDir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    seedSessionWithMetadata('s-init-bind', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      workingDirectory: existingDir,
      teamInit: state,
      teamDefinition: {
        version: 2,
        source: { kind: 'blank' },
        requiredRoleBindings: [],
        memberSlots: [
          {
            id: 'exec-1',
            layer: 'executor',
            specialty: 'backend',
            displayName: '执行者',
            personaKey: 'default',
            toolsets: ['read'],
            required: true,
          },
        ],
      },
    });

    const result = await runner.runTeamInitStep({
      sessionId: 's-init-bind',
      userId: USER_ID,
      stepKey: 'bind-tools-per-layer',
    });
    expect(result.ok).toBe(true);
    expect(result.state?.bindings.perLayer.executor).toBeDefined();

    const ctx = store.loadTeamInitSessionContext('s-init-bind', USER_ID);
    expect(ctx).not.toBeNull();
  });

  it('markTeamInitSkipped 把整体 phase 置 skipped', async () => {
    const dir = join(workspaceRoots[0]!, 'proj-skip');
    mkdirSync(dir, { recursive: true });
    const state = await planner.planTeamInit({
      workingRoot: dir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    seedSessionWithMetadata('s-init-skip', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      workingDirectory: dir,
      teamInit: state,
    });

    const next = store.markTeamInitSkipped('s-init-skip', USER_ID);
    expect(next?.phase).toBe('skipped');
  });

  it('planTeamInit 产物通过 session metadata schema 校验', async () => {
    const dir = join(workspaceRoots[0]!, 'proj-schema');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"demo"}', 'utf8');
    const state = await planner.planTeamInit({
      workingRoot: dir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    const { validateSessionMetadataPatch } =
      await import('../../session/session-workspace-metadata.js');
    const result = validateSessionMetadataPatch({ teamInit: state });
    expect(result.success).toBe(true);
  });
});

describe('ensureTeamInitBeforeTask（任务前自动初始化）', () => {
  it('未完成清单 → 自动跑完所有 proposed 步骤并推进 phase', async () => {
    const dir = join(workspaceRoots[0]!, 'autorun-existing');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"demo"}', 'utf8');
    const state = await planner.planTeamInit({
      workingRoot: dir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    seedSessionWithMetadata('s-autorun-1', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      workingDirectory: dir,
      teamInit: state,
    });

    const result = await autorun.ensureTeamInitBeforeTask({
      sessionId: 's-autorun-1',
      userId: USER_ID,
    });

    expect(result.ran).toBe(true);
    expect(result.executedSteps.length > 0).toBe(true);
    // 跑完后不应再有 proposed 步骤，phase 推进到 completed。
    const after = store.loadTeamInitSessionContext('s-autorun-1', USER_ID);
    expect(after?.teamInit?.steps.some((s) => s.status === 'proposed')).toBe(false);
    expect(after?.teamInit?.phase).toBe('completed');
  });

  it('已 skipped 的清单 → 不自动跑（尊重用户选择）', async () => {
    const dir = join(workspaceRoots[0]!, 'autorun-skipped');
    mkdirSync(dir, { recursive: true });
    const state = await planner.planTeamInit({
      workingRoot: dir,
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      userId: USER_ID,
    });
    seedSessionWithMetadata('s-autorun-skip', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      workingDirectory: dir,
      teamInit: { ...state, phase: 'skipped' },
    });

    const result = await autorun.ensureTeamInitBeforeTask({
      sessionId: 's-autorun-skip',
      userId: USER_ID,
    });
    expect(result.ran).toBe(false);
    expect(result.reason).toBe('skipped');
  });

  it('无初始化清单的会话 → ran=false, reason=no-plan', async () => {
    seedSessionWithMetadata('s-autorun-noplan', {
      teamWorkspaceId: TEAM_WORKSPACE_ID,
    });
    const result = await autorun.ensureTeamInitBeforeTask({
      sessionId: 's-autorun-noplan',
      userId: USER_ID,
    });
    expect(result.ran).toBe(false);
    expect(result.reason).toBe('no-plan');
  });
});
