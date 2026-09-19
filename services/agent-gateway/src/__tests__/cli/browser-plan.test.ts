/**
 * `--print-browser-plan` 诊断入口单测。
 *
 * vitest 下 `@openAwork/browser-automation` 走源码别名解析，而 sidecar 走 Bun 内联的
 * 注册表，两者不是同一条解析路径，因此这里只断言输出结构，不断言固定目标数量——
 * 真正的「内联元数据可用」冒烟在 release CI 的编译产物上执行。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runPrintBrowserPlan } from '../../cli/browser-plan.js';

interface BrowserPlanTargetShape {
  name: string;
  revision: string;
  browserVersion: string | null;
  directory: string;
  executableRelativePath: string;
  downloadUrls: string[];
}

interface BrowserPlanShape {
  ok: boolean;
  platform: string;
  arch: string;
  browsersPath: string;
  targets: BrowserPlanTargetShape[];
  error?: string;
}

const stdoutChunks: string[] = [];

function spyOnStdout(): void {
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  });
}

function parsePlan(): BrowserPlanShape {
  return JSON.parse(stdoutChunks.join('')) as BrowserPlanShape;
}

afterEach(() => {
  vi.restoreAllMocks();
  stdoutChunks.length = 0;
});

describe('runPrintBrowserPlan', () => {
  it('默认参数下打印结构化计划并以 0 或 1 退出', async () => {
    spyOnStdout();

    const exitCode = await runPrintBrowserPlan(['--print-browser-plan']);
    const plan = parsePlan();

    expect([0, 1]).toContain(exitCode);
    expect(typeof plan.ok).toBe('boolean');
    expect(typeof plan.platform).toBe('string');
    expect(typeof plan.arch).toBe('string');
    expect(typeof plan.browsersPath).toBe('string');
    expect(Array.isArray(plan.targets)).toBe(true);
    expect(exitCode).toBe(plan.targets.length > 0 ? 0 : 1);
  });

  it('--browsers-path 覆盖解析目录，目标目录落在该路径之下', async () => {
    spyOnStdout();

    const exitCode = await runPrintBrowserPlan([
      '--print-browser-plan',
      '--browsers-path',
      '/tmp/openawork-plan-test',
    ]);
    const plan = parsePlan();

    expect([0, 1]).toContain(exitCode);
    expect(plan.browsersPath).toBe('/tmp/openawork-plan-test');

    if (plan.targets.length > 0) {
      expect(exitCode).toBe(0);
      for (const target of plan.targets) {
        expect(target.directory.startsWith('/tmp/openawork-plan-test')).toBe(true);
      }
    }
  });
});
