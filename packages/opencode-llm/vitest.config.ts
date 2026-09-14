import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// `src/` ships committed compiled `.js` mirrors next to the `.ts` sources, so Vite
// would otherwise resolve relative `./x.js` imports — and these tests — to the stale
// mirror instead of the source under test. Point those specifiers at the sibling
// `.ts` file when it exists.
const preferTypeScriptSource = {
  name: 'prefer-typescript-source',
  enforce: 'pre' as const,
  resolveId(source: string, importer: string | undefined) {
    if (importer === undefined || !source.startsWith('.') || !source.endsWith('.js')) return null;
    const target = resolve(dirname(importer.split('?')[0] ?? importer), `${source.slice(0, -3)}.ts`);
    return existsSync(target) ? target : null;
  },
};

export default defineConfig({
  plugins: [preferTypeScriptSource],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
