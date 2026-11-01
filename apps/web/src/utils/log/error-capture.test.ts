import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clientErrorRecorder,
  exportClientErrorDiagnostics,
  installClientErrorCapture,
  resetClientErrorCaptureForTest,
} from './error-capture.js';
import {
  dumpReactCommitCascadeReport,
  recordReactCommit,
  recordReactUpdateSource,
  resetReactCommitCascadeDiagnostics,
  uninstallReactCommitCascadeDiagnostics,
} from './react-commit-cascade.js';

afterEach(() => {
  resetClientErrorCaptureForTest();
  uninstallReactCommitCascadeDiagnostics();
  resetReactCommitCascadeDiagnostics();
  clientErrorRecorder.clear();
  vi.restoreAllMocks();
});

describe('React 更新诊断导出接线', () => {
  it('全局 #185 捕获后分片保留完整报告，现有复制入口包含末尾现场', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installClientErrorCapture();
    for (let index = 0; index < 80; index += 1) {
      recordReactCommit('route:chat', 'update', 1, 1, 0, index);
      recordReactUpdateSource('gateway.syncActiveRequest', `diagnostic-marker-${index}`);
    }
    const expected = dumpReactCommitCascadeReport();
    expect(expected.length).toBeGreaterThan(2_000);
    window.dispatchEvent(
      new ErrorEvent('error', { error: new Error('Minified React error #185;') }),
    );
    const record = clientErrorRecorder.list()[0];
    expect(record?.source).toBe('uncaught');
    const chunks = Object.entries(record?.context ?? {})
      .filter(([key]) => key.startsWith('reactCommitCascade'))
      .sort(([left], [right]) => left.localeCompare(right));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map(([, value]) => value).join('')).toBe(expected);
    expect(exportClientErrorDiagnostics()).toContain('diagnostic-marker-79');
  });

  it('React 边界错误同样补充报告，普通错误不携带额外诊断', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ordinary = clientErrorRecorder.record({ source: 'manual', error: new Error('网络故障') });
    expect(ordinary?.context).toBeUndefined();
    const boundary = clientErrorRecorder.record({
      source: 'react-boundary',
      error: new Error('Maximum update depth exceeded.'),
      context: { componentStack: 'at ChatPage' },
    });
    expect(boundary?.context?.['componentStack']).toBe('at ChatPage');
    expect(boundary?.context?.['reactCommitCascade000']).toContain('React 更新诊断');
  });
});
