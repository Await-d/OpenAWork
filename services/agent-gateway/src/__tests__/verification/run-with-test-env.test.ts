import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runVerificationChild } from '../../verification/verification-child-process.js';

const wrapper = resolve('src/verification/run-with-test-env.ts');

async function runFixture(source: string, offline = false) {
  const root = mkdtempSync(join(tmpdir(), 'verification-wrapper-test-'));
  const fixture = join(root, 'fixture.mjs');
  writeFileSync(fixture, source);
  try {
    return await runVerificationChild({
      runtime: process.execPath,
      args: ['--import', 'tsx', wrapper, fixture, ...(offline ? ['--offline'] : [])],
      env: {
        ...process.env,
        AI_API_BASE_URL: 'https://provider.invalid',
        AI_API_KEY: 'fixture-only-key',
        AI_DEFAULT_MODEL: 'fixture-model',
      },
      timeoutMs: 20_000,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('verification environment lifecycle', () => {
  it('void main尚未结束时目录仍可用，退出后才清理，离线模式不继承模型配置', async () => {
    const result = await runFixture(
      `
      import { existsSync, writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      async function main() {
        const dir = process.env.OPENAWORK_DATA_DIR;
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!existsSync(dir)) throw new Error('directory removed early');
        writeFileSync(join(dir, 'finished'), 'ok');
        console.log('DIR=' + dir);
        console.log('OFFLINE=' + ![process.env.AI_API_BASE_URL, process.env.AI_API_KEY, process.env.AI_DEFAULT_MODEL].some(Boolean));
      }
      void main().catch(error => { console.error(error); process.exitCode = 1; });
    `,
      true,
    );
    const dir = /DIR=(.+)/.exec(result.stdout)?.[1];
    expect(dir).toBeTruthy();
    expect(result.stdout).toContain('OFFLINE=true');
    expect(existsSync(dir!)).toBe(false);
  });

  it('子脚本延迟失败也传播非零退出，并在失败后清理目录', async () => {
    let dir: string | undefined;
    try {
      await runFixture(`
        async function main() {
          await new Promise(resolve => setTimeout(resolve, 100));
          throw new Error('FAIL_DIR=' + process.env.OPENAWORK_DATA_DIR);
        }
        void main().catch(error => { console.error(error); process.exitCode = 1; });
      `);
      expect.fail('wrapper must fail');
    } catch (error) {
      const message = String(error);
      expect(message).toContain('code=1');
      dir = /FAIL_DIR=([^\s]+)/.exec(message)?.[1];
    }
    expect(dir).toBeTruthy();
    expect(existsSync(dir!)).toBe(false);
  });

  it('非离线验收保留真实模型入口的配置兼容性', async () => {
    const result = await runFixture("console.log('MODEL=' + process.env.AI_DEFAULT_MODEL)");
    expect(result.stdout).toContain('MODEL=fixture-model');
  });
});
