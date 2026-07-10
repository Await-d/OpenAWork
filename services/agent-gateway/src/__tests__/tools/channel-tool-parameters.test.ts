import { describe, expect, it } from 'vitest';
import { buildChannelToolParameters } from '../../tools/channel-tool-parameters.js';

describe('channel tool parameters', () => {
  it('Given PluginSendImage in a channel session When exposing parameters Then current channel ids are not requested', () => {
    const parameters = buildChannelToolParameters('PluginSendImage');

    expect(parameters).toMatchObject({
      type: 'object',
      required: ['file_path'],
      additionalProperties: false,
    });
    expect(parameters?.properties).toEqual(
      expect.objectContaining({
        file_path: expect.any(Object),
        content: expect.any(Object),
        message_id: expect.any(Object),
      }),
    );
    expect(parameters?.properties).not.toHaveProperty('plugin_id');
    expect(parameters?.properties).not.toHaveProperty('chat_id');
  });
});
