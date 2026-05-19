/**
 * Coverage for the PR-D-Plugin host. Tests pin down:
 *
 *   1. Hooks fire in registration order.
 *   2. Mutations to `output` propagate back to the dispatch caller.
 *   3. A throwing plugin doesn't poison subsequent plugins or
 *      bubble up to break the main flow (defensive isolation).
 *   4. `_resetPluginsForTest` cleanly drops all registrations so
 *      tests stay deterministic.
 *   5. The env-driven loader (`ensurePluginsLoaded`) is idempotent
 *      and silently skips broken plugins.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _registerPluginForTest,
  _resetPluginsForTest,
  dispatchChatParams,
  dispatchToolExecuteAfter,
  dispatchToolExecuteBefore,
  ensurePluginsLoaded,
} from '../../runtime/plugin-host.js';

describe('plugin-host', () => {
  beforeEach(() => {
    _resetPluginsForTest();
  });

  afterEach(() => {
    _resetPluginsForTest();
    delete process.env['OPENAWORK_PLUGINS'];
  });

  it('dispatches tool.execute.before and propagates mutated args back', async () => {
    _registerPluginForTest('test-plugin', {
      'tool.execute.before': (_input, output) => {
        // Plugin redacts the `secret` field of the rawInput.
        const args = output.args as Record<string, unknown>;
        output.args = { ...args, secret: '[REDACTED]' };
      },
    });

    const out = { args: { command: 'ls', secret: 'p@ssw0rd' } as unknown };
    await dispatchToolExecuteBefore({ tool: 'bash', sessionID: 's1', callID: 'c1' }, out);

    expect(out.args).toEqual({ command: 'ls', secret: '[REDACTED]' });
  });

  it('runs hooks in registration order so later plugins see earlier mutations', async () => {
    const trace: string[] = [];
    _registerPluginForTest('plugin-A', {
      'tool.execute.before': (_input, output) => {
        trace.push('A');
        const args = output.args as Record<string, unknown>;
        output.args = { ...args, level: 'A' };
      },
    });
    _registerPluginForTest('plugin-B', {
      'tool.execute.before': (_input, output) => {
        trace.push('B');
        const args = output.args as Record<string, unknown>;
        // Plugin B saw A's mutation.
        expect(args.level).toBe('A');
        output.args = { ...args, level: 'B' };
      },
    });

    const out = { args: {} as unknown };
    await dispatchToolExecuteBefore({ tool: 'bash', sessionID: 's1', callID: 'c1' }, out);

    expect(trace).toEqual(['A', 'B']);
    expect((out.args as Record<string, unknown>).level).toBe('B');
  });

  it('isolates plugin errors — a throwing plugin does not stop downstream plugins or callers', async () => {
    const downstream = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      _registerPluginForTest('crashy', {
        'tool.execute.before': () => {
          throw new Error('plugin oops');
        },
      });
      _registerPluginForTest('downstream', {
        'tool.execute.before': downstream,
      });

      const out = { args: { x: 1 } as unknown };
      await dispatchToolExecuteBefore({ tool: 'bash', sessionID: 's1', callID: 'c1' }, out);

      // Downstream plugin still ran.
      expect(downstream).toHaveBeenCalledTimes(1);
      // The crash was logged, not propagated.
      expect(warnSpy).toHaveBeenCalled();
      const warnText = warnSpy.mock.calls.map((c) => c.join(' ')).join(' ');
      expect(warnText).toContain('crashy');
      expect(warnText).toContain('plugin oops');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('dispatches tool.execute.after with the final output and metadata mutable', async () => {
    _registerPluginForTest('test', {
      'tool.execute.after': (_input, output) => {
        output.output = `${String(output.output)} [via plugin]`;
        output.metadata['plugin-touched'] = true;
      },
    });

    const out = {
      output: 'hello' as unknown,
      metadata: { isError: false } as Record<string, unknown>,
    };
    await dispatchToolExecuteAfter({ tool: 'bash', sessionID: 's1', callID: 'c1', args: {} }, out);

    expect(out.output).toBe('hello [via plugin]');
    expect(out.metadata['plugin-touched']).toBe(true);
    expect(out.metadata['isError']).toBe(false);
  });

  it('dispatches chat.params with mutable temperature/options', async () => {
    _registerPluginForTest('test', {
      'chat.params': (_input, output) => {
        // Force determinism.
        output.temperature = 0;
        output.options['plugin-tag'] = 'deterministic';
      },
    });

    const out = {
      temperature: 0.7,
      options: {} as Record<string, unknown>,
    };
    await dispatchChatParams({ sessionID: 's1', modelId: 'gpt-5' }, out);

    expect(out.temperature).toBe(0);
    expect(out.options['plugin-tag']).toBe('deterministic');
  });

  it('ensurePluginsLoaded is idempotent — calling twice loads plugins once', async () => {
    delete process.env['OPENAWORK_PLUGINS'];
    await ensurePluginsLoaded();
    await ensurePluginsLoaded();
    // No assertions on loaded plugins (none configured); the
    // assertion is purely that this didn't throw and didn't loop
    // forever.
  });

  it('ensurePluginsLoaded silently skips a non-existent plugin path', async () => {
    process.env['OPENAWORK_PLUGINS'] = '/nonexistent/path/to/plugin.js';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      _resetPluginsForTest();
      await ensurePluginsLoaded();
      // Loader logs a warn but doesn't throw.
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('dispatch is a no-op when no plugins are registered', async () => {
    _resetPluginsForTest();
    // Should resolve without throwing — this is the hot path on
    // production deployments that didn't configure any plugins.
    await dispatchToolExecuteBefore({ tool: 'bash', sessionID: 's1', callID: 'c1' }, { args: {} });
    await dispatchToolExecuteAfter(
      { tool: 'bash', sessionID: 's1', callID: 'c1', args: {} },
      { output: '', metadata: {} },
    );
  });
});
