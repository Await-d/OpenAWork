/**
 * Coverage for the v2 plugin runtime (`src/plugin/*`):
 *
 *   1. Promise plugins activate, their hooks fire, and deactivation
 *      disposes both hooks and the `setup` cleanup.
 *   2. Effect plugins run inside a long-lived scope; resources acquired
 *      via `Effect.acquireRelease` are released on deactivation.
 *   3. Activation failures are recorded (visible in `list()`) without
 *      breaking the gateway or other plugins.
 *   4. Duplicate plugin ids are rejected.
 *   5. `ctx.plugin.list()` exposes the inventory to plugins.
 *   6. V1 (shim) and V2 plugins compose in registration order.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { define as definePromise } from '@openAwork/plugin-sdk';
import { define as defineEffect } from '@openAwork/plugin-sdk/effect';
import { getPluginRegistry } from '../../plugin/registry.js';
import {
  _registerPluginForTest,
  _resetPluginsForTest,
  dispatchChatParams,
  dispatchToolExecuteBefore,
} from '../../runtime/plugin-host.js';

describe('plugin registry (v2 runtime)', () => {
  beforeEach(() => {
    _resetPluginsForTest();
  });

  afterEach(() => {
    _resetPluginsForTest();
  });

  it('activates a Promise plugin and disposes hooks + cleanup on deactivate', async () => {
    const registry = getPluginRegistry();
    let setupCalled = false;
    let cleanupCalled = false;

    const plugin = definePromise({
      id: 'promise-demo',
      setup(ctx) {
        setupCalled = true;
        ctx.tool.hook('execute.before', (event) => {
          (event.args as Record<string, unknown>)['injected'] = true;
        });
        return () => {
          cleanupCalled = true;
        };
      },
    });

    await registry.activate(plugin, { source: 'test-promise' });
    expect(setupCalled).toBe(true);

    const out = { args: {} as unknown };
    await dispatchToolExecuteBefore({ tool: 'bash', sessionID: 's1', callID: 'c1' }, out);
    expect((out.args as Record<string, unknown>)['injected']).toBe(true);

    await registry.deactivate('promise-demo');
    expect(cleanupCalled).toBe(true);

    const after = { args: {} as unknown };
    await dispatchToolExecuteBefore({ tool: 'bash', sessionID: 's1', callID: 'c1' }, after);
    expect((after.args as Record<string, unknown>)['injected']).toBeUndefined();
  });

  it('runs an Effect plugin inside a scope and releases resources on deactivate', async () => {
    const registry = getPluginRegistry();
    const events: string[] = [];

    const plugin = defineEffect({
      id: 'effect-demo',
      effect: (ctx) =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              events.push('acquire');
              return { tag: 'resource' };
            }),
            () =>
              Effect.sync(() => {
                events.push('release');
              }),
          );
          ctx.session.hook('context', (event) => {
            event.temperature = 0;
          });
        }),
    });

    await registry.activate(plugin, { source: 'test-effect' });
    expect(events).toEqual(['acquire']);

    const out = { temperature: 0.9, options: {} as Record<string, unknown> };
    await dispatchChatParams({ sessionID: 's1', modelId: 'm1' }, out);
    expect(out.temperature).toBe(0);

    await registry.deactivate('effect-demo');
    expect(events).toEqual(['acquire', 'release']);

    const after = { temperature: 0.9, options: {} as Record<string, unknown> };
    await dispatchChatParams({ sessionID: 's1', modelId: 'm1' }, after);
    expect(after.temperature).toBe(0.9);
  });

  it('records activation failures without breaking other plugins', async () => {
    const registry = getPluginRegistry();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await registry.activate(
        definePromise({
          id: 'broken',
          setup() {
            throw new Error('setup exploded');
          },
        }),
        { source: 'test-broken' },
      );

      const failed = registry.list().find((entry) => entry.id === 'broken');
      expect(failed?.state.status).toBe('failed');

      // A healthy plugin activated afterwards still works.
      await registry.activate(
        definePromise({
          id: 'healthy',
          setup(ctx) {
            ctx.tool.hook('execute.before', (event) => {
              (event.args as Record<string, unknown>)['healthy'] = true;
            });
          },
        }),
        { source: 'test-healthy' },
      );

      const out = { args: {} as unknown };
      await dispatchToolExecuteBefore({ tool: 'bash', sessionID: 's1', callID: 'c1' }, out);
      expect((out.args as Record<string, unknown>)['healthy']).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('rejects duplicate plugin ids', async () => {
    const registry = getPluginRegistry();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await registry.activate(definePromise({ id: 'dup', setup: () => undefined }), {
        source: 'first',
      });
      await registry.activate(definePromise({ id: 'dup', setup: () => undefined }), {
        source: 'second',
      });

      const matches = registry.list().filter((entry) => entry.id === 'dup');
      expect(matches).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('exposes the plugin inventory through ctx.plugin.list()', async () => {
    const registry = getPluginRegistry();
    let seen: readonly { id: string }[] = [];

    // A plugin only appears in the inventory once its activation
    // completed (mirrors opencode: the slot is recorded after `setup`),
    // so the second plugin observes the first but not itself.
    await registry.activate(definePromise({ id: 'first', setup: () => undefined }), {
      source: 'test-first',
    });
    await registry.activate(
      definePromise({
        id: 'introspector',
        setup(ctx) {
          seen = ctx.plugin.list();
        },
      }),
      { source: 'test-introspector' },
    );

    expect(seen.some((entry) => entry.id === 'first')).toBe(true);
  });

  it('composes V1 (shim) and V2 plugins in registration order', async () => {
    const registry = getPluginRegistry();
    const trace: string[] = [];

    _registerPluginForTest('legacy', {
      'tool.execute.before': (_input, output) => {
        trace.push('v1');
        (output.args as Record<string, unknown>)['legacy'] = true;
      },
    });

    await registry.activate(
      definePromise({
        id: 'modern',
        setup(ctx) {
          ctx.tool.hook('execute.before', (event) => {
            trace.push('v2');
            expect((event.args as Record<string, unknown>)['legacy']).toBe(true);
          });
        },
      }),
      { source: 'test-modern' },
    );

    const out = { args: {} as unknown };
    await dispatchToolExecuteBefore({ tool: 'bash', sessionID: 's1', callID: 'c1' }, out);
    expect(trace).toEqual(['v1', 'v2']);
  });
});
