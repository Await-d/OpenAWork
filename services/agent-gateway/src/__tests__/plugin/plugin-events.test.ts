/**
 * Plugin event domain (`src/plugin/events.ts`).
 *
 * Pins down the subscription contract:
 *   1. Events published after `subscribe()` (even before the first
 *      `next()`) are delivered — subscriptions are eager.
 *   2. `types` filters match exact names and prefixes.
 *   3. Aborting the signal ends iteration and detaches the bus handler.
 *   4. Deactivating the plugin (registry) aborts the plugin-lifetime
 *      signal, so subscriptions die with the plugin.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PluginEvent } from '@openAwork/plugin-sdk';
import { define as definePromise } from '@openAwork/plugin-sdk';
import { publishBusEvent } from '../../session/sync-event.js';
import { createPluginEventDomain } from '../../plugin/events.js';
import { getPluginRegistry } from '../../plugin/registry.js';
import { _resetPluginsForTest } from '../../runtime/plugin-host.js';

describe('plugin event domain', () => {
  beforeEach(() => {
    _resetPluginsForTest();
  });

  afterEach(() => {
    _resetPluginsForTest();
  });

  it('delivers events published after subscribe, before the first next()', async () => {
    const domain = createPluginEventDomain();
    const controller = new AbortController();
    const iterator = domain.subscribe({ signal: controller.signal })[Symbol.asyncIterator]();

    // Published before the first `next()` — must not be lost.
    publishBusEvent('session.created', { sessionID: 's1' });

    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({ type: 'session.created', data: { sessionID: 's1' } });

    controller.abort();
    const end = await iterator.next();
    expect(end.done).toBe(true);
  });

  it('filters by exact type and prefix', async () => {
    const domain = createPluginEventDomain();
    const controller = new AbortController();
    const iterator = domain
      .subscribe({ types: ['session.', 'todo.updated'], signal: controller.signal })
      [Symbol.asyncIterator]();

    publishBusEvent('message.part.updated', { part: 1 });
    publishBusEvent('todo.updated', { todos: [] });
    publishBusEvent('session.created', { sessionID: 's1' });

    const first = await iterator.next();
    expect(first.value?.type).toBe('todo.updated');
    const second = await iterator.next();
    expect(second.value?.type).toBe('session.created');

    controller.abort();
    expect((await iterator.next()).done).toBe(true);
  });

  it('ends iteration when the plugin is deactivated', async () => {
    const registry = getPluginRegistry();
    let iterator: AsyncIterator<PluginEvent> | undefined;

    await registry.activate(
      definePromise({
        id: 'listener',
        setup(ctx) {
          iterator = ctx.event.subscribe({ types: ['session.'] })[Symbol.asyncIterator]();
        },
      }),
      { source: 'test-listener' },
    );

    expect(iterator).toBeDefined();
    const pending = iterator?.next();

    publishBusEvent('session.updated', { sessionID: 's1' });
    const delivered = await pending;
    expect(delivered?.value?.type).toBe('session.updated');

    await registry.deactivate('listener');
    const ended = await iterator?.next();
    expect(ended?.done).toBe(true);
  });
});
