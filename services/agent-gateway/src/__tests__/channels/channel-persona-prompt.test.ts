import { describe, expect, it } from 'vitest';
import { buildChannelPersonaPromptFromMetadata } from '../../channels/channel-persona-prompt.js';

describe('channel persona prompt', () => {
  it('Given channel metadata with persona When building prompt Then it injects the persona content', () => {
    const prompt = buildChannelPersonaPromptFromMetadata(
      JSON.stringify({
        source: 'channel',
        channelPersona: {
          resourceId: 'resource-soul-balanced-collaborator',
          title: 'Balanced Collaborator',
          content: '# SOUL.md\n保持稳健协作。',
        },
      }),
    );

    expect(prompt).toContain('<channel-persona>');
    expect(prompt).toContain('当前消息通道绑定的人设资源：Balanced Collaborator');
    expect(prompt).toContain('# SOUL.md\n保持稳健协作。');
  });

  it('Given non-channel metadata When building prompt Then it returns null', () => {
    const prompt = buildChannelPersonaPromptFromMetadata(
      JSON.stringify({
        source: 'chat',
        channelPersona: {
          title: 'Ignored',
          content: 'should not inject',
        },
      }),
    );

    expect(prompt).toBeNull();
  });
});
