import { describe, expect, it } from 'vitest';
import { buildCommandDescriptors } from '../../routes/command-descriptors.js';

describe('compact command descriptors', () => {
  it('只暴露 /compact 作为压缩命令入口', () => {
    const descriptors = buildCommandDescriptors();
    const compactCommands = descriptors.filter(
      (command) => command.action.kind === 'compact_session',
    );

    expect(compactCommands).toHaveLength(1);
    expect(compactCommands[0]).toMatchObject({
      id: 'slash-compact',
      label: '/compact',
      description: '压缩当前会话上下文',
      execution: 'server',
    });
    expect(descriptors.some((command) => command.id === 'slash-summarize')).toBe(false);
    expect(descriptors.some((command) => command.label === '/summarize')).toBe(false);
  });
});
