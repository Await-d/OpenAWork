import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

if (!process.env['DATABASE_URL'] && !process.env['OPENAWORK_DATABASE_PATH']) {
  process.env['DATABASE_URL'] = ':memory:';
}

if (!process.env['OPENAWORK_APP_VERSION']) {
  process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
}

/**
 * 未绑定工作区会话的产品回退目录 = 平台「文档目录」下的 OpenAWork
 * （`workspace-safety.ts` 的 `resolveUnboundSessionWorkspaceFallback`）。单测里
 * `WORKSPACE_ROOT` 常被替换成 `/tmp/openawork-tool-sandbox-*` 这类**不像仓库**的
 * 临时目录，于是这条回退被真实触发，任务图会写进开发者本机的
 * `~/Documents/OpenAWork/.agentdocs/tasks/`。
 *
 * 这里把文档目录指向一次性临时目录（显式设置 XDG_DOCUMENTS_DIR 时尊重调用方），
 * 回退路径仍被真实执行，只是落点被沙箱化，且按测试文件清理，避免跨用例残留
 * （固定 sessionId 的用例会读到上一次的任务图）。
 * CI 为 ubuntu-latest；Linux 之外（macOS/Windows）平台适配器不读该变量。
 */
const pendingSandboxDocumentsDir = process.env['XDG_DOCUMENTS_DIR']
  ? null
  : mkdtempSync(join(tmpdir(), 'openawork-test-documents-'));

if (pendingSandboxDocumentsDir) {
  process.env['XDG_DOCUMENTS_DIR'] = pendingSandboxDocumentsDir;
}

afterAll(() => {
  if (pendingSandboxDocumentsDir) {
    rmSync(pendingSandboxDocumentsDir, { recursive: true, force: true });
  }
});
