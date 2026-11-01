import { describe, expect, it } from 'vitest';
import {
  buildChannelRuntimePromptFromMetadata,
  resolveChannelPersonaSystemPrompt,
} from '../../channels/channel-persona-prompt.js';

describe('channel persona prompt', () => {
  it('Given channel metadata with persona When building route prompt Then it injects the persona content', () => {
    const metadataJson = JSON.stringify({
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
    });

    const routePrompt = resolveChannelPersonaSystemPrompt(metadataJson);

    expect(routePrompt).toContain('<channel-persona>');
    expect(routePrompt).toContain('当前消息通道绑定的人设资源：稳健协作者');
    expect(routePrompt).toContain('# SOUL.md\n保持稳健协作。');
  });

  it('Given channel persona When building runtime prompt Then persona content is not duplicated', () => {
    const metadataJson = JSON.stringify({
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
    });

    const runtimePrompt = buildChannelRuntimePromptFromMetadata(metadataJson);

    expect(runtimePrompt).toContain('<channel-reply-policy>');
    expect(runtimePrompt).toContain('默认使用中文回复');
    expect(runtimePrompt).toContain('<channel-command-experience>');
    expect(runtimePrompt).toContain(
      '本地命令入口：/help、/new、/status、/stats、/compress、/init。',
    );
    // 人设正文只在 stable 段出现一次
    expect(runtimePrompt).not.toContain('<channel-persona>');
    expect(runtimePrompt).not.toContain('保持稳健协作。');
  });

  it('Given channel metadata without persona When building prompts Then runtime policy exists and route prompt is empty', () => {
    const metadataJson = JSON.stringify({
      source: 'channel',
      replyLanguage: 'zh-CN',
      channel: {
        type: 'qq',
        replyLanguage: 'zh-CN',
      },
    });

    const runtimePrompt = buildChannelRuntimePromptFromMetadata(metadataJson);

    expect(runtimePrompt).toContain('<channel-reply-policy>');
    expect(runtimePrompt).toContain('<channel-command-experience>');
    expect(runtimePrompt).toContain('默认使用中文回复');
    expect(runtimePrompt).toMatch(
      /PluginSendMessage\s*\/\s*PluginSendImage[\s\S]*当前通道[\s\S]*当前会话/,
    );
    expect(runtimePrompt).toMatch(
      /PluginGetCurrentChatMessages[\s\S]*replyMessageId[\s\S]*message_id/,
    );
    expect(runtimePrompt).toMatch(/图片[\s\S]*优先调用 PluginSendImage[\s\S]*真实图片附件/);
    expect(resolveChannelPersonaSystemPrompt(metadataJson)).toBeNull();
  });

  it('Given english channel metadata When building prompts Then it emits english reply policy and persona', () => {
    const metadataJson = JSON.stringify({
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
    });

    const runtimePrompt = buildChannelRuntimePromptFromMetadata(metadataJson);
    const routePrompt = resolveChannelPersonaSystemPrompt(metadataJson);

    expect(runtimePrompt).toContain(
      'Default to English unless the user clearly asks for another language.',
    );
    expect(runtimePrompt).toContain(
      'Local command entry points: /help, /new, /status, /stats, /compress, /init.',
    );
    expect(runtimePrompt).not.toContain('默认使用中文回复');
    expect(routePrompt).toContain('Persona resource bound to this channel: Balanced Collaborator');
    expect(routePrompt).toContain('# SOUL.md\nStay calm and helpful.');
  });

  it('Given non-channel metadata When building prompts Then both return null', () => {
    const metadataJson = JSON.stringify({
      source: 'chat',
      channelPersona: {
        title: 'Ignored',
        content: 'should not inject',
      },
    });

    expect(buildChannelRuntimePromptFromMetadata(metadataJson)).toBeNull();
    expect(resolveChannelPersonaSystemPrompt(metadataJson)).toBeNull();
  });
});
