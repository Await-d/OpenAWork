// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `@openAwork/shared-ui` 在 vitest 里被 alias 成轻量 mock（不含
 * `resolveToolVisualStatus`），这里补一份与真实语义一致的实现，保证卡片
 * 「status / isError / output → 视觉状态」的判定被真实覆盖。
 */
vi.mock('@openAwork/shared-ui', () => ({
  resolveToolVisualStatus: ({
    defaultStatus,
    isError,
    output,
    status,
  }: {
    defaultStatus?: 'idle' | 'running';
    isError?: boolean;
    output?: unknown;
    status?: string;
  }) => {
    if (isError === true) return 'failed';
    switch ((status ?? '').trim().toLowerCase()) {
      case 'cancelled':
        return 'cancelled';
      case 'completed':
      case 'done':
        return 'completed';
      case 'failed':
        return 'failed';
      case 'paused':
        return 'paused';
      case 'pending':
        return 'pending';
      case 'running':
      case 'in_progress':
        return 'running';
      default:
        return output !== undefined ? 'completed' : (defaultStatus ?? 'running');
    }
  },
}));

vi.mock('../display/tool-icon.js', () => ({
  ToolIcon: () => <span data-testid="tool-icon" />,
}));

vi.mock('../io/ToolCallImagePreview.js', () => ({
  ToolCallImagePreview: ({
    source,
  }: {
    source: { kind: string; artifactId?: string; alt: string } | null;
  }) =>
    source ? (
      <div
        data-testid="image-preview"
        data-kind={source.kind}
        data-artifact-id={source.artifactId ?? ''}
        data-alt={source.alt}
      />
    ) : null,
}));

import { useDisplayPreferencesStore } from '../../../../stores/settings/display-preferences.js';
import {
  buildComputerUseSteps,
  ComputerUseToolCard,
  parseComputerUseOutput,
  readComputerUseProgress,
  resolveComputerUseVisualState,
} from './computer-use-tool-card.js';

const READY_ATTACHMENT = {
  type: 'input_image' as const,
  artifactId: 'artifact-gui-1',
  fileName: 'computer-use-final.png',
  mimeType: 'image/png',
};

function getStepRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-cu-step]')];
}

function expandCard(): void {
  fireEvent.click(screen.getByRole('button', { expanded: false }));
}

beforeEach(() => {
  useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });
});

afterEach(() => {
  cleanup();
  useDisplayPreferencesStore.setState({ toolCallsExpandedByDefault: false });
});

describe('ComputerUseToolCard — running 态', () => {
  const runningInput = {
    instruction: '打开系统设置',
    _batchProgress: {
      subTools: [
        { index: 0, tool: 'click', status: 'completed' },
        { index: 1, tool: 'type', status: 'running', thought: '在搜索框输入设置' },
      ],
      completedCount: 1,
      totalCount: 4,
    },
  };

  it('默认折叠，展开后渲染实时步骤、当前步高亮与 completedCount/totalCount', () => {
    render(<ComputerUseToolCard input={runningInput} status="running" />);

    expect(screen.getByRole('button', { expanded: false })).toBeTruthy();
    expect(screen.queryByLabelText('GUI 操作步骤')).toBeNull();

    expandCard();

    expect(screen.getByLabelText('GUI 操作步骤')).toBeTruthy();
    expect(screen.getByText('1/4')).toBeTruthy();
    expect(screen.getByText('执行中…')).toBeTruthy();

    const rows = getStepRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('data-cu-step-state')).toBe('completed');
    expect(rows[1]?.getAttribute('data-cu-step-state')).toBe('running');
    // 只有尚未落定的那一步带 aria-current（当前步高亮 + 无障碍语义同源）。
    expect(rows[1]?.getAttribute('aria-current')).toBe('step');
    expect(rows[0]?.getAttribute('aria-current')).toBeNull();
    expect(screen.getByText('在搜索框输入设置')).toBeTruthy();
  });

  it('无实时进度时即使仍在运行也回退 output.history（展示已完成步骤）', () => {
    render(
      <ComputerUseToolCard
        input={{ instruction: '打开系统设置' }}
        output={JSON.stringify({
          success: true,
          steps: 1,
          summary: '阶段结果',
          history: [{ step: 1, thought: '旧步骤', action: 'click', success: true }],
        })}
        status="running"
      />,
    );

    expandCard();

    expect(screen.getByText('旧步骤')).toBeTruthy();
    // 运行中不做「当前步」高亮：这条历史步骤已经落定。
    expect(getStepRows()[0]?.getAttribute('aria-current')).toBeNull();
    expect(screen.getByText('任务结束后显示最终截图')).toBeTruthy();
    expect(screen.queryByTestId('image-preview')).toBeNull();
  });

  it('运行中完全没有步骤时给出等待占位', () => {
    render(<ComputerUseToolCard input={{ instruction: '打开系统设置' }} status="running" />);

    expandCard();

    expect(screen.getByText('准备中…')).toBeTruthy();
    expect(screen.getByText('正在执行，等待第一步动作…')).toBeTruthy();
    expect(screen.getByText('任务结束后显示最终截图')).toBeTruthy();
  });

  it('运行中只高亮最后一个未落定的步骤', () => {
    render(
      <ComputerUseToolCard
        input={{
          _batchProgress: {
            subTools: [
              { tool: 'click', status: 'completed' },
              { tool: 'type', status: 'pending' },
              { tool: 'scroll', status: 'running' },
            ],
            completedCount: 1,
            totalCount: 3,
          },
        }}
        status="running"
      />,
    );

    expandCard();

    const rows = getStepRows();
    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual([null, null, 'step']);
  });
});

describe('ComputerUseToolCard — 成功态', () => {
  const successOutput = JSON.stringify({
    success: true,
    steps: 2,
    summary: '已完成：打开了系统设置',
    history: [
      { step: 1, thought: '点击开始菜单', action: 'click', success: true },
      { step: 2, thought: '在搜索框输入“设置”', action: 'type', success: false },
    ],
  });

  it('渲染 summary 与 output.history 步骤，并区分单步成败', () => {
    render(
      <ComputerUseToolCard
        input={{ instruction: '打开系统设置' }}
        output={successOutput}
        status="completed"
      />,
    );

    expandCard();

    expect(screen.getByText('已完成：打开了系统设置')).toBeTruthy();
    expect(screen.getByText('共 2 步')).toBeTruthy();

    const rows = getStepRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('data-cu-step-state')).toBe('completed');
    expect(rows[1]?.getAttribute('data-cu-step-state')).toBe('failed');
    expect(screen.getByText('在搜索框输入“设置”')).toBeTruthy();
    // 结束后不再高亮任何步骤。
    expect(rows[0]?.getAttribute('aria-current')).toBeNull();
    expect(rows[1]?.getAttribute('aria-current')).toBeNull();
  });

  it('attachments 里的最终截图渲染为图片预览', () => {
    render(
      <ComputerUseToolCard
        attachments={[READY_ATTACHMENT]}
        input={{ instruction: '打开系统设置' }}
        output={successOutput}
        status="completed"
      />,
    );

    expandCard();

    const preview = screen.getByTestId('image-preview');
    expect(preview.getAttribute('data-kind')).toBe('artifact');
    expect(preview.getAttribute('data-artifact-id')).toBe('artifact-gui-1');
    expect(preview.getAttribute('data-alt')).toBe('GUI 操作截图');
  });

  it('没有 attachments 时截图区给占位而不是空白', () => {
    render(
      <ComputerUseToolCard
        input={{ instruction: '打开系统设置' }}
        output={successOutput}
        status="completed"
      />,
    );

    expandCard();

    expect(screen.queryByTestId('image-preview')).toBeNull();
    expect(screen.getByText('本次任务未返回截图')).toBeTruthy();
  });

  it('网关给出重复步号时仍按位置渲染（不会撞 key / 不会多处高亮）', () => {
    render(
      <ComputerUseToolCard
        input={{}}
        output={JSON.stringify({
          success: true,
          steps: 2,
          summary: '重复步号',
          history: [
            { step: 1, action: 'click', thought: '第一步', success: true },
            { step: 1, action: 'click', thought: '同号第二步', success: true },
          ],
        })}
        status="completed"
      />,
    );

    expandCard();

    const rows = getStepRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.getAttribute('data-cu-step'))).toEqual(['1', '1']);
    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual([null, null]);
  });
});

describe('ComputerUseToolCard — 失败态', () => {
  const failedOutput = JSON.stringify({
    success: false,
    steps: 0,
    summary: '系统桌面控制不可用：桌面端桥未启用或当前不在桌面端运行。',
    history: [],
  });

  it('success=false（isError=false）也判定为失败，并用珊瑚色横幅给出原因', () => {
    const { container } = render(
      <ComputerUseToolCard
        input={{ instruction: '打开系统设置' }}
        output={failedOutput}
        status="completed"
      />,
    );

    expect(container.querySelector('[data-tool-status="failed"]')).not.toBeNull();
    // 头部折叠态即可看到失败原因（Title/aria 之外的可读文本）。
    expect(
      screen.getByTitle('系统桌面控制不可用：桌面端桥未启用或当前不在桌面端运行。'),
    ).toBeTruthy();

    expandCard();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('失败原因');
    expect(alert.textContent).toContain('系统桌面控制不可用');
    expect(screen.getByText('本次任务未执行任何步骤')).toBeTruthy();
  });

  it('抛异常（isError=true）时回退通用错误摘要', () => {
    render(
      <ComputerUseToolCard
        input={{}}
        output={'Error: 桌面桥连接超时\n    at bridge.ts:1:1'}
        isError
        status="failed"
      />,
    );

    expect(screen.getByTitle('Error: 桌面桥连接超时')).toBeTruthy();
  });
});

describe('ComputerUseToolCard — 空态', () => {
  it('成功但没有任何步骤时渲染占位文案', () => {
    render(
      <ComputerUseToolCard
        input={{}}
        output={JSON.stringify({
          success: true,
          steps: 0,
          summary: '没有可执行的动作',
          history: [],
        })}
        status="completed"
      />,
    );

    expandCard();

    expect(screen.getByText('没有可执行的动作')).toBeTruthy();
    expect(screen.getByText('本次任务没有记录到执行步骤')).toBeTruthy();
    expect(getStepRows()).toHaveLength(0);
  });
});

describe('computer_use 纯函数', () => {
  it('parseComputerUseOutput：兼容 JSON 字符串与已解析对象，非法输入返回 null', () => {
    expect(parseComputerUseOutput('纯文本失败原因')).toBeNull();
    expect(parseComputerUseOutput('')).toBeNull();
    expect(parseComputerUseOutput(undefined)).toBeNull();
    expect(parseComputerUseOutput([1, 2])).toBeNull();

    const parsed = parseComputerUseOutput({
      success: true,
      steps: 3,
      summary: '完成',
      history: [
        { step: 5, thought: '第五步', action: 'scroll', success: true },
        { thought: '缺 step 用下标兜底', action: 'click', success: false },
        'not-a-record',
      ],
    });

    expect(parsed?.steps).toBe(3);
    expect(parsed?.history).toHaveLength(2);
    expect(parsed?.history[0]?.index).toBe(5);
    expect(parsed?.history[1]?.index).toBe(2);
    expect(parsed?.history[1]?.state).toBe('failed');
  });

  it('readComputerUseProgress：读取实时快照，下标转 1-based，缺失时返回 null', () => {
    expect(readComputerUseProgress({})).toBeNull();
    expect(readComputerUseProgress({ _batchProgress: { subTools: 'bad' } })).toBeNull();

    const progress = readComputerUseProgress({
      _batchProgress: {
        subTools: [
          { index: 0, tool: 'click', status: 'completed', isError: false },
          { tool: 'type', status: 'running' },
          { tool: 'scroll', status: 'error', isError: true },
        ],
        completedCount: 1,
        totalCount: 3,
      },
    });

    expect(progress?.steps.map((step) => step.index)).toEqual([1, 2, 3]);
    expect(progress?.steps.map((step) => step.state)).toEqual(['completed', 'running', 'failed']);
    expect(progress?.totalCount).toBe(3);
  });

  it('buildComputerUseSteps：运行中优先实时进度，无实时进度时回退 output.history', () => {
    const history = [
      { index: 1, action: 'click', thought: '点击开始菜单', state: 'completed' as const },
    ];
    const progress = {
      steps: [{ index: 1, action: 'click', thought: '', state: 'running' as const }],
      completedCount: 0,
      totalCount: 2,
    };

    expect(buildComputerUseSteps(history, progress, true)).toEqual(progress.steps);
    expect(buildComputerUseSteps(history, null, true)).toEqual(history);
    expect(buildComputerUseSteps(history, progress, false)).toEqual(history);
    expect(buildComputerUseSteps([], null, false)).toEqual([]);
  });

  it('resolveComputerUseVisualState：success=false 一律判失败', () => {
    expect(
      resolveComputerUseVisualState({
        output: JSON.stringify({ success: false, summary: '不可用' }),
        status: 'completed',
      }),
    ).toBe('failed');
    expect(
      resolveComputerUseVisualState({
        output: JSON.stringify({ success: true, summary: '完成' }),
        status: 'completed',
      }),
    ).toBe('completed');
    expect(resolveComputerUseVisualState({ status: 'running' })).toBe('running');
  });
});
