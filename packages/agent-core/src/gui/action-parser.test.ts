import { describe, expect, it } from 'vitest';
import {
  GUI_IMAGE_FACTOR,
  GUI_MAX_RATIO,
  GUI_MIN_PIXELS,
  parseActionVlm,
  parseSingleAction,
  smartResizeForV15,
} from './action-parser.js';

describe('parseSingleAction', () => {
  it('解析基本函数调用与关键字参数', () => {
    const action = parseSingleAction("click(start_box='(279,81)')");
    expect(action?.function).toBe('click');
    expect(action?.args['start_box']).toBe('(279,81)');
  });

  it('去掉引号并保留含等号的值', () => {
    const action = parseSingleAction("type(content='a=b&c')");
    expect(action?.function).toBe('type');
    expect(action?.args['content']).toBe('a=b&c');
  });

  it('识别 point= 别名并归一为 start_box', () => {
    const action = parseSingleAction("click(point='<point>510 150</point>')");
    expect(action?.args['start_box']).toBe('(510,150)');
  });

  it('识别 start_point / end_point 别名', () => {
    const action = parseSingleAction(
      "drag(start_point='<point>458 328</point>', end_point='<point>350 309</point>')",
    );
    expect(action?.args['start_box']).toBe('(458,328)');
    expect(action?.args['end_box']).toBe('(350,309)');
  });

  it('解析 <bbox> 写法（空格分隔）', () => {
    const action = parseSingleAction("click(start_box='<bbox>637 964 637 964</bbox>')");
    expect(action?.args['start_box']).toBe('(637,964,637,964)');
  });

  it('去掉 <|box_start|> / <|box_end|> 标记', () => {
    const action = parseSingleAction("click(start_box='<|box_start|>(1,2)<|box_end|>')");
    expect(action?.args['start_box']).toBe('(1,2)');
  });

  it('非函数调用返回 null 且不抛异常', () => {
    expect(parseSingleAction('这不是动作')).toBeNull();
    expect(() => parseSingleAction('broken(')).not.toThrow();
  });
});

describe('parseActionVlm', () => {
  it('解析 Thought + Action 结构', () => {
    const result = parseActionVlm("Thought: 打开设置\nAction: click(start_box='(500,500)')");
    expect(result.thought).toBe('打开设置');
    expect(result.parsed).toHaveLength(1);
    expect(result.parsed[0]?.action_type).toBe('click');
  });

  it('解析 Reflection 结构', () => {
    const result = parseActionVlm(
      "Reflection: 上一步点击偏了\nAction_Summary: 重新点击\nAction: click(start_box='(1,2)')",
    );
    expect(result.reflection).toBe('上一步点击偏了');
    expect(result.thought).toBe('重新点击');
  });

  it('无 Action 关键字时把全文当动作体', () => {
    const result = parseActionVlm("click(start_box='(10,10)')");
    expect(result.parsed[0]?.action_type).toBe('click');
  });

  it('按空行拆分多条动作', () => {
    const result = parseActionVlm("Action: click(start_box='(1,1)')\n\nhotkey(keys='ctrl+c')");
    expect(result.parsed).toHaveLength(2);
    expect(result.parsed[0]?.action_type).toBe('click');
    expect(result.parsed[1]?.action_type).toBe('hotkey');
  });

  it('坐标按 factor 归一（默认 1000）', () => {
    const result = parseActionVlm("Action: click(start_box='(500,250)')", {
      factor: 1000,
    });
    const box = JSON.parse(String(result.parsed[0]?.action_inputs['start_box']));
    expect(box).toEqual([0.5, 0.25, 0.5, 0.25]);
  });

  it('提供 screenContext 时产出像素中心坐标', () => {
    const result = parseActionVlm("Action: click(start_box='(500,500)')", {
      factor: 1000,
      screenContext: { width: 1000, height: 800 },
    });
    expect(result.parsed[0]?.action_inputs['start_coords']).toEqual([500, 400]);
  });

  it('end_box 产出 end_coords', () => {
    const result = parseActionVlm("Action: drag(start_box='(200,200)', end_box='(800,600)')", {
      factor: 1000,
      screenContext: { width: 1000, height: 1000 },
    });
    expect(result.parsed[0]?.action_inputs['start_coords']).toEqual([200, 200]);
    expect(result.parsed[0]?.action_inputs['end_coords']).toEqual([800, 600]);
  });

  it('单点 box 展开为退化矩形', () => {
    const result = parseActionVlm("Action: click(start_box='(300,300)')", { factor: 1000 });
    const box = JSON.parse(String(result.parsed[0]?.action_inputs['start_box']));
    expect(box).toEqual([0.3, 0.3, 0.3, 0.3]);
  });

  it('scaleFactor 影响像素坐标', () => {
    const result = parseActionVlm("Action: click(start_box='(500,500)')", {
      factor: 1000,
      screenContext: { width: 1000, height: 1000 },
      scaleFactor: 2,
    });
    expect(result.parsed[0]?.action_inputs['start_coords']).toEqual([1000, 1000]);
  });

  it('o1 模式解析标签结构', () => {
    const result = parseActionVlm(
      "<Thought>思考内容</Thought>\nAction_Summary: 摘要\nAction: click(start_box='(1,1)')\n</Output>",
      { mode: 'o1' },
    );
    expect(result.thought).toContain('思考内容');
    expect(result.parsed[0]?.action_type).toBe('click');
  });

  it('非动作文本产出空 action_type 且不抛异常', () => {
    const result = parseActionVlm('模型没有输出动作');
    expect(result.parsed[0]?.action_type).toBe('');
  });

  it('未提供 maxPixels 时 v1.5 不做智能缩放', () => {
    const result = parseActionVlm("Action: click(start_box='(500,500)')", {
      modelVer: 'v1.5',
      factor: 1000,
      screenContext: { width: 1000, height: 1000 },
    });
    // 无 maxPixels → smartResizeFactors 为 null → 走普通 factor 归一
    expect(result.parsed[0]?.action_inputs['start_coords']).toEqual([500, 500]);
  });
});

describe('smartResizeForV15', () => {
  it('长宽比越界返回 null（不再 console.error）', () => {
    expect(smartResizeForV15(10, 100000, { maxPixels: 1_000_000 })).toBeNull();
  });

  it('非正尺寸返回 null', () => {
    expect(smartResizeForV15(0, 100, { maxPixels: 1_000_000 })).toBeNull();
  });

  it('未提供 maxPixels 返回 null', () => {
    expect(smartResizeForV15(1080, 1920)).toBeNull();
  });

  it('超预算时按 factor 对齐并收敛', () => {
    const result = smartResizeForV15(2160, 3840, { maxPixels: 2_000_000 });
    expect(result).not.toBeNull();
    const [width, height] = result ?? [0, 0];
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(width % GUI_IMAGE_FACTOR).toBe(0);
    expect(height % GUI_IMAGE_FACTOR).toBe(0);
  });

  it('低于最小预算时放大到 MIN_PIXELS 附近', () => {
    const result = smartResizeForV15(28, 28, { maxPixels: 100_000_000 });
    expect(result).not.toBeNull();
    const [width, height] = result ?? [0, 0];
    expect(width * height).toBeGreaterThanOrEqual(GUI_MIN_PIXELS);
  });
});

describe('常量', () => {
  it('与上游 VLM 常量一致', () => {
    expect(GUI_IMAGE_FACTOR).toBe(28);
    expect(GUI_MIN_PIXELS).toBe(100 * 28 * 28);
    expect(GUI_MAX_RATIO).toBe(200);
  });
});
