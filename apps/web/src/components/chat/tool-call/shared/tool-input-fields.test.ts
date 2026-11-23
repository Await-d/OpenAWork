import { describe, expect, it } from 'vitest';
import {
  filterMcpInput,
  isMcpStyleInput,
  resolveDisplayedInputFields,
  resolveToolInputExtraFields,
  resolveToolInputMessage,
  resolveToolInputSection,
} from './tool-input-fields.js';

/**
 * 入参展示规则的唯一真源：抽屉标题的计数必须与预览实际铺出来的字段一致。
 *
 * 回归背景：标题按 `Object.keys(input).length` 数，而 MCP-legacy 的入参外面裹了一层
 * `arguments` —— 展开卡片时会看到「参数 (1)」下面躺着 3 个业务字段。
 */
describe('resolveToolInputSection — 标题与计数', () => {
  it('MCP 展平后的业务字段数才是计数（不是裸 key 的 1）', () => {
    const input = {
      arguments: { chat_id: 'c2c1', content: '正文', plugin_id: 'ep0' },
      serverId: 'open-websearch',
    };

    // 裸 key 只有 2 个（arguments / serverId），渲染出来的却是展平后的 3 个业务字段。
    expect(Object.keys(input)).toHaveLength(2);
    expect(resolveToolInputSection('mcp_call', input, 'mcp')).toEqual({ title: '参数', count: 3 });
    expect(resolveToolInputSection('mcp__srv__do', input)).toEqual({ title: '参数', count: 3 });

    // 不变量：计数 === 预览真正铺出来的字段数（两者同源，不允许各自算）。
    expect(resolveToolInputSection('mcp_call', input, 'mcp').count).toBe(
      Object.keys(resolveDisplayedInputFields('mcp_call', input, 'mcp')).length,
    );
    expect(resolveToolInputSection('grep', input).count).toBe(
      Object.keys(resolveDisplayedInputFields('grep', input)).length,
    );
  });

  it('渠道发送类展示的是消息正文：标题「内容」且不带计数', () => {
    const input = { arguments: { chat_id: 'c2c1', content: '正文', plugin_id: 'ep0' } };

    expect(resolveToolInputSection('PluginSendMessage', input, 'mcp')).toEqual({
      title: '内容',
      count: null,
    });
  });

  it('渠道发送类没有正文时退回参数表，且路由字段不计入', () => {
    const input = { chat_id: 'c2c1', plugin_id: 'ep0', file_path: '/tmp/a.pdf' };

    expect(resolveToolInputSection('PluginSendFile', input)).toEqual({ title: '参数', count: 1 });
  });

  it('普通工具的计数就是参数个数', () => {
    expect(resolveToolInputSection('grep', { pattern: 'a', path: 'b' })).toEqual({
      title: '参数',
      count: 2,
    });
  });
});

describe('resolveDisplayedInputFields', () => {
  it('MCP 形状才过滤元数据与展平 arguments', () => {
    const input = { arguments: { query: 'q' }, serverName: 'srv', method: 'tools/call' };

    expect(isMcpStyleInput('mcp_call')).toBe(true);
    expect(isMcpStyleInput('some_flat_tool', 'mcp')).toBe(true);
    expect(isMcpStyleInput('grep')).toBe(false);

    expect(resolveDisplayedInputFields('mcp_call', input, 'mcp')).toEqual({ query: 'q' });
    // 非 MCP 形状原样保留（普通工具里叫 arguments 的字段不该被吃掉）。
    expect(resolveDisplayedInputFields('custom', input)).toEqual(input);
    expect(filterMcpInput(input)).toEqual({ query: 'q' });
  });

  it('渠道发送类剥掉运行时填充的路由字段，读类工具保留 chatId', () => {
    const send = { chat_id: 'c2c1', chatId: 'c2c1', content: '正文' };
    expect(resolveDisplayedInputFields('PluginSendMessage', send)).toEqual({ content: '正文' });

    const read = { chatId: 'oc_room', limit: 20 };
    expect(resolveDisplayedInputFields('PluginGetGroupMessages', read)).toEqual(read);
  });
});

describe('resolveToolInputMessage', () => {
  it('只在渠道发送类且有正文时返回正文', () => {
    expect(
      resolveToolInputMessage('PluginSendMessage', { arguments: { content: '你好' } }, 'mcp'),
    ).toEqual({ key: 'content', body: '你好', hint: '正文' });

    expect(resolveToolInputMessage('PluginSendImage', { caption: '图注' })).toEqual({
      key: 'caption',
      body: '图注',
      hint: '图注',
    });

    // 只发文件不带图注 → 没有正文，交给参数表。
    expect(resolveToolInputMessage('PluginSendFile', { file_path: '/tmp/a.pdf' })).toBeNull();
    // 非发送类工具一律不认。
    expect(resolveToolInputMessage('PluginGetGroupMessages', { content: 'x' })).toBeNull();
    // 空白正文不算正文。
    expect(resolveToolInputMessage('PluginSendMessage', { content: '   ' })).toBeNull();
  });
});

/**
 * 正文之外的字段不能被「正文优先」吞掉：否则会出现「带图注时看不到发了哪个文件、
 * 不带图注反而看得到」这种自相矛盾。
 */
describe('resolveToolInputExtraFields', () => {
  it('发图带图注时仍能看见 file_path（只摘掉正文用的 caption）', () => {
    expect(
      resolveToolInputExtraFields('PluginSendImage', {
        chat_id: 'c2c1',
        plugin_id: 'ep0',
        file_path: '/tmp/a.png',
        caption: '图注',
      }),
    ).toEqual({ file_path: '/tmp/a.png' });
  });

  it('纯文本发送没有其余字段（截图里那种只剩 chat_id/content/plugin_id 的输入）', () => {
    expect(
      resolveToolInputExtraFields('PluginSendMessage', {
        chat_id: 'c2c1',
        plugin_id: 'ep0',
        content: '你好',
      }),
    ).toEqual({});
  });

  it('没有正文时返回全部展示字段（供参数表兜底）', () => {
    expect(
      resolveToolInputExtraFields('PluginSendFile', {
        chat_id: 'c2c1',
        file_path: '/tmp/a.pdf',
      }),
    ).toEqual({ file_path: '/tmp/a.pdf' });
  });
});
