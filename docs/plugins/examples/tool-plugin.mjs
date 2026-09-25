/**
 * Example: tool plugin — contribute a tool + persist state.
 *
 * Registered tools are appended to the model-visible tool surface, are
 * whitelisted in the sandbox, and always resolve to the `custom`
 * permission category (default `ask`) — a plugin tool can never be
 * auto-approved.
 *
 * Install: copy this file to `<dataDir>/plugins/tool-plugin/index.mjs`
 * (or POST /plugins/install with the file path).
 */

export default {
  id: 'example.tool',
  async setup(ctx) {
    const calls = (await ctx.storage.get('call-count')) ?? 0;
    await ctx.storage.set('call-count', calls);

    ctx.tool.transform((editor) => {
      editor.add({
        name: 'plugin_echo',
        description: 'Echo the provided text back (example plugin tool).',
        input: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to echo.' },
          },
          required: ['text'],
          additionalProperties: false,
        },
        async execute(input, execution) {
          const text = typeof input?.text === 'string' ? input.text : '';
          const previous = (await ctx.storage.get('call-count')) ?? 0;
          await ctx.storage.set('call-count', previous + 1);
          return {
            output: `echo: ${text} (session ${execution.sessionID}, call #${previous + 1})`,
          };
        },
      });
    });

    return () => {
      /* registrations are disposed with the plugin; nothing else to do */
    };
  },
};
