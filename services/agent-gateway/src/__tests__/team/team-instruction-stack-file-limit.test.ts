import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as StackModule from '../../team/team-instruction-stack.js';

/**
 * Regression (§0.135, team instruction-stack file read memory cap):
 * buildTeamInstructionStack injects architecture.md / .agentdocs/project-memory.md
 * / .agentdocs/lessons-learned.md into EVERY team prompt. `workspaceRoot` is
 * user-controlled, so a pathological multi-MB file used to be read fully into
 * memory each turn (ballooning gateway memory + every upstream request). This is
 * the same hot-path hazard §0.127 closed for stream.ts::buildWorkspaceContext,
 * but a distinct reader (readFileSafe). The reader now `stat`s first and skips
 * oversize files before buffering, while the rest of the stack is still built.
 */

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let stack: typeof StackModule;
let workspaceRoot: string;

const USER_ID = 'u-instruction-stack-limit';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  stack = await import('../../team/team-instruction-stack.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun(
    "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')",
    [USER_ID, `${USER_ID}@example.com`],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'instruction-stack-'));
  mkdirSync(join(workspaceRoot, '.agentdocs'), { recursive: true });
});

afterEach(() => {
  delete process.env['OPENAWORK_CONTEXT_FILE_MAX_BYTES'];
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('buildTeamInstructionStack 指令栈文件内存上限', () => {
  it('超过上限的 architecture.md 被跳过，限内的 project-memory.md 仍注入', async () => {
    process.env['OPENAWORK_CONTEXT_FILE_MAX_BYTES'] = '128';
    // architecture.md is well over the 128-byte cap → must be skipped.
    writeFileSync(join(workspaceRoot, 'architecture.md'), 'A'.repeat(50_000), 'utf8');
    // project-memory.md is tiny → must still be injected.
    writeFileSync(
      join(workspaceRoot, '.agentdocs', 'project-memory.md'),
      '小巧的项目记忆',
      'utf8',
    );

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await stack.buildTeamInstructionStack({
      userId: USER_ID,
      workspaceRoot,
      teamWorkspaceId: null,
      roleLayer: null,
    });

    expect(result.layers.architectureMd).toBe(false);
    expect(result.layers.projectMemory).toBe(true);
    expect(result.stableBlock).not.toContain('AAAA');
    expect(result.stableBlock).toContain('小巧的项目记忆');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('跳过超限的指令栈文件'),
    );
    warn.mockRestore();
  });

  it('上限内的 architecture.md 正常注入（守卫不误伤）', async () => {
    process.env['OPENAWORK_CONTEXT_FILE_MAX_BYTES'] = String(1024 * 1024);
    writeFileSync(join(workspaceRoot, 'architecture.md'), '# 架构约束\n保持模块边界清晰。', 'utf8');

    const result = await stack.buildTeamInstructionStack({
      userId: USER_ID,
      workspaceRoot,
      teamWorkspaceId: null,
      roleLayer: null,
    });

    expect(result.layers.architectureMd).toBe(true);
    expect(result.stableBlock).toContain('保持模块边界清晰。');
  });

  it('上限设为 0 时禁用守卫，超大文件仍被读取', async () => {
    process.env['OPENAWORK_CONTEXT_FILE_MAX_BYTES'] = '0';
    writeFileSync(join(workspaceRoot, 'architecture.md'), '巨大但允许'.repeat(20_000), 'utf8');

    const result = await stack.buildTeamInstructionStack({
      userId: USER_ID,
      workspaceRoot,
      teamWorkspaceId: null,
      roleLayer: null,
    });

    expect(result.layers.architectureMd).toBe(true);
  });
});
