/**
 * 渠道成员 ACL 的路径类权限（读写范围）接线回归。
 *
 * 背景：`allowReadHome` / `readablePathPrefixes` / `allowWriteOutside` 此前只参与
 * ACL 合并计算，没有任何执行侧消费者（配了不生效）。本文件锁定它们现在真正约束
 * 「会话工作区之外」的读写，并且读写分离、默认不放宽。
 *
 * **前提**：放宽只发生在「会话工作区之外」这一层，所以用例显式 seed 了
 * `workingDirectory`。渠道会话默认不绑定工作目录（`buildChannelSessionMetadata`
 * 不写该键），此时这条判定整段跳过——换言之，生产默认渠道会话并不受本文件覆盖的
 * 分支约束，接线是在渠道会话被绑定工作目录之后才起作用的。
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ChannelActorScopeModule from '../../channels/channel-actor-scope.js';
import type { ChannelPermissions } from '../../channels/types.js';
import type * as WorkspaceSafetyModule from '../../workspace/workspace-safety.js';

const state = vi.hoisted(() => ({
  metadata: {} as Record<string, unknown>,
}));

vi.mock('../../infra/db.js', () => ({
  get WORKSPACE_ACCESS_RESTRICTED() {
    return false;
  },
  get WORKSPACE_ROOT() {
    return '/';
  },
  get WORKSPACE_ROOTS() {
    return ['/'];
  },
  sqliteGet: (query: string) => {
    if (query.includes('metadata_json, user_id')) {
      return { metadata_json: JSON.stringify(state.metadata), user_id: 'user-1' };
    }
    return undefined;
  },
}));

const WORKSPACE_DIR = '/tmp/openawork-channel-ws';
const OUTSIDE_FILE = '/tmp/openawork-channel-outside/secret.txt';
/**
 * 渠道「Home」权限指向的是 **OpenAWork 数据目录**（`resolveGatewayDataDir`），
 * 不是进程用户的家目录；用环境变量固定，测试不依赖真实平台数据目录。
 */
const DATA_DIR = '/tmp/openawork-channel-data-dir';
const DATA_DIR_FILE = join(DATA_DIR, 'sessions', 'probe.json');

const DENY_ALL: ChannelPermissions = {
  allowReadHome: false,
  readablePathPrefixes: [],
  allowWriteOutside: false,
  allowShell: false,
  allowSubAgents: false,
};

function channelMetadata(permissions: Partial<ChannelPermissions>): Record<string, unknown> {
  return {
    workingDirectory: WORKSPACE_DIR,
    channel: { permissions: { ...DENY_ALL, ...permissions } },
  };
}

/**
 * 渠道会话但**未绑定工作目录**（`buildChannelSessionMetadata` 的默认形态）：
 * 隐式边界取默认工作目录（`resolveUnboundSessionWorkspaceFallback`），路径类 ACL 因此参与判定。
 */
function unboundChannelMetadata(permissions: Partial<ChannelPermissions>): Record<string, unknown> {
  return {
    source: 'channel',
    channel: { permissions: { ...DENY_ALL, ...permissions } },
  };
}

let safety: typeof WorkspaceSafetyModule;
let actorScope: typeof ChannelActorScopeModule;

beforeEach(async () => {
  vi.stubEnv('OPENAWORK_DATA_DIR', DATA_DIR);
  // resetModules 之后两次动态导入共享同一份模块注册表，作用域的 AsyncLocalStorage
  // 实例因此与 workspace-safety 内部看到的那个一致。
  vi.resetModules();
  safety = await import('../../workspace/workspace-safety.js');
  actorScope = await import('../../channels/channel-actor-scope.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('渠道路径权限接线', () => {
  it('未配置渠道权限时，工作区外的读写都被拒绝', () => {
    state.metadata = { workingDirectory: WORKSPACE_DIR };

    for (const access of ['read', 'write'] as const) {
      expect(
        safety.validateSessionWorkspacePath({ path: OUTSIDE_FILE, sessionId: 's1', access }),
      ).toMatchObject({ ok: false, reason: 'outside-session-workspace' });
    }
  });

  it('allowWriteOutside 只放宽写，不放宽读', () => {
    state.metadata = channelMetadata({ allowWriteOutside: true });

    expect(
      safety.validateSessionWorkspacePath({ path: OUTSIDE_FILE, sessionId: 's1', access: 'write' }),
    ).toMatchObject({ ok: true });
    expect(
      safety.validateSessionWorkspacePath({ path: OUTSIDE_FILE, sessionId: 's1', access: 'read' }),
    ).toMatchObject({ ok: false, reason: 'outside-session-workspace' });
  });

  it('readablePathPrefixes 只放宽读，不放宽写', () => {
    state.metadata = channelMetadata({ readablePathPrefixes: ['/tmp/openawork-channel-outside'] });

    expect(
      safety.validateSessionWorkspacePath({ path: OUTSIDE_FILE, sessionId: 's1', access: 'read' }),
    ).toMatchObject({ ok: true });
    expect(
      safety.validateSessionWorkspacePath({ path: OUTSIDE_FILE, sessionId: 's1', access: 'write' }),
    ).toMatchObject({ ok: false, reason: 'outside-session-workspace' });
  });

  it('allowReadHome 放宽数据目录内的读，不放宽写', () => {
    state.metadata = channelMetadata({ allowReadHome: true });

    expect(
      safety.validateSessionWorkspacePath({ path: DATA_DIR_FILE, sessionId: 's1', access: 'read' }),
    ).toMatchObject({ ok: true });
    expect(
      safety.validateSessionWorkspacePath({
        path: DATA_DIR_FILE,
        sessionId: 's1',
        access: 'write',
      }),
    ).toMatchObject({ ok: false, reason: 'outside-session-workspace' });
  });

  it('allowReadHome 不放行进程用户家目录（凭据不在渠道可读范围内）', () => {
    state.metadata = channelMetadata({ allowReadHome: true });

    expect(
      safety.validateSessionWorkspacePath({
        path: join(homedir(), '.ssh', 'id_ed25519'),
        sessionId: 's1',
        access: 'read',
      }),
    ).toMatchObject({ ok: false, reason: 'outside-session-workspace' });
  });

  it('缺省 access 按写处理：读白名单不会顺带放行写路径', () => {
    state.metadata = channelMetadata({
      readablePathPrefixes: ['/tmp/openawork-channel-outside'],
      allowReadHome: true,
    });

    expect(
      safety.validateSessionWorkspacePath({ path: OUTSIDE_FILE, sessionId: 's1' }),
    ).toMatchObject({ ok: false, reason: 'outside-session-workspace' });
    expect(
      safety.validateSessionWorkspacePath({ path: DATA_DIR_FILE, sessionId: 's1' }),
    ).toMatchObject({
      ok: false,
      reason: 'outside-session-workspace',
    });
  });

  it('会话工作区内的路径始终放行，不依赖渠道权限', () => {
    state.metadata = { workingDirectory: WORKSPACE_DIR };

    expect(
      safety.validateSessionWorkspacePath({
        path: join(WORKSPACE_DIR, 'notes.md'),
        sessionId: 's1',
        access: 'write',
      }),
    ).toMatchObject({ ok: true });
  });

  it('轮次级成员权限优先于会话 metadata：同群成员不会互相改权限', async () => {
    // 会话 metadata 上是「别人」的宽松权限（允许写工作区外）。
    state.metadata = channelMetadata({ allowWriteOutside: true });

    const denied = await actorScope.runWithChannelActorPolicy(
      { permissions: DENY_ALL, toolAllowlist: null },
      async () =>
        safety.validateSessionWorkspacePath({
          path: OUTSIDE_FILE,
          sessionId: 's1',
          access: 'write',
        }),
    );

    expect(denied).toMatchObject({ ok: false, reason: 'outside-session-workspace' });

    // 作用域外的读取仍然回退 metadata（供无作用域的续跑路径使用）。
    expect(
      safety.validateSessionWorkspacePath({ path: OUTSIDE_FILE, sessionId: 's1', access: 'write' }),
    ).toMatchObject({ ok: true });
  });

  it('写工具不得复用读断言：仅放开读时 workspace_review_revert 仍拒绝工作区外路径', async () => {
    // 回归来源：该工具曾复用 `assertSearchablePath`（读语义），且它绕过 tool-sandbox
    // 的 FILE_TOOLS 第一道闸，于是渠道的读放宽被当成了写授权。
    state.metadata = channelMetadata({
      allowReadHome: true,
      readablePathPrefixes: ['/tmp/openawork-channel-outside'],
    });

    const workspaceTools = await import('../../tools/workspace-tools.js');

    await expect(
      workspaceTools.executeWorkspaceReviewRevert({ path: OUTSIDE_FILE, filePath: 'a.txt' }, 's1'),
    ).rejects.toThrow(/outside current session workspace/);
  });

  it('未绑定工作目录的渠道会话：默认工作目录内的路径放行', () => {
    state.metadata = unboundChannelMetadata({});
    const boundary = safety.resolveUnboundSessionWorkspaceFallback();

    for (const access of ['read', 'write'] as const) {
      expect(
        safety.validateSessionWorkspacePath({
          path: join(boundary, 'notes.md'),
          sessionId: 's1',
          access,
        }),
      ).toMatchObject({ ok: true });
    }
  });

  it('未绑定工作目录的渠道会话：默认目录之外的读写被拒（路径 ACL 真正生效）', () => {
    state.metadata = unboundChannelMetadata({});

    for (const access of ['read', 'write'] as const) {
      expect(
        safety.validateSessionWorkspacePath({ path: OUTSIDE_FILE, sessionId: 's1', access }),
      ).toMatchObject({ ok: false, reason: 'outside-session-workspace' });
    }
  });

  it('未绑定工作目录的渠道会话：allowWriteOutside 只放宽写', () => {
    state.metadata = unboundChannelMetadata({ allowWriteOutside: true });

    expect(
      safety.validateSessionWorkspacePath({ path: OUTSIDE_FILE, sessionId: 's1', access: 'write' }),
    ).toMatchObject({ ok: true });
    expect(
      safety.validateSessionWorkspacePath({ path: OUTSIDE_FILE, sessionId: 's1', access: 'read' }),
    ).toMatchObject({ ok: false, reason: 'outside-session-workspace' });
  });

  it('未绑定工作目录的渠道会话：readablePathPrefixes 只放宽读', () => {
    state.metadata = unboundChannelMetadata({
      readablePathPrefixes: ['/tmp/openawork-channel-outside'],
    });

    expect(
      safety.validateSessionWorkspacePath({ path: OUTSIDE_FILE, sessionId: 's1', access: 'read' }),
    ).toMatchObject({ ok: true });
    expect(
      safety.validateSessionWorkspacePath({ path: OUTSIDE_FILE, sessionId: 's1', access: 'write' }),
    ).toMatchObject({ ok: false, reason: 'outside-session-workspace' });
  });

  it('未绑定工作目录的非渠道会话不受隐式边界影响（既有语义不变）', () => {
    state.metadata = { channel: { permissions: { ...DENY_ALL } } };

    expect(
      safety.validateSessionWorkspacePath({ path: OUTSIDE_FILE, sessionId: 's1', access: 'write' }),
    ).toMatchObject({ ok: true });
  });
});
