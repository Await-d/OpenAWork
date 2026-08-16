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
delete process.env['OPENAWORK_DATABASE_PATH'];

if (!process.env['OPENAWORK_APP_VERSION']) {
  process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
}

try {
  await import(pathToFileURL(resolve(process.cwd(), target)).href);
} finally {
  rmSync(tempDataDir, { force: true, recursive: true });
}
