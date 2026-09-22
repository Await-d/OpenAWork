import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const target = process.argv.slice(2).find((arg) => arg !== '--');
if (!target) {
  throw new Error('Usage: run-with-test-env <verification-script>');
}

const tempDataDir = mkdtempSync(join(tmpdir(), 'openawork-verification-'));

process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_DATA_DIR'] = tempDataDir;
process.env['OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER'] = '1';
// 未绑定工作区会话会回退到平台文档目录下的 OpenAWork（`resolveUnboundSessionWorkspaceFallback`）。
// 验收脚本里 `WORKSPACE_ROOT` 常是临时目录且不像仓库，回退会被真实触发——不隔离就会把
// 任务图写进开发者本机的 ~/Documents/OpenAWork。指向临时数据目录，随 tempDataDir 一起清理。
process.env['XDG_DOCUMENTS_DIR'] = join(tempDataDir, 'documents');
delete process.env['OPENAWORK_DATABASE_PATH'];

if (!process.env['OPENAWORK_APP_VERSION']) {
  process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
}

try {
  await import(pathToFileURL(resolve(process.cwd(), target)).href);
} finally {
  rmSync(tempDataDir, { force: true, recursive: true });
}
