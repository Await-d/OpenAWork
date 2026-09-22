import { describe, expect, it, vi } from 'vitest';
import { CANONICAL_TO_PRESENTED } from '../../claude-code/claude-code-tool-surface-profiles.js';
import { buildGatewayToolDefinitions } from '../../tools/tool-definitions.js';
import { rewriteLegacyToolRequest } from '../../tools/legacy-tool-name-rewrite.js';

// 只为读静态白名单常量；这里把 DB 打桩，避免触碰真实数据库。
vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/tmp',
  WORKSPACE_ROOTS: ['/tmp'],
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(() => undefined),
  sqliteRun: vi.fn(() => undefined),
  sqliteRunWithRowId: vi.fn(() => 1),
}));

import { normalizeToolNameForEnablement } from '../../routes/tool-name-compat.js';
import { TOOL_WHITELIST } from '../../tools/tool-sandbox.js';

/**
 * Claude Code 展示名：模型可见名与规范名不同（`Skill` → `skill` 等），
 * 由 `routes/tool-name-compat.ts` 的展示名归一负责。
 */
const PRESENTED_NAMES = new Set(Object.values(CANONICAL_TO_PRESENTED));

/**
 * 运行期别名：子代理工具的派发名是 `task`（在白名单里），模型可见名是 `subagent`，
 * 由 `isTaskToolName()` 同时接受两者。
 */
const RUNTIME_ALIAS_NAMES = new Set(['subagent']);

/**
 * 模型可见工具面的硬不变量（不列举任何历史名，避免把旧名写回仓库）：
 * 可见名只能是「静态白名单里的规范名 / Claude 展示名 / 运行期别名」，除展示名外
 * 都必须能**不改名直接派发**，且归一化后互不冲突。任何重新引入的别名都会在此失败。
 */
describe('model-visible tool surface parity', () => {
  const visibleNames = buildGatewayToolDefinitions().map((tool) => tool.function.name);

  it('每个模型可见名都落在：静态白名单 / Claude 展示名 / 运行期别名', () => {
    for (const name of visibleNames) {
      const allowed =
        TOOL_WHITELIST.has(name) || PRESENTED_NAMES.has(name) || RUNTIME_ALIAS_NAMES.has(name);
      expect(allowed, `${name} 既不在白名单，也不是展示名 / 运行期别名`).toBe(true);
    }
  });

  it('除 Claude 展示名外，每个模型可见名都无需改名即可派发', () => {
    for (const name of visibleNames) {
      if (PRESENTED_NAMES.has(name)) continue;
      expect(rewriteLegacyToolRequest(name, {}).rewritten, name).toBe(false);
    }
  });

  it('可见名归一化后互不冲突（同一能力不会出现两个可见名）', () => {
    const seen = new Map<string, string>();
    for (const name of visibleNames) {
      const canonical = normalizeToolNameForEnablement(name);
      const previous = seen.get(canonical);
      expect(
        previous,
        `${name} 与 ${previous ?? ''} 归一到同一个派发名 ${canonical}`,
      ).toBeUndefined();
      seen.set(canonical, name);
    }
  });
});
