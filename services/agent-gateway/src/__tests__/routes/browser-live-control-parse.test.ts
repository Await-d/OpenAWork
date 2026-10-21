import { describe, expect, it } from 'vitest';
import { parseBrowserLiveClientMessage } from '../../routes/browser-live.js';

describe('browser-live 控制消息解析', () => {
  it('解析浏览器历史后退 / 前进', () => {
    expect(parseBrowserLiveClientMessage({ ch: 'control', action: 'goBack' })).toEqual({
      ch: 'control',
      action: 'goBack',
    });
    expect(parseBrowserLiveClientMessage({ ch: 'control', action: 'goForward' })).toEqual({
      ch: 'control',
      action: 'goForward',
    });
  });

  it('已支持的动作保持原语义', () => {
    expect(parseBrowserLiveClientMessage({ ch: 'control', action: 'reload' })).toEqual({
      ch: 'control',
      action: 'reload',
    });
    expect(
      parseBrowserLiveClientMessage({ ch: 'control', action: 'navigate', url: 'https://a.test/' }),
    ).toEqual({ ch: 'control', action: 'navigate', url: 'https://a.test/' });
  });

  it('未知动作一律拒绝', () => {
    expect(parseBrowserLiveClientMessage({ ch: 'control', action: 'goForwardX' })).toBeNull();
    expect(
      parseBrowserLiveClientMessage({ ch: 'control', action: 'navigate', url: '' }),
    ).toBeNull();
  });

  it('copySelection 作为独立控制动作透传', () => {
    expect(parseBrowserLiveClientMessage({ ch: 'control', action: 'copySelection' })).toEqual({
      ch: 'control',
      action: 'copySelection',
    });
  });

  it('screencast.refresh 用于「静态页不再产帧」时强制补一帧', () => {
    expect(parseBrowserLiveClientMessage({ ch: 'control', action: 'screencast.refresh' })).toEqual({
      ch: 'control',
      action: 'screencast.refresh',
    });
  });

  it('screencast.start 支持 PNG 无损格式并拒绝未知格式', () => {
    expect(
      parseBrowserLiveClientMessage({
        ch: 'control',
        action: 'screencast.start',
        format: 'png',
      }),
    ).toEqual({ ch: 'control', action: 'screencast.start', format: 'png' });
    expect(
      parseBrowserLiveClientMessage({
        ch: 'control',
        action: 'screencast.start',
        format: 'webp',
      }),
    ).toBeNull();
  });

  it('滚动指标读取与拖动滚动条的控制动作', () => {
    expect(parseBrowserLiveClientMessage({ ch: 'control', action: 'scroll.metrics' })).toEqual({
      ch: 'control',
      action: 'scroll.metrics',
    });
    expect(parseBrowserLiveClientMessage({ ch: 'control', action: 'scrollTo', y: 320.5 })).toEqual({
      ch: 'control',
      action: 'scrollTo',
      y: 320.5,
    });

    // 非有限数 / 非数字一律拒绝：不能让 NaN / Infinity 流进 CDP 的滚动表达式。
    expect(parseBrowserLiveClientMessage({ ch: 'control', action: 'scrollTo' })).toBeNull();
    expect(
      parseBrowserLiveClientMessage({ ch: 'control', action: 'scrollTo', y: '20' }),
    ).toBeNull();
    expect(
      parseBrowserLiveClientMessage({
        ch: 'control',
        action: 'scrollTo',
        y: Number.POSITIVE_INFINITY,
      }),
    ).toBeNull();
  });
});

describe('browser-live 输入消息解析', () => {
  it('输入法整段文本走 kind=text，空文本拒绝', () => {
    expect(
      parseBrowserLiveClientMessage({ ch: 'input', kind: 'text', text: '你好，世界' }),
    ).toEqual({
      ch: 'input',
      kind: 'text',
      text: '你好，世界',
    });
    expect(parseBrowserLiveClientMessage({ ch: 'input', kind: 'text', text: '' })).toBeNull();
    expect(parseBrowserLiveClientMessage({ ch: 'input', kind: 'text', text: 42 })).toBeNull();
  });

  it('modifiers 只接受 CDP 的 0–15 位掩码', () => {
    expect(
      parseBrowserLiveClientMessage({
        ch: 'input',
        kind: 'key',
        type: 'keyDown',
        key: 'Enter',
        modifiers: 8,
      }),
    ).toEqual({ ch: 'input', kind: 'key', type: 'keyDown', key: 'Enter', modifiers: 8 });

    expect(
      parseBrowserLiveClientMessage({
        ch: 'input',
        kind: 'key',
        type: 'keyDown',
        modifiers: 16,
      }),
    ).toBeNull();
    expect(
      parseBrowserLiveClientMessage({
        ch: 'input',
        kind: 'key',
        type: 'keyDown',
        modifiers: 1.5,
      }),
    ).toBeNull();
  });

  it('编辑命令只在合法时透传（条数与长度受限）', () => {
    expect(
      parseBrowserLiveClientMessage({
        ch: 'input',
        kind: 'key',
        type: 'keyDown',
        key: 'a',
        commands: ['selectAll'],
      }),
    ).toEqual({
      ch: 'input',
      kind: 'key',
      type: 'keyDown',
      key: 'a',
      commands: ['selectAll'],
    });

    // 空数组 / 超长命令 / 非字符串都不能透传进 CDP。
    expect(
      parseBrowserLiveClientMessage({
        ch: 'input',
        kind: 'key',
        type: 'keyDown',
        commands: [],
      }),
    ).toBeNull();
    expect(
      parseBrowserLiveClientMessage({
        ch: 'input',
        kind: 'key',
        type: 'keyDown',
        commands: ['x'.repeat(33)],
      }),
    ).toBeNull();
    expect(
      parseBrowserLiveClientMessage({
        ch: 'input',
        kind: 'key',
        type: 'keyDown',
        commands: [1],
      }),
    ).toBeNull();
  });
});
