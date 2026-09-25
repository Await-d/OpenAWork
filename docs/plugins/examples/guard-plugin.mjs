/**
 * Example: guard plugin — block reads of sensitive files.
 *
 * `tool.execute.before` runs before a tool executes; mutating
 * `event.args` changes what downstream execution sees. Plugins cannot
 * *reject* a tool call (the hook error model isolates failures), so a
 * guard expresses itself by rewriting args — here we blank out the path.
 *
 * Runtime form note: the loader only requires the plugin *shape*
 * (`{ id, setup }` or `{ id, effect }`). Importing `define` from
 * `@openAwork/plugin-sdk` is optional sugar for TypeScript projects
 * (it is an identity function); plain objects are the most portable
 * form for standalone plugin files.
 *
 * Install: copy this file to `<dataDir>/plugins/guard-plugin/index.mjs`
 * (or POST /plugins/install with the file path).
 */

const SENSITIVE = /(^|[/\\])\.env(\.|$)/;

export default {
  id: 'example.guard',
  setup(ctx) {
    ctx.tool.hook('execute.before', (event) => {
      if (event.tool !== 'read' && event.tool !== 'bash') return;
      const args = event.args;
      if (args === null || typeof args !== 'object') return;

      const record = args;
      const target =
        typeof record['path'] === 'string'
          ? record['path']
          : typeof record['filePath'] === 'string'
            ? record['filePath']
            : typeof record['command'] === 'string'
              ? record['command']
              : '';

      if (SENSITIVE.test(target)) {
        event.args = {
          ...record,
          path: '/dev/null',
          filePath: '/dev/null',
          command: 'true # blocked by example.guard',
        };
      }
    });

    return () => {
      /* nothing to clean up */
    };
  },
};
