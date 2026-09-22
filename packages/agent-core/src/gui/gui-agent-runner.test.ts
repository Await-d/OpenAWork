import { describe, expect, it } from 'vitest';
import type { GuiParsedAction } from './action-types.js';
import type { GuiRunnerEvent, GuiRunnerModel } from './gui-agent-runner.js';
import { GuiAgentRunner, parseModelOutput } from './gui-agent-runner.js';
import type { GuiOperator, GuiOperatorExecutionResult, GuiOperatorScreenshot } from './operator.js';

const SCREENSHOT: GuiOperatorScreenshot = {
  dataBase64: 'AAAA',
  mediaType: 'image/png',
  width: 100,
  height: 100,
};

type ModelInput = Parameters<GuiRunnerModel['predict']>[0];

class FakeOperator implements GuiOperator {
  readonly executed: GuiParsedAction[] = [];
  screenshotCount = 0;

  constructor(private readonly results: readonly GuiOperatorExecutionResult[] = []) {}

  async screenshot(): Promise<GuiOperatorScreenshot> {
    this.screenshotCount += 1;
    return SCREENSHOT;
  }

  async execute(action: GuiParsedAction): Promise<GuiOperatorExecutionResult> {
    this.executed.push(action);
    return this.results[this.executed.length - 1] ?? { success: true };
  }
}

class ScriptedModel implements GuiRunnerModel {
  readonly calls: ModelInput[] = [];
  private index = 0;

  constructor(private readonly outputs: readonly string[]) {}

  async predict(input: ModelInput): Promise<string> {
    this.calls.push(input);
    const last = this.outputs[this.outputs.length - 1];
    const output = this.outputs[this.index] ?? last;
    this.index += 1;
    return output ?? 'finished()';
  }
}

function collectEvents(): { events: GuiRunnerEvent[]; onEvent: (event: GuiRunnerEvent) => void } {
  const events: GuiRunnerEvent[] = [];
  return {
    events,
    onEvent: (event) => {
      events.push(event);
    },
  };
}

describe('GuiAgentRunner 主循环', () => {
  it('单步 finished 即成功', async () => {
    const operator = new FakeOperator();
    const model = new ScriptedModel(['Thought: 已经完成\nAction: finished()']);
    const runner = new GuiAgentRunner({ operator, model });

    const result = await runner.run('打开设置');

    expect(result.success).toBe(true);
    expect(result.steps).toBe(1);
    expect(result.history).toHaveLength(0);
    expect(result.lastScreenshot).toBe(SCREENSHOT);
  });

  it('多步后 finished：steps 与 history 正确累积', async () => {
    const operator = new FakeOperator();
    const model = new ScriptedModel([
      "Action: click(start_box='(100,100)')",
      "Action: hotkey(key='ctrl+c')",
      'Action: finished()',
    ]);
    const runner = new GuiAgentRunner({ operator, model });

    const result = await runner.run('复制内容');

    expect(result.success).toBe(true);
    expect(result.steps).toBe(3);
    expect(result.history.map((entry) => entry.action)).toEqual(['click', 'hotkey']);
    expect(result.history.every((entry) => entry.success)).toBe(true);
    expect(operator.executed.map((action) => action.name)).toEqual(['click', 'hotkey']);
  });

  it('call_user：success 为 false 且说明需用户介入', async () => {
    const operator = new FakeOperator();
    const model = new ScriptedModel(['Action: call_user()']);
    const runner = new GuiAgentRunner({ operator, model });

    const result = await runner.run('验证码无法识别');

    expect(result.success).toBe(false);
    expect(result.steps).toBe(1);
    expect(result.summary).toContain('用户');
    expect(operator.executed).toHaveLength(0);
  });

  it('达到 maxSteps：success 为 false 且 steps 为上限', async () => {
    const operator = new FakeOperator();
    const model = new ScriptedModel(["Action: click(start_box='(1,1)')"]);
    const runner = new GuiAgentRunner({ operator, model, maxSteps: 3 });

    const result = await runner.run('永不结束');

    expect(result.success).toBe(false);
    expect(result.steps).toBe(3);
    expect(result.history).toHaveLength(3);
    expect(result.summary).toContain('3');
  });

  it('并发隔离：两个实例互不干扰（去除 globalThis 单例的回归测试）', async () => {
    const operatorA = new FakeOperator();
    const operatorB = new FakeOperator();
    const modelA = new ScriptedModel(["Action: click(start_box='(1,1)')", 'Action: finished()']);
    const modelB = new ScriptedModel([
      "Action: click(start_box='(2,2)')",
      "Action: click(start_box='(3,3)')",
      "Action: click(start_box='(4,4)')",
      'Action: finished()',
    ]);
    const runnerA = new GuiAgentRunner({ operator: operatorA, model: modelA });
    const runnerB = new GuiAgentRunner({ operator: operatorB, model: modelB });

    const [resultA, resultB] = await Promise.all([runnerA.run('任务A'), runnerB.run('任务B')]);

    expect(resultA.steps).toBe(2);
    expect(resultB.steps).toBe(4);
    expect(operatorA.executed).toHaveLength(1);
    expect(operatorB.executed).toHaveLength(3);
    expect(resultA.history.map((entry) => entry.action)).toEqual(['click']);
    expect(resultB.history.map((entry) => entry.action)).toEqual(['click', 'click', 'click']);
    expect(modelA.calls[0]?.instruction).toBe('任务A');
    expect(modelB.calls[0]?.instruction).toBe('任务B');
  });

  it('取消：abort 后抛中文错误且不截图', async () => {
    const controller = new AbortController();
    controller.abort();
    const operator = new FakeOperator();
    const model = new ScriptedModel(['Action: finished()']);
    const { events, onEvent } = collectEvents();
    const runner = new GuiAgentRunner({
      operator,
      model,
      signal: controller.signal,
      onEvent,
    });

    await expect(runner.run('中断任务')).rejects.toThrow('GUI 任务已取消');
    expect(operator.screenshotCount).toBe(0);
    expect(events[events.length - 1]?.type).toBe('error');
  });

  it('事件顺序为 start → screenshot → thought → action → action-result …', async () => {
    const operator = new FakeOperator();
    const model = new ScriptedModel([
      "Action: click(start_box='(1,1)')",
      "Action: click(start_box='(2,2)')",
      'Action: finished()',
    ]);
    const { events, onEvent } = collectEvents();
    const runner = new GuiAgentRunner({ operator, model, onEvent });

    await runner.run('两步后完成');

    expect(events.map((event) => event.type)).toEqual([
      'start',
      'screenshot',
      'thought',
      'action',
      'action-result',
      'screenshot',
      'thought',
      'action',
      'action-result',
      'screenshot',
      'thought',
      'finished',
    ]);
  });

  it('截图窗口：跑 7 步时传入模型的截图数不超过 5', async () => {
    const operator = new FakeOperator();
    const model = new ScriptedModel([
      "Action: click(start_box='(1,1)')",
      "Action: click(start_box='(2,2)')",
      "Action: click(start_box='(3,3)')",
      "Action: click(start_box='(4,4)')",
      "Action: click(start_box='(5,5)')",
      "Action: click(start_box='(6,6)')",
      'Action: finished()',
    ]);
    const runner = new GuiAgentRunner({ operator, model });

    const result = await runner.run('七步任务');

    expect(result.steps).toBe(7);
    expect(model.calls).toHaveLength(7);
    expect(model.calls.map((call) => call.screenshots.length)).toEqual([1, 2, 3, 4, 5, 5, 5]);
    expect(model.calls.every((call) => call.screenshots.length <= 5)).toBe(true);
  });

  it('无动作解析结果：记为失败一步并继续循环', async () => {
    const operator = new FakeOperator();
    const model = new ScriptedModel(['模型没有输出动作', 'Action: finished()']);
    const runner = new GuiAgentRunner({ operator, model });

    const result = await runner.run('先失误再完成');

    expect(result.success).toBe(true);
    expect(result.steps).toBe(2);
    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({ step: 1, action: '', success: false });
    expect(operator.executed).toHaveLength(0);
  });

  it('max_loop 作为内部动作以失败收尾，不交给 operator', async () => {
    const operator = new FakeOperator();
    const model = new ScriptedModel(['Action: max_loop()']);
    const runner = new GuiAgentRunner({ operator, model });

    const result = await runner.run('触发上限');

    expect(result.success).toBe(false);
    expect(operator.executed).toHaveLength(0);
  });

  it('error_env 作为内部动作走异常通道', async () => {
    const operator = new FakeOperator();
    const model = new ScriptedModel(['Action: error_env()']);
    const { events, onEvent } = collectEvents();
    const runner = new GuiAgentRunner({ operator, model, onEvent });

    await expect(runner.run('环境异常')).rejects.toThrow('GUI 运行环境出现错误');
    expect(events[events.length - 1]?.type).toBe('error');
    expect(operator.executed).toHaveLength(0);
  });

  it('wait 动作交给 operator，主循环不额外 sleep', async () => {
    const operator = new FakeOperator();
    const model = new ScriptedModel(['Action: wait()', 'Action: finished()']);
    const runner = new GuiAgentRunner({ operator, model });

    const result = await runner.run('等待加载');

    expect(result.steps).toBe(2);
    expect(operator.executed.map((action) => action.name)).toEqual(['wait']);
  });

  it('模型抛错时发 error 事件并重新抛出', async () => {
    const operator = new FakeOperator();
    const model: GuiRunnerModel = {
      async predict(): Promise<string> {
        throw new Error('模型服务不可用');
      },
    };
    const { events, onEvent } = collectEvents();
    const runner = new GuiAgentRunner({ operator, model, onEvent });

    await expect(runner.run('失败任务')).rejects.toThrow('模型服务不可用');
    expect(events[events.length - 1]).toMatchObject({
      type: 'error',
      message: '模型服务不可用',
    });
  });
});

describe('parseModelOutput', () => {
  it('解析 Thought 与动作', () => {
    const output = parseModelOutput("Thought: 点开设置\nAction: click(start_box='(500,500)')");

    expect(output.thought).toBe('点开设置');
    expect(output.normalizedName).toBe('click');
    expect(output.action?.name).toBe('click');
    expect(output.action?.params).toHaveLength(1);
  });

  it('无动作时返回 null 与空归一化名', () => {
    const output = parseModelOutput('这是一段没有动作的文本');

    expect(output.action).toBeNull();
    expect(output.normalizedName).toBe('');
  });

  it('多动作时取最后一条', () => {
    const output = parseModelOutput("Action: click(start_box='(1,1)')\n\nhotkey(keys='ctrl+c')");

    expect(output.normalizedName).toBe('hotkey');
    expect(output.action?.raw).toContain('hotkey');
  });

  it('别名归一为规范动作名，raw 保留模型原始写法', () => {
    const output = parseModelOutput("Action: left_double(start_box='(1,1)')");

    expect(output.normalizedName).toBe('double_click');
    expect(output.action?.name).toBe('double_click');
    expect(output.action?.raw).toContain('left_double');
  });

  it('提供 screenSize 时附带像素坐标', () => {
    const output = parseModelOutput("Action: click(start_box='(500,500)')", {
      screenSize: { width: 1000, height: 800 },
    });

    expect(output.action?.params).toContainEqual([500, 400]);
  });
});
