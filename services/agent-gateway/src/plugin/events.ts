/**
 * Plugin event domain — subscribes plugins to the in-process bus
 * (`session/sync-event.ts`).
 *
 * Subscriptions are EAGER: `subscribe()` registers the bus handler
 * immediately, so events published between `subscribe()` and the first
 * `next()` are not lost. Delivery is a bounded queue per subscriber
 * (oldest entries drop with a one-time warning when a slow consumer
 * falls behind). Iteration ends when the combined signal aborts — the
 * plugin registry aborts a plugin-lifetime signal on unload, so
 * subscriptions die with the plugin and the bus handler is detached
 * even when the plugin never iterates.
 */

import type { EventDomain, EventSubscribeOptions, PluginEvent } from '@openAwork/plugin-sdk';
import { subscribeBusEvents } from '../session/sync-event.js';

const MAX_QUEUE_SIZE = 1000;

function matchesType(type: string, filters: readonly string[] | undefined): boolean {
  if (!filters || filters.length === 0) return true;
  return filters.some((filter) => type === filter || type.startsWith(filter));
}

export function createPluginEventDomain(): EventDomain {
  return {
    subscribe: (options?: EventSubscribeOptions): AsyncIterable<PluginEvent> =>
      createSubscription(options),
  };
}

function createSubscription(options?: EventSubscribeOptions): AsyncIterable<PluginEvent> {
  const queue: PluginEvent[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  let droppedAny = false;
  let detached = false;

  function detach(): void {
    if (detached) return;
    detached = true;
    unsubscribe();
    signal?.removeEventListener('abort', onAbort);
  }

  function onAbort(): void {
    closed = true;
    detach();
    wake?.();
  }

  const unsubscribe = subscribeBusEvents((type, data) => {
    if (closed) return;
    if (!matchesType(type, options?.types)) return;
    if (queue.length >= MAX_QUEUE_SIZE) {
      queue.shift();
      if (!droppedAny) {
        droppedAny = true;
        console.warn(
          `[plugin] event subscriber queue exceeded ${MAX_QUEUE_SIZE}; dropping oldest events.`,
        );
      }
    }
    queue.push({ type, data });
    wake?.();
  });

  const signal = options?.signal;
  if (signal?.aborted) {
    closed = true;
    detach();
  } else {
    signal?.addEventListener('abort', onAbort, { once: true });
  }

  return {
    [Symbol.asyncIterator]: async function* (): AsyncGenerator<PluginEvent> {
      try {
        while (!closed) {
          if (queue.length === 0) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = undefined;
            continue;
          }
          for (let event = queue.shift(); event !== undefined; event = queue.shift()) {
            yield event;
          }
        }
      } finally {
        detach();
      }
    },
  };
}
