import { describe, expect, it } from 'vitest';
import { buildChannelPersonaPromptFromMetadata } from '../../channels/channel-persona-prompt.js';

describe('channel persona prompt', () => {
  it('Given channel metadata with persona When building prompt Then it injects the persona content', () => {
    const prompt = buildChannelPersonaPromptFromMetadata(
      JSON.stringify({
        source: 'channel',
        replyLanguage: 'zh-CN',
        channel: {
          type: 'telegram',
          replyLanguage: 'zh-CN',
        },
        channelPersona: {
          resourceId: 'resource-soul-balanced-collaborator',
          title: '稳健协作者',
          content: '# SOUL.md\n保持稳健协作。',
        },
      }),
    );

    expect(prompt).toContain('<channel-persona>');
    expect(prompt).toContain('默认使用中文回复');
    expect(prompt).toContain('<channel-command-experience>');
    expect(prompt).toContain('本地命令入口：/help、/new、/status、/stats、/compress、/init。');
    expect(prompt).toContain('当前消息通道绑定的人设资源：稳健协作者');
    expect(prompt).toContain('# SOUL.md\n保持稳健协作。');
  });

  it('Given channel metadata without persona When building prompt Then it injects channel reply policy', () => {
    const prompt = buildChannelPersonaPromptFromMetadata(
      JSON.stringify({
        source: 'channel',
        replyLanguage: 'zh-CN',
        channel: {
          type: 'qq',
          replyLanguage: 'zh-CN',
        },
      }),
    );

    expect(prompt).toContain('<channel-reply-policy>');
    expect(prompt).toContain('<channel-command-experience>');
    expect(prompt).toContain('默认使用中文回复');
    expect(prompt).toMatch(
      /PluginSendMessage\s*\/\s*PluginSendImage[\s\S]*当前通道[\s\S]*当前会话/,
    );
    expect(prompt).toMatch(/PluginGetCurrentChatMessages[\s\S]*replyMessageId[\s\S]*message_id/);
    expect(prompt).toMatch(/图片[\s\S]*优先调用 PluginSendImage[\s\S]*真实图片附件/);
  });

  it('Given english channel metadata When building prompt Then it emits english reply policy and command hints', () => {
    const prompt = buildChannelPersonaPromptFromMetadata(
      JSON.stringify({
        source: 'channel',
        replyLanguage: 'en-US',
        channel: {
          type: 'telegram',
          replyLanguage: 'en-US',
        },
        channelPersona: {
          resourceId: 'resource-soul-balanced-collaborator',
          title: 'Balanced Collaborator',
          content: '# SOUL.md\nStay calm and helpful.',
        },
      }),
    );

    expect(prompt).toContain(
      'Default to English unless the user clearly asks for another language.',
    );
    expect(prompt).toContain(
      'Local command entry points: /help, /new, /status, /stats, /compress, /init.',
    );
    expect(prompt).toContain('Persona resource bound to this channel: Balanced Collaborator');
    expect(prompt).not.toContain('默认使用中文回复');
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
