import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runVerificationChild } from './verification-child-process.js';

const args = process.argv.slice(2);
const target = args.find((arg) => arg !== '--' && arg !== '--offline');
if (!target) {
  throw new Error('Usage: run-with-test-env <verification-script> [--offline]');
}

const tempDataDir = mkdtempSync(join(tmpdir(), 'openawork-verification-'));
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: ':memory:',
  OPENAWORK_DATA_DIR: tempDataDir,
  OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER: '1',
  XDG_DOCUMENTS_DIR: join(tempDataDir, 'documents'),
  OPENAWORK_APP_VERSION: process.env['OPENAWORK_APP_VERSION'] || '0.0.0-test',
};
delete env['OPENAWORK_DATABASE_PATH'];
if (args.includes('--offline')) {
  delete env['AI_API_BASE_URL'];
  delete env['AI_API_KEY'];
  delete env['AI_DEFAULT_MODEL'];
}

try {
  const result = await runVerificationChild({
    runtime: process.execPath,
    args: ['--import', 'tsx', resolve(process.cwd(), target)],
    env,
    timeoutMs: 600_000,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  rmSync(tempDataDir, { force: true, recursive: true });
}
