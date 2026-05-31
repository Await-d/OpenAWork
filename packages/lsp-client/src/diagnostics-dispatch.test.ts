import { describe, expect, it, vi } from 'vitest';
import type { Diagnostic } from 'vscode-languageserver-types';
import { LSPManager } from './index.js';

/**
 * Narrow typed seam onto the private dispatch path. The diagnostics
 * fan-out is normally driven by the LSP client's `onDiagnostics`
 * notification, which requires a spawned language server; this view
 * lets us exercise the isolation contract without one.
 */
interface DiagnosticsDispatchView {
  dispatchDiagnostics(path: string, diagnostics: Diagnostic[]): void;
}

function asDispatchView(manager: LSPManager): DiagnosticsDispatchView {
  return manager as unknown as DiagnosticsDispatchView;
}

describe('LSPManager diagnostics dispatch isolation', () => {
  it('一个 handler 抛错不会阻断其他订阅，也不会向上抛', () => {
    const manager = new LSPManager({ servers: [] });
    const order: string[] = [];

    manager.onDiagnosticsUpdate(() => {
      order.push('first');
    });
    manager.onDiagnosticsUpdate(() => {
      throw new Error('socket already closed');
    });
    const lastHandler = vi.fn(() => {
      order.push('third');
    });
    manager.onDiagnosticsUpdate(lastHandler);

    expect(() => asDispatchView(manager).dispatchDiagnostics('file:///a.ts', [])).not.toThrow();

    expect(order).toEqual(['first', 'third']);
    expect(lastHandler).toHaveBeenCalledTimes(1);
  });

  it('handler 取消订阅后不再收到诊断', () => {
    const manager = new LSPManager({ servers: [] });
    const received: number[] = [];

    const unsubscribe = manager.onDiagnosticsUpdate((_path, diagnostics) => {
      received.push(diagnostics.length);
    });

    asDispatchView(manager).dispatchDiagnostics('file:///a.ts', []);
    unsubscribe();
    asDispatchView(manager).dispatchDiagnostics('file:///a.ts', []);

    expect(received).toEqual([0]);
  });
});
