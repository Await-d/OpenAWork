import { describe, expect, it } from 'vitest';

import { interactiveBashToolDefinition, tokenizeTmuxCommand } from '../interactive-bash-tools.js';

describe('interactive-bash-tools', () => {
  it('tokenizes quoted tmux commands', () => {
    expect(tokenizeTmuxCommand('send-keys -t omo "npm test" Enter')).toEqual([
      'send-keys',
      '-t',
      'omo',
      'npm test',
      'Enter',
    ]);
  });

  it('blocks capture-pane family subcommands', async () => {
    const output = await interactiveBashToolDefinition.execute(
      {
        tmux_command: 'capture-pane -p -t omo',
      },
      undefined as never,
    );
    expect(output).toContain('blocked in interactive_bash');
  });
});
