import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolInputPreview } from './tool-input-preview.js';

/**
 * 渠道发送类工具的入参展示。
 *
 * 回归背景：这类卡片此前走通用参数表，把运行时自动填充的 `plugin_id` / `chat_id`
 * 和整篇 markdown 正文原样铺出来（`**粗体**` 源码 + 两串无意义 id），既难读也把
 * 「已发送了消息」这件事实淹没。这里锁住三件事：剥路由字段、正文按 markdown 渲染、
 * 长正文默认折叠。
 */
const ROUTING = { chat_id: 'c2c1ACBA-内部会话-id', plugin_id: 'ep0000000-内部插件-id' };

afterEach(() => {
  cleanup();
});

describe('ToolInputPreview — 渠道发送类', () => {
  it('剥掉 plugin_id / chat_id，只展示正文并渲染 markdown', () => {
    const { container } = render(
      <ToolInputPreview
        toolName="PluginSendMessage"
        input={{
          ...ROUTING,
          content: '**模型与开发**\n\n1. Astra 校准\n2. 陶哲轩解猜想',
        }}
      />,
    );

    // 路由字段是运行时填的，对用户没有信息量。
    expect(container.textContent).not.toContain('plugin_id');
    expect(container.textContent).not.toContain('chat_id');
    expect(container.textContent).not.toContain('c2c1ACBA');
    expect(container.textContent).not.toContain('ep0000000');

    // 正文以 markdown 渲染（粗体成 <strong>），不再是 `**` 墙。
    expect(container.querySelector('strong')?.textContent).toBe('模型与开发');
    expect(container.textContent).not.toContain('**');
    expect(container.textContent).toContain('Astra 校准');
    // meta 行给出「发出去多少内容」这个可核对的事实。
    expect(screen.getByText('正文')).toBeTruthy();
    expect(screen.getByText(/字/)).toBeTruthy();
  });

  it('长正文默认折叠，可展开 / 收起', () => {
    const long = '第一段。\n'.repeat(200);
    const { container } = render(
      <ToolInputPreview toolName="PluginReplyMessage" input={{ ...ROUTING, content: long }} />,
    );

    const body = container.querySelector('.channel-message-body');
    expect(body?.getAttribute('data-collapsed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '显示全部' }));
    expect(body?.getAttribute('data-collapsed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(body?.getAttribute('data-collapsed')).toBe('true');
  });

  it('短正文不折叠、不出现展开按钮', () => {
    const { container } = render(
      <ToolInputPreview toolName="PluginSendMessage" input={{ ...ROUTING, content: '收到' }} />,
    );

    expect(container.querySelector('.channel-message-body')?.getAttribute('data-collapsed')).toBe(
      'false',
    );
    expect(screen.queryByRole('button', { name: '显示全部' })).toBeNull();
  });

  it('没有正文时退回参数表，但路由字段仍被剥掉（例如只发文件不带图注）', () => {
    const { container } = render(
      <ToolInputPreview
        toolName="PluginSendFile"
        input={{ ...ROUTING, file_path: '/workspace/report.pdf' }}
      />,
    );

    expect(container.querySelector('.channel-message-preview')).toBeNull();
    expect(container.textContent).toContain('file_path');
    expect(container.textContent).toContain('/workspace/report.pdf');
    expect(container.textContent).not.toContain('plugin_id');
    expect(container.textContent).not.toContain('chat_id');
  });

  it('图片类工具用 caption 当图注正文，同时保留 file_path（不得被正文吞掉）', () => {
    const { container } = render(
      <ToolInputPreview
        toolName="PluginSendImage"
        input={{ ...ROUTING, file_path: '/tmp/a.png', caption: '这是图注' }}
      />,
    );

    expect(screen.getByText('图注')).toBeTruthy();
    expect(container.textContent).toContain('这是图注');
    // 正文之外的字段仍要可见：否则「带图注时看不到发了哪个文件、不带图注反而看得到」。
    expect(container.textContent).toContain('file_path');
    expect(container.textContent).toContain('/tmp/a.png');
    expect(container.textContent).not.toContain('plugin_id');
    expect(container.textContent).not.toContain('chat_id');
  });

  it('纯文本发送没有多余字段：卡片里只剩正文块', () => {
    const { container } = render(
      <ToolInputPreview
        toolName="PluginSendMessage"
        input={{ ...ROUTING, content: '只发一段文字' }}
      />,
    );

    expect(container.querySelector('.channel-message-preview')).not.toBeNull();
    // 没有其余字段就不该再出现参数表。
    expect(container.querySelector('.param-list')).toBeNull();
  });

  it('读类渠道工具的 chatId 是主体，不得被剥掉', () => {
    const { container } = render(
      <ToolInputPreview
        toolName="PluginGetGroupMessages"
        input={{ chatId: 'oc_room-id', limit: 20 }}
      />,
    );

    expect(container.textContent).toContain('chatId');
    expect(container.textContent).toContain('oc_room-id');
  });

  it('非渠道工具行为不变', () => {
    const { container } = render(
      <ToolInputPreview toolName="grep" input={{ pattern: 'foo', path: 'src' }} />,
    );

    expect(container.textContent).toContain('pattern');
    expect(container.textContent).toContain('foo');
    expect(container.querySelector('.channel-message-preview')).toBeNull();
  });

  it('MCP 形状（arguments 包裹）走展平，元数据字段不入表', () => {
    const { container } = render(
      <ToolInputPreview
        toolName="mcp_call"
        kind="mcp"
        input={{
          arguments: { query: 'OpenAWork' },
          serverId: 'open-websearch',
          method: 'tools/call',
        }}
      />,
    );

    expect(container.textContent).toContain('query');
    expect(container.textContent).toContain('OpenAWork');
    expect(container.textContent).not.toContain('serverId');
    expect(container.textContent).not.toContain('method');
    // 不应把 arguments 这个包裹层本身当成一个参数展示。
    expect(container.textContent).not.toContain('arguments');
  });
});
