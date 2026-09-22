import { describe, expect, it, vi } from 'vitest';
import type { GuiParsedAction } from '@openAwork/agent-core';
import type {
  DesktopControlActionResult,
  DesktopControlManager,
} from '../../tools/desktop-control.js';
import type { DesktopControlStatus } from '../../tools/desktop-control-status.js';
import {
  createDesktopControlOperator,
  resolveDesktopControlCapabilities,
} from '../../tools/gui/desktop-control-operator.js';

const SAMPLE_CAPABILITIES = {
  screenshot: { available: true, driver: 'grim' },
  click: { available: true, driver: 'xdotool' },
  typeText: { available: true, driver: 'xdotool' },
  key: { available: true, driver: 'xdotool' },
  hotkey: { available: true, driver: 'xdotool' },
  scroll: { available: true, driver: 'xdotool' },
  wait: { available: true, driver: 'std-thread-sleep' },
  drag: { available: true, driver: 'xdotool' },
  mouseMove: { available: true, driver: 'xdotool' },
  longPress: { available: true, driver: 'xdotool' },
} as const;

type DesktopActionMock = (...args: unknown[]) => Promise<DesktopControlActionResult>;

class FakeDesktopControlManager implements DesktopControlManager {
  readonly status = vi.fn<() => Promise<DesktopControlStatus>>(async () => ({
    enabled: true,
    capabilities: SAMPLE_CAPABILITIES,
  }));
  readonly screenshot = vi.fn<DesktopActionMock>(async () => ({
    success: true,
    mediaType: 'image/png',
    data: 'BASE64_IMAGE',
    byteLength: 11,
  }));
  readonly click = vi.fn<DesktopActionMock>(async () => ({ success: true }));
  readonly type = vi.fn<DesktopActionMock>(async () => ({ success: true }));
  readonly key = vi.fn<DesktopActionMock>(async () => ({ success: true }));
  readonly hotkey = vi.fn<DesktopActionMock>(async () => ({ success: true }));
  readonly scroll = vi.fn<DesktopActionMock>(async () => ({ success: true }));
  readonly wait = vi.fn<DesktopActionMock>(async () => ({ success: true }));
  readonly drag = vi.fn<DesktopActionMock>(async () => ({ success: true }));
  readonly mouseMove = vi.fn<DesktopActionMock>(async () => ({ success: true }));
  readonly longPress = vi.fn<DesktopActionMock>(async () => ({ success: true }));
}

const SCREEN = { width: 1000, height: 800 } as const;
const SQUARE_SCREEN = { width: 1000, height: 1000 } as const;

function action(name: string, raw: string, params: readonly unknown[] = []): GuiParsedAction {
  return { name, raw, params };
}

function createOperator(
  manager: DesktopControlManager,
  screenSize: { readonly width: number; readonly height: number } = SCREEN,
) {
  return createDesktopControlOperator({ manager, screenSize });
}

describe('createDesktopControlOperator 坐标换算', () => {
  it('click 的 0–1000 box 换算为像素中心（1000×800 时 (500,500) → 500,400）', async () => {
    const manager = new FakeDesktopControlManager();

    const result = await createOperator(manager).execute(
      action('click', "click(start_box='(500,500)')"),
    );

    expect(result.success).toBe(true);
    expect(manager.click).toHaveBeenCalledWith({
      action: 'click',
      x: 500,
      y: 400,
      button: 'left',
      clickAction: 'click',
    });
  });

  it('单点 box（2 个数字）展开不抛错且落到 (300,300)', async () => {
    const manager = new FakeDesktopControlManager();

    const result = await createOperator(manager, SQUARE_SCREEN).execute(
      action('click', "click(start_box='(300,300)')"),
    );

    expect(result.success).toBe(true);
    expect(manager.click).toHaveBeenCalledWith({
      action: 'click',
      x: 300,
      y: 300,
      button: 'left',
      clickAction: 'click',
    });
  });

  it('四点 box 取矩形中心', async () => {
    const manager = new FakeDesktopControlManager();

    await createOperator(manager).execute(action('click', "click(start_box='[100,200,300,400]')"));

    expect(manager.click).toHaveBeenCalledWith({
      action: 'click',
      x: 200,
      y: 240,
      button: 'left',
      clickAction: 'click',
    });
  });

  it('dpr=2 时把物理像素还原为逻辑坐标', async () => {
    const manager = new FakeDesktopControlManager();
    const operator = createDesktopControlOperator({
      manager,
      screenSize: SCREEN,
      dpr: 2,
    });

    await operator.execute(action('click', "click(start_box='(500,500)')"));

    expect(manager.click).toHaveBeenCalledWith({
      action: 'click',
      x: 250,
      y: 200,
      button: 'left',
      clickAction: 'click',
    });
  });

  it('params 中的结构化 start_box 数组同样被解析', async () => {
    const manager = new FakeDesktopControlManager();

    await createOperator(manager).execute(action('click', 'click()', [{ start_box: [500, 500] }]));

    expect(manager.click).toHaveBeenCalledWith({
      action: 'click',
      x: 500,
      y: 400,
      button: 'left',
      clickAction: 'click',
    });
  });
});

describe('createDesktopControlOperator 动作映射', () => {
  it('left_double 别名映射为 double_click', async () => {
    const manager = new FakeDesktopControlManager();

    await createOperator(manager).execute(
      action('left_double', "left_double(start_box='(500,500)')"),
    );

    expect(manager.click).toHaveBeenCalledWith({
      action: 'click',
      x: 500,
      y: 400,
      button: 'left',
      clickAction: 'double_click',
    });
  });

  it('right_single 别名映射为右键单击', async () => {
    const manager = new FakeDesktopControlManager();

    await createOperator(manager).execute(
      action('right_single', "right_single(start_box='(500,500)')"),
    );

    expect(manager.click).toHaveBeenCalledWith({
      action: 'click',
      x: 500,
      y: 400,
      button: 'right',
      clickAction: 'click',
    });
  });

  it('drag 把起点/终点换算后传给 manager.drag', async () => {
    const manager = new FakeDesktopControlManager();

    await createOperator(manager).execute(
      action('drag', "drag(start_box='(200,200)', end_box='(800,600)')"),
    );

    expect(manager.drag).toHaveBeenCalledWith({
      action: 'drag',
      fromX: 200,
      fromY: 160,
      toX: 800,
      toY: 480,
      button: 'left',
      ms: 300,
    });
  });

  it('mouse_move 把中心点传给 manager.mouseMove', async () => {
    const manager = new FakeDesktopControlManager();

    await createOperator(manager).execute(
      action('mouse_move', "mouse_move(start_box='(100,100)')"),
    );

    expect(manager.mouseMove).toHaveBeenCalledWith({
      action: 'mouse_move',
      x: 100,
      y: 80,
    });
  });

  it('long_press 使用默认 button/ms', async () => {
    const manager = new FakeDesktopControlManager();

    await createOperator(manager).execute(
      action('long_press', "long_press(start_box='(100,100)')"),
    );

    expect(manager.longPress).toHaveBeenCalledWith({
      action: 'long_press',
      x: 100,
      y: 80,
      button: 'left',
      ms: 800,
    });
  });

  it('type 把 content 传给 manager.type', async () => {
    const manager = new FakeDesktopControlManager();

    await createOperator(manager).execute(action('type', "type(content='hello world')"));

    expect(manager.type).toHaveBeenCalledWith({ action: 'type', text: 'hello world' });
  });

  it('hotkey 把 key 字符串拆成按键数组', async () => {
    const manager = new FakeDesktopControlManager();

    await createOperator(manager).execute(action('hotkey', "hotkey(key='ctrl+c')"));

    expect(manager.hotkey).toHaveBeenCalledWith({ action: 'hotkey', keys: ['ctrl', 'c'] });
  });

  it('scroll 按 direction 换算滚动量并带上坐标', async () => {
    const manager = new FakeDesktopControlManager();

    await createOperator(manager).execute(
      action('scroll', "scroll(start_box='(500,500)', direction='down')"),
    );

    expect(manager.scroll).toHaveBeenCalledWith({
      action: 'scroll',
      x: 500,
      y: 400,
      scrollX: 0,
      scrollY: 600,
    });
  });

  it('scroll 向上为负滚动量', async () => {
    const manager = new FakeDesktopControlManager();

    await createOperator(manager).execute(action('scroll', "scroll(direction='up')"));

    expect(manager.scroll).toHaveBeenCalledWith({
      action: 'scroll',
      scrollX: 0,
      scrollY: -600,
    });
  });

  it('scroll 向左 / 向右的滚动量符号与 Rust 驱动一致（G5）', async () => {
    // 契约来源：desktop_control_native_linux_input.rs:118-119
    //   run_scroll_axis(scroll_y, "5", "4")  → 正数=按钮5=向下，负数=按钮4=向上
    //   run_scroll_axis(scroll_x, "7", "6")  → 正数=按钮7=向右，负数=按钮6=向左
    // 因此 right 必须为正、left 必须为负；改错会让滚动方向整体反向。
    const manager = new FakeDesktopControlManager();

    await createOperator(manager).execute(action('scroll', "scroll(direction='right')"));
    await createOperator(manager).execute(action('scroll', "scroll(direction='left')"));

    expect(manager.scroll).toHaveBeenNthCalledWith(1, {
      action: 'scroll',
      scrollX: 600,
      scrollY: 0,
    });
    expect(manager.scroll).toHaveBeenNthCalledWith(2, {
      action: 'scroll',
      scrollX: -600,
      scrollY: 0,
    });
  });

  it('wait 缺省为 5000ms', async () => {
    const manager = new FakeDesktopControlManager();

    await createOperator(manager).execute(action('wait', 'wait()'));

    expect(manager.wait).toHaveBeenCalledWith({ action: 'wait', ms: 5000 });
  });
});

describe('createDesktopControlOperator 非法输入', () => {
  it('空 box 返回 success:false 且不抛异常', async () => {
    const manager = new FakeDesktopControlManager();

    const result = await createOperator(manager).execute(action('click', "click(start_box='')"));

    expect(result.success).toBe(false);
    expect(result.detail).toContain('start_box');
    expect(manager.click).not.toHaveBeenCalled();
  });

  it('非数字坐标返回 success:false 且不抛异常', async () => {
    const manager = new FakeDesktopControlManager();

    const result = await createOperator(manager).execute(
      action('click', "click(start_box='(abc,def)')"),
    );

    expect(result.success).toBe(false);
    expect(manager.click).not.toHaveBeenCalled();
  });

  it('退化 box（x1 >= x2）按单点处理而非失败（模型对"点"的常见输出）', async () => {
    const manager = new FakeDesktopControlManager();

    const result = await createOperator(manager).execute(
      action('click', "click(start_box='(300,300,100,100)')"),
    );

    // 退化矩形取中心 (200,200)，按 0–1 比例换算到默认屏幕（1000×800）→ (200,160)
    expect(result.success).toBe(true);
    expect(manager.click).toHaveBeenCalledWith(expect.objectContaining({ x: 200, y: 160 }));
  });

  it('不支持的动作返回 success:false', async () => {
    const manager = new FakeDesktopControlManager();

    const result = await createOperator(manager).execute(action('finished', 'finished()'));

    expect(result.success).toBe(false);
    expect(result.detail).toContain('不支持');
  });

  it('manager 抛错时转成 success:false 结果', async () => {
    const manager = new FakeDesktopControlManager();
    manager.click.mockRejectedValueOnce(new Error('desktop control is disabled in this runtime'));

    const result = await createOperator(manager).execute(
      action('click', "click(start_box='(500,500)')"),
    );

    expect(result.success).toBe(false);
    expect(result.detail).toContain('desktop control is disabled');
  });
});

describe('createDesktopControlOperator screenshot', () => {
  it('从 manager 结果提取 base64 与 mediaType，宽高回退 screenSize', async () => {
    const manager = new FakeDesktopControlManager();

    const screenshot = await createOperator(manager).screenshot();

    expect(screenshot).toEqual({
      dataBase64: 'BASE64_IMAGE',
      mediaType: 'image/png',
      width: 1000,
      height: 800,
    });
  });

  it('结果提供宽高时优先使用', async () => {
    const manager = new FakeDesktopControlManager();
    manager.screenshot.mockResolvedValueOnce({
      success: true,
      mediaType: 'image/webp',
      data: 'AAAA',
      width: 1920,
      height: 1080,
    });

    const screenshot = await createOperator(manager).screenshot();

    expect(screenshot).toEqual({
      dataBase64: 'AAAA',
      mediaType: 'image/webp',
      width: 1920,
      height: 1080,
    });
  });

  it('缺少 base64 数据时抛出中文错误', async () => {
    const manager = new FakeDesktopControlManager();
    manager.screenshot.mockResolvedValueOnce({ success: true, mediaType: 'image/png' });

    await expect(createOperator(manager).screenshot()).rejects.toThrow('缺少 base64 数据');
  });
});

describe('resolveDesktopControlCapabilities', () => {
  it('把 manager.status 能力位映射为 supportedActions', async () => {
    const manager = new FakeDesktopControlManager();

    const capabilities = await resolveDesktopControlCapabilities(manager);

    expect(capabilities.supportedActions).toEqual(
      expect.arrayContaining([
        'screenshot',
        'click',
        'double_click',
        'right_click',
        'type',
        'hotkey',
        'scroll',
        'wait',
        'drag',
        'mouse_move',
        'long_press',
      ]),
    );
  });

  it('桥未启用时返回空能力集', async () => {
    const manager = new FakeDesktopControlManager();
    manager.status.mockResolvedValueOnce({ enabled: false, reason: '未配置' });

    const capabilities = await resolveDesktopControlCapabilities(manager);

    expect(capabilities.supportedActions).toEqual([]);
  });
});
