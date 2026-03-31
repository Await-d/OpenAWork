import { describe, expect, it } from 'vitest';

import { DirectoryAgentsInjectorImpl } from '../hooks/directory-agents-injector.js';

describe('DirectoryAgentsInjectorImpl', () => {
  it('formats injected instructions using reference-style headers', () => {
    const injector = new DirectoryAgentsInjectorImpl();
    const block = injector.buildInjectionBlock([
      {
        filePath: '/repo/AGENTS.md',
        content: 'Rule A',
        depth: 0,
      },
      {
        filePath: '/repo/packages/foo/CLAUDE.md',
        content: 'Rule B',
        depth: 2,
      },
    ]);

    expect(block).toContain('Instructions from: /repo/AGENTS.md\nRule A');
    expect(block).toContain('Instructions from: /repo/packages/foo/CLAUDE.md\nRule B');
    expect(block).not.toContain('<agents_context>');
  });
});
