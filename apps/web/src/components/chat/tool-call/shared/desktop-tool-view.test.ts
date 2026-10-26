import { describe, expect, it } from 'vitest';

import { desktopToolTitle, isDesktopTool, resolveDesktopToolView } from './desktop-tool-view.js';

describe('isDesktopTool / desktopToolTitle', () => {
  it('识别浏览器自动化与本机桌面控制（大小写 / 空白不敏感）', () => {
    expect(isDesktopTool('desktop_automation')).toBe(true);
    expect(isDesktopTool('  Desktop_Control ')).toBe(true);
    expect(isDesktopTool('computer_use')).toBe(false);
    expect(isDesktopTool('bash')).toBe(false);
  });

  it('标题区分两条通道', () => {
    expect(desktopToolTitle('desktop_automation')).toBe('浏览器自动化');
    expect(desktopToolTitle('desktop_control')).toBe('桌面控制');
  });
});

describe('resolveDesktopToolView：动作与目标', () => {
  it('goto 取 url 作为目标', () => {
    const view = resolveDesktopToolView({
      toolName: 'desktop_automation',
      input: { action: 'goto', url: 'https://example.com/a' },
    });

    expect(view.actionLabel).toBe('打开网页');
    expect(view.targetLabel).toBe('https://example.com/a');
  });

  it('click 优先用选择器', () => {
    const view = resolveDesktopToolView({
      toolName: 'desktop_automation',
      input: { action: 'click', selector: 'button#submit' },
    });

    expect(view.actionLabel).toBe('点击');
    expect(view.targetLabel).toBe('button#submit');
  });

  it('桌面点击没有选择器时给出坐标', () => {
    const view = resolveDesktopToolView({
      toolName: 'desktop_control',
      input: { action: 'click', x: 120.4, y: 80.6 },
    });

    expect(view.targetLabel).toBe('(120, 81)');
  });

  it('box 目标取矩形中心', () => {
    const view = resolveDesktopToolView({
      toolName: 'desktop_control',
      input: { action: 'long_press', box: [100, 200, 300, 400] },
    });

    expect(view.targetLabel).toBe('(200, 300)');
  });

  it('type 同时给出输入目标与截断后的文本', () => {
    const view = resolveDesktopToolView({
      toolName: 'desktop_automation',
      input: { action: 'type', selector: '#search', text: 'a'.repeat(80) },
    });

    expect(view.targetLabel.startsWith('#search “')).toBe(true);
    expect(view.targetLabel.endsWith('…”')).toBe(true);
    expect(view.targetLabel.length).toBeLessThan(90);
  });

  it('hotkey 用 + 连接按键', () => {
    const view = resolveDesktopToolView({
      toolName: 'desktop_control',
      input: { action: 'hotkey', keys: ['ctrl', 'shift', 's'] },
    });

    expect(view.targetLabel).toBe('ctrl + shift + s');
  });

  it('drag 给出起点 → 终点', () => {
    const view = resolveDesktopToolView({
      toolName: 'desktop_control',
      input: { action: 'drag', fromX: 10, fromY: 20, toX: 30, toY: 40 },
    });

    expect(view.actionLabel).toBe('拖拽');
    expect(view.targetLabel).toBe('(10, 20) → (30, 40)');
  });

  it('未知动作回退原始 action，且没有目标时为空串', () => {
    const view = resolveDesktopToolView({
      toolName: 'desktop_automation',
      input: { action: 'teleport' },
    });

    expect(view.actionLabel).toBe('teleport');
    expect(view.targetLabel).toBe('');
  });
});

describe('resolveDesktopToolView：输出语义', () => {
  it('{ok:true} 是确认型动作，不需要展示原始字段表', () => {
    const view = resolveDesktopToolView({
      toolName: 'desktop_automation',
      input: { action: 'click', selector: '#a' },
      output: JSON.stringify({ ok: true }),
    });

    expect(view.status).toBe('ok');
    expect(view.payloadKind).toBe('ack');
  });

  it('读取类动作保留数据展示', () => {
    const view = resolveDesktopToolView({
      toolName: 'desktop_automation',
      input: { action: 'status' },
      output: JSON.stringify({ enabled: true, started: false }),
    });

    expect(view.payloadKind).toBe('data');
  });

  it('截图动作走图片通道', () => {
    const view = resolveDesktopToolView({
      toolName: 'desktop_automation',
      input: { action: 'screenshot' },
      output: JSON.stringify({ ok: true, artifactId: 'art_1', mimeType: 'image/png' }),
    });

    expect(view.payloadKind).toBe('image');
    expect(view.status).toBe('ok');
  });

  it('error 字段非空判定失败并保留原因', () => {
    const view = resolveDesktopToolView({
      toolName: 'desktop_control',
      input: { action: 'click', x: 1, y: 2 },
      output: JSON.stringify({ ok: false, error: 'bridge unavailable' }),
    });

    expect(view.status).toBe('failed');
    expect(view.errorText).toBe('bridge unavailable');
  });

  it('ok:false 即使没有 error 文本也算失败', () => {
    const view = resolveDesktopToolView({
      toolName: 'desktop_automation',
      input: { action: 'start' },
      output: { ok: false },
    });

    expect(view.status).toBe('failed');
    expect(view.errorText).toBeUndefined();
  });

  it('isError 优先于输出内容', () => {
    const view = resolveDesktopToolView({
      toolName: 'desktop_automation',
      input: { action: 'goto' },
      output: { ok: true },
      isError: true,
    });

    expect(view.status).toBe('failed');
  });

  it('非 JSON 输出不猜结构（状态未知，交由卡片按 isError 兜底）', () => {
    const view = resolveDesktopToolView({
      toolName: 'desktop_automation',
      input: { action: 'content' },
      output: '{"html":"<div>trunc',
    });

    expect(view.status).toBe('unknown');
  });
});
