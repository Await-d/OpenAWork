import { describe, expect, it } from 'vitest';
import { parseModelOutput } from '@openAwork/agent-core';
import { createDesktopControlOperator } from '../../tools/gui/desktop-control-operator.js';
import type { DesktopControlManager } from '../../tools/desktop-control.js';

describe('回归：Runner → Operator 坐标语义衔接', () => {
  it('模型点击屏幕中心(500,500) 应落到 500,400 而非 0.5px', async () => {
    const calls: Array<{ x: number; y: number }> = [];
    const manager = {
      status: async () => ({ enabled: true }),
      screenshot: async () => ({}),
      click: async (input: { x: number; y: number }) => {
        calls.push({ x: input.x, y: input.y });
        return {};
      },
      type: async () => ({}),
      key: async () => ({}),
      hotkey: async () => ({}),
      scroll: async () => ({}),
      wait: async () => ({}),
      drag: async () => ({}),
      mouseMove: async () => ({}),
      longPress: async () => ({}),
    } as unknown as DesktopControlManager;

    const operator = createDesktopControlOperator({
      manager,
      screenSize: { width: 1000, height: 800 },
    });

    // Runner 的真实产出
    const out = parseModelOutput("Thought: 点击中心\nAction: click(start_box='(500,500)')", {
      screenSize: { width: 1000, height: 800 },
    });
    expect(out.action).not.toBeNull();

    await operator.execute(out.action!);

    console.log('=== 实际点击坐标 ===', JSON.stringify(calls));
    expect(calls[0]).toEqual({ x: 500, y: 400 });
  });

  it('drag 的起终点都应正确换算（0–1 比例 → 逻辑像素）', async () => {
    const drags: Array<{ fromX: number; fromY: number; toX: number; toY: number }> = [];
    const manager = {
      status: async () => ({ enabled: true }),
      screenshot: async () => ({}),
      drag: async (input: { fromX: number; fromY: number; toX: number; toY: number }) => {
        drags.push({
          fromX: input.fromX,
          fromY: input.fromY,
          toX: input.toX,
          toY: input.toY,
        });
        return {};
      },
    } as unknown as DesktopControlManager;

    const screenSize = { width: 1000, height: 1000 };
    const operator = createDesktopControlOperator({ manager, screenSize });

    const out = parseModelOutput("Action: drag(start_box='(100,100)', end_box='(800,600)')", {
      screenSize,
    });
    await operator.execute(out.action!);

    expect(drags[0]).toEqual({ fromX: 100, fromY: 100, toX: 800, toY: 600 });
  });

  it('单点 click 不应因退化矩形而失败', async () => {
    const calls: Array<{ x: number; y: number }> = [];
    const manager = {
      status: async () => ({ enabled: true }),
      screenshot: async () => ({}),
      click: async (input: { x: number; y: number }) => {
        calls.push({ x: input.x, y: input.y });
        return {};
      },
    } as unknown as DesktopControlManager;

    const screenSize = { width: 1000, height: 1000 };
    const operator = createDesktopControlOperator({ manager, screenSize });

    const out = parseModelOutput("Action: click(start_box='(300,300)')", { screenSize });
    const result = await operator.execute(out.action!);

    expect(result.success).toBe(true);
    expect(calls[0]).toEqual({ x: 300, y: 300 });
  });

  it('type / hotkey 的文本与按键应正确传递（不依赖位置参数）', async () => {
    const typed: string[] = [];
    const hotkeys: string[][] = [];
    const manager = {
      status: async () => ({ enabled: true }),
      screenshot: async () => ({}),
      type: async (input: { text: string }) => {
        typed.push(input.text);
        return {};
      },
      hotkey: async (input: { keys: string[] }) => {
        hotkeys.push(input.keys);
        return {};
      },
    } as unknown as DesktopControlManager;

    const screenSize = { width: 1000, height: 1000 };
    const operator = createDesktopControlOperator({ manager, screenSize });

    await operator.execute(
      parseModelOutput("Action: type(content='hello')", { screenSize }).action!,
    );
    await operator.execute(
      parseModelOutput("Action: hotkey(key='ctrl+c')", { screenSize }).action!,
    );

    expect(typed[0]).toBe('hello');
    expect(hotkeys[0]).toEqual(['ctrl', 'c']);
  });
});
