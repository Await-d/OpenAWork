/**
 * Example: notify plugin — subscribe to gateway events.
 *
 * `ctx.event.subscribe()` is eager: events published between
 * `subscribe()` and the first `next()` are queued, and the subscription
 * stops automatically when the plugin unloads.
 *
 * Install: copy this file to `<dataDir>/plugins/notify-plugin/index.mjs`
 * (or POST /plugins/install with the file path).
 */

export default {
  id: 'example.notify',
  setup(ctx) {
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          types: ['session.', 'message.part.updated'],
        })) {
          if (event.type === 'session.created') {
            console.log('[example.notify] session created:', JSON.stringify(event.data));
          }
        }
      } catch (err) {
        // Iteration ends on unload; anything else is worth a log.
        console.warn('[example.notify] subscription ended:', String(err));
      }
    })();

    return () => {
      /* the subscription ends with the plugin; the signal aborts it */
    };
  },
};
