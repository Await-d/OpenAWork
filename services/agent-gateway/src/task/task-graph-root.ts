import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_ROOT, WORKSPACE_ROOTS } from '../infra/db.js';
import {
  assertWorkspacePathSupportedByCurrentHost,
  isPathWithinRoot,
} from '../workspace/workspace-paths.js';
import {
  ensureUnboundSessionWorkspaceDirectory,
  getSessionWorkspaceResolution,
  isFilesystemRootOrPlaceholderPath,
} from '../workspace/workspace-safety.js';

/** 仓库根标记：pnpm / bun workspace 或 Git 元数据（产品需同时兼容 pnpm 与 bun 项目）。 */
function isRepositoryWorkspaceRoot(rootPath: string): boolean {
  return (
    existsSync(join(rootPath, 'pnpm-workspace.yaml')) ||
    existsSync(join(rootPath, 'bun.lock')) ||
    existsSync(join(rootPath, 'bun.lockb')) ||
    existsSync(join(rootPath, '.git'))
  );
}

function resolveWorkspaceRootForWorkingDirectory(workingDirectory: string): string {
  const matchedRoot = [...WORKSPACE_ROOTS]
    .sort((left, right) => right.length - left.length)
    .find((rootPath) => isPathWithinRoot(workingDirectory, rootPath));

  return matchedRoot ?? workingDirectory;
}

/**
 * 解析任务图落盘的「本地项目根」。
 *
 * 任务图是**网关本机**的落盘产物（`<projectRoot>/.agentdocs/tasks/<graphId>.json`，
 * 见 `@openAwork/agent-core` 的 task-system/store.ts），因此这里返回的路径必须能被
 * 本机文件系统直接写入。三类会话分别处理：
 *
 *   1. **SSH 远端工作区会话**：`workingDirectory` 是远端主机上的绝对路径，本机既
 *      可能不存在、也可能恰好命中根目录（远端 cwd 为 `/` 时 `projectRoot === '/'`
 *      → `mkdir('/.agentdocs')` → EACCES，2026-10-16 排障包命中：`Agent` 委派调用
 *      0ms 即失败）。因此**不把远端路径当本地根**，回退到本机任务图目录：
 *      仓库形全局根（若在远端会话里它仍是本机可写目录）优先，否则用未绑定会话的
 *      默认工作区目录。远端工作区的任务图因此落在网关侧，与远端文件系统无关。
 *   2. **已绑定本地工作区**：只用会话自身路径；主机不兼容（如 Windows 网关 +
 *      POSIX 路径）时直接抛错，不允许静默回退（既有契约，见 sessions 路由的
 *      跨主机读模型降级）。
 *   3. **未绑定工作区**：回退到当前主机文档目录（或看起来像仓库的全局根）。
 *
 * 兜底：任何来源解析出「文件系统根 / 占位路径」（`/`、`C:\`）都不作为项目根使用
 * ——把它们当项目根必然产生 `/.agentdocs` 这类越权写入。
 */
export function resolveTaskGraphProjectRoot(sessionId: string): string {
  const resolution = getSessionWorkspaceResolution(sessionId);
  const sessionWorkingDirectory = resolution?.path ?? null;

  if (sessionWorkingDirectory && resolution?.remote) {
    // 远端工作区：任务图只能落在网关本机。
    return resolveLocalTaskGraphRoot();
  }

  if (sessionWorkingDirectory) {
    // 已绑定本地工作区：主机不兼容时直接抛错，不允许回退。
    assertWorkspacePathSupportedByCurrentHost(sessionWorkingDirectory);
    return resolveWorkspaceRootForWorkingDirectory(sessionWorkingDirectory);
  }

  return resolveLocalTaskGraphRoot();
}

/**
 * 网关本机可写的任务图根：仓库形全局根优先，否则未绑定会话默认工作区。
 *
 * 全局 `WORKSPACE_ROOT` 已被 `infra/db.ts` 过滤掉 system32 / 盘符根等不安全回退，
 * 但远端会话下它仍可能是本机某个受限目录，故这里再用占位路径守卫兜一层。
 */
function resolveLocalTaskGraphRoot(): string {
  if (isUsableLocalProjectRoot(WORKSPACE_ROOT) && isRepositoryWorkspaceRoot(WORKSPACE_ROOT)) {
    return WORKSPACE_ROOT;
  }

  return ensureUnboundSessionWorkspaceDirectory();
}

function isUsableLocalProjectRoot(rootPath: string): boolean {
  return !isFilesystemRootOrPlaceholderPath(rootPath);
}
