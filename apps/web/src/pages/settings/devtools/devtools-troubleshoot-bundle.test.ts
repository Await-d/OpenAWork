import { describe, expect, it } from 'vitest';
import { buildTroubleshootBundleMarkdown } from './devtools-troubleshoot-bundle.js';
import type { TroubleshootBundleInput } from './devtools-troubleshoot-bundle.js';
import { createInitialDevtoolsSourceStates } from '../state/settings-derived.js';

function baseInput(overrides: Partial<TroubleshootBundleInput> = {}): TroubleshootBundleInput {
  return {
    generatedAt: '2026-09-22T21:30:00.000Z',
    appVersion: '1.1.6',
    buildVersion: '1.1.6+abc1234',
    buildTime: '2026-09-20T10:00:00.000Z',
    gitHash: 'abc1234',
    gitBranch: 'main',
    platform: 'Linux x86_64',
    userAgent: 'Mozilla/5.0 (Test)',
    gatewayUrl: 'http://localhost:3000',
    sourceStates: createInitialDevtoolsSourceStates(),
    diagnostics: [],
    errorLogs: [],
    workers: [],
    ...overrides,
  };
}

describe('buildTroubleshootBundleMarkdown', () => {
  it('空输入时仍输出全部小节并标注（无）', () => {
    const markdown = buildTroubleshootBundleMarkdown(baseInput());

    expect(markdown).toContain('# OpenAWork 排障上下文');
    expect(markdown).toContain('- 应用版本：1.1.6（构建版本 1.1.6+abc1234）');
    expect(markdown).toContain('## 诊断记录（0 条）');
    expect(markdown).toContain('## 错误日志（0 条）');
    expect(markdown).toContain('## Worker 异常（0 个）');
    expect(markdown).toContain('**待排查问题合计：0 项**');
    expect(markdown.match(/（无）/g)).toHaveLength(3);
  });

  it('汇总诊断、错误日志与 Worker 异常的数量与详情', () => {
    const markdown = buildTroubleshootBundleMarkdown(
      baseInput({
        diagnostics: [
          {
            filePath: 'packages/agent-core/src/tools/hash-edit.ts',
            message: '编辑失败：锚点哈希不匹配（第 42 行）',
            severity: 'error',
            requestId: 'req-1',
            sessionId: 'ses-1',
            durationMs: 128,
            createdAt: '2026-09-22T21:29:00.000Z',
            toolName: 'edit',
            input: { path: 'hash-edit.ts' },
            output: { error: 'anchor hash mismatch' },
          },
        ],
        errorLogs: [
          {
            level: 'error',
            message: 'stream 中断：缺少 [DONE] 分隔符',
            source: 'gateway',
            timestamp: Date.parse('2026-09-22T21:28:00.000Z'),
            createdAt: '2026-09-22T21:28:00.000Z',
            requestId: 'req-2',
            durationMs: 3021,
            input: { url: 'https://upstream/v1/stream' },
            output: { sawDone: false },
          },
        ],
        workers: [
          {
            id: 'w-1',
            name: 'build-worker',
            status: 'error',
            mode: 'cloud_worker',
            endpoint: 'http://w1',
          },
          { id: 'w-2', name: 'idle-worker', status: 'idle' },
        ],
      }),
    );

    expect(markdown).toContain('- 诊断记录：1 条');
    expect(markdown).toContain('- 错误日志：1 条');
    expect(markdown).toContain('- Worker 异常：1 个');
    expect(markdown).toContain('**待排查问题合计：3 项**');

    expect(markdown).toContain('### 1. 编辑失败：锚点哈希不匹配（第 42 行）');
    expect(markdown).toContain('- 请求 ID：req-1');
    expect(markdown).toContain('"error": "anchor hash mismatch"');

    expect(markdown).toContain('### 1. stream 中断：缺少 [DONE] 分隔符');
    expect(markdown).toContain('- 时间：2026-09-22T21:28:00.000Z');

    expect(markdown).toContain('### 1. build-worker');
    // 非 error 的 Worker 不应出现在异常清单中
    expect(markdown).not.toContain('idle-worker');
  });

  it('诊断与日志载荷中的凭据被脱敏（排障包可外发）', () => {
    const markdown = buildTroubleshootBundleMarkdown(
      baseInput({
        gatewayUrl: 'https://user:pass@gateway.example.com',
        diagnostics: [
          {
            filePath: 'providers.json',
            message: '保存失败',
            severity: 'error',
            input: {
              apiKey: 'sk-live-secret',
              headers: { Authorization: 'Bearer abc' },
            },
            output: { endpoint: 'https://user:pass@api.example.com/v1', ok: false },
          },
        ],
        errorLogs: [
          {
            level: 'error',
            message: 'MCP 连接失败',
            source: 'gateway',
            timestamp: Date.parse('2026-09-22T21:28:00.000Z'),
            input: { client_secret: 'oauth-secret' },
            output: { ok: false },
          },
        ],
      }),
    );

    expect(markdown).not.toContain('sk-live-secret');
    expect(markdown).not.toContain('Bearer abc');
    expect(markdown).not.toContain('oauth-secret');
    expect(markdown).not.toContain('user:pass');
    expect(markdown).toContain('- 网关地址：***');
    expect(markdown).toContain('"apiKey": "***"');
    expect(markdown).toContain('"ok": false');
  });

  it('数据源状态表转义竖线，避免破坏表格结构', () => {
    const sourceStates = createInitialDevtoolsSourceStates();
    const markdown = buildTroubleshootBundleMarkdown(
      baseInput({
        sourceStates: {
          ...sourceStates,
          devLogs: {
            ...sourceStates.devLogs,
            status: 'error',
            detail: '响应异常 | 重试中',
            error: 'ECONNREFUSED\n端口 3000',
          },
        },
      }),
    );

    expect(markdown).toContain('响应异常 \\| 重试中');
    expect(markdown).toContain('ECONNREFUSED 端口 3000');
    expect(markdown).toContain('| 失败 |');
  });
});
