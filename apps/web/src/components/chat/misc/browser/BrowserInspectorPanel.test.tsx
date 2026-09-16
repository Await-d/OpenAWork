// @vitest-environment jsdom
/**
 * 元素检查器面板的渲染与交互覆盖：两个视图、树的展开 / 键盘、详情、
 * 裁剪与 loading / empty / error / unavailable 状态，以及计算样式的筛选。
 *
 * 信封全部由 props 注入（与 `NetworkWaterfall` 的 `entries` 同一验收形状），
 * 不建立任何连接。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type {
  BrowserLiveA11yNode,
  BrowserLiveA11yPayload,
  BrowserLiveDomNode,
  BrowserLiveDomPayload,
  BrowserLiveNodePayload,
} from '@openAwork/shared';
import { BrowserInspectorPanel } from './BrowserInspectorPanel.js';
import type { BrowserInspectorPanelProps } from './BrowserInspectorPanel.js';

// ── 固件 ───────────────────────────────────────────────────────────────

function domNode(
  nodeId: number,
  nodeName: string,
  attributes: Record<string, string> = {},
  children?: BrowserLiveDomNode[],
): BrowserLiveDomNode {
  return {
    nodeId,
    backendNodeId: nodeId * 10,
    nodeName,
    attributes,
    childCount: children?.length ?? 0,
    ...(children !== undefined ? { children } : {}),
  };
}

function makeDomPayload(truncated = false): BrowserLiveDomPayload {
  const root = domNode(1, '#document', {}, [
    domNode(2, 'HTML', {}, [
      domNode(3, 'HEAD', {}, [domNode(4, 'TITLE', {})]),
      domNode(
        5,
        'BODY',
        {},
        [
          domNode(6, 'DIV', { id: 'app', class: 'shell grid' }, [
            domNode(7, 'BUTTON', {
              id: 'submit',
              class: 'primary',
              'data-testid': 'submit-order',
            }),
            domNode(8, 'UL', { class: 'list' }, [
              domNode(9, 'LI', { class: 'item' }),
              domNode(10, 'LI', { class: 'item' }),
            ]),
          ]),
        ],
      ),
    ]),
  ]);
  return { root, truncated };
}

function a11yNode(partial: Partial<BrowserLiveA11yNode> = {}): BrowserLiveA11yNode {
  return { role: 'generic', name: '', ignored: false, ...partial };
}

function makeA11yPayload(): BrowserLiveA11yPayload {
  return {
    nodeCount: 6,
    root: a11yNode({
      role: 'RootWebArea',
      name: '结算页',
      children: [
        a11yNode({ role: 'heading', name: '订单确认', level: 1 }),
        a11yNode({
          role: 'form',
          name: '提交订单',
          children: [
            a11yNode({ role: 'button', name: '提交订单', focused: true, disabled: false }),
            a11yNode({ role: 'checkbox', name: '同意条款', checked: 'mixed', selected: false }),
            a11yNode({ role: 'textbox', name: '备注', value: '尽快发货', ignored: true }),
          ],
        }),
      ],
    }),
  };
}

const NODE_PAYLOAD: BrowserLiveNodePayload = {
  selector: 'button#submit.primary',
  selectorStrategy: 'id',
  selectorUnique: true,
  nodeName: 'BUTTON',
  attributes: { id: 'submit', class: 'primary', 'data-testid': 'submit-order' },
  text: '提交订单',
  computedStyles: {
    display: 'flex',
    'margin-top': '0px',
    color: 'rgb(20, 20, 20)',
    'font-size': '14px',
  },
  fullComputedStyles: {
    display: 'flex',
    position: 'static',
    'margin-top': '0px',
    color: 'rgb(20, 20, 20)',
    'font-size': '14px',
    'z-index': 'auto',
  },
};

function renderInspector(overrides: Partial<BrowserInspectorPanelProps> = {}) {
  const spies = {
    onRequestDom: vi.fn(),
    onRequestA11y: vi.fn(),
    onRequestFullStyles: vi.fn(),
    onArmPick: vi.fn(),
    onDisarmPick: vi.fn(),
  };
  const props: BrowserInspectorPanelProps = {
    dom: null,
    a11y: null,
    node: null,
    ...spies,
    ...overrides,
  };
  const view = render(<BrowserInspectorPanel {...props} />);
  return { view, spies };
}

function domRows(): HTMLElement[] {
  return screen.queryAllByTestId('inspector-dom-row');
}

function rowById(id: number): HTMLElement {
  const row = screen
    .getAllByTestId('inspector-dom-row')
    .find((element) => element.getAttribute('data-row-id') === String(id));
  if (row === undefined) throw new Error(`缺少 DOM 行 ${id}`);
  return row;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── DOM 视图 ───────────────────────────────────────────────────────────

describe('BrowserInspectorPanel DOM 视图', () => {
  it('默认全展开渲染整棵树，并给出深度与节点数', () => {
    renderInspector({ dom: makeDomPayload() });

    expect(domRows().length).toBe(10);
    expect(screen.getByTestId('inspector-depth').textContent).toBe('深度 4/12');
    expect(screen.getByTestId('inspector-summary').textContent).toBe('10 个节点');
    expect(rowById(1).textContent).toContain('#document');
    expect(rowById(7).textContent).toContain('button#submit.primary');

    // 默认落到第一个真实元素（不是 #document），避免详情一片空白。
    expect(screen.getByTestId('inspector-node-tag').textContent).toBe('<html>');
  });

  it('点击箭头折叠子树，aria-expanded / aria-level 与层级一致', () => {
    renderInspector({ dom: makeDomPayload() });

    const row = rowById(6);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(row.getAttribute('aria-level')).toBe('4');

    fireEvent.click(within(row).getByTestId('inspector-dom-toggle'));

    expect(domRows().map((element) => element.getAttribute('data-row-id'))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    expect(rowById(6).getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(within(rowById(6)).getByTestId('inspector-dom-toggle'));
    expect(domRows().length).toBe(10);
  });

  it('键盘：↓ 移动、Home/End 首尾、← 回到父节点或折叠、→ 展开、Enter 选中', () => {
    renderInspector({ dom: makeDomPayload() });

    rowById(1).focus();
    fireEvent.keyDown(rowById(1), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rowById(2));

    fireEvent.keyDown(rowById(2), { key: 'Enter' });
    expect(rowById(2).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('inspector-node-tag').textContent).toBe('<html>');

    fireEvent.keyDown(rowById(2), { key: 'End' });
    expect(document.activeElement).toBe(rowById(10));
    fireEvent.keyDown(rowById(10), { key: 'Home' });
    expect(document.activeElement).toBe(rowById(1));

    // 叶子节点上按 ← 回到父节点（li → ul）。
    rowById(9).focus();
    fireEvent.keyDown(rowById(9), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(rowById(8));

    // 展开的节点上按 ← 折叠自身，再按 → 展开回来。
    fireEvent.keyDown(rowById(8), { key: 'ArrowLeft' });
    expect(rowById(8).getAttribute('aria-expanded')).toBe('false');
    expect(domRows().length).toBe(8);
    fireEvent.keyDown(rowById(8), { key: 'ArrowRight' });
    expect(rowById(8).getAttribute('aria-expanded')).toBe('true');
    expect(domRows().length).toBe(10);

    // 折叠的节点上按 → 直接展开。
    fireEvent.keyDown(rowById(6), { key: 'ArrowLeft' });
    expect(domRows().length).toBe(6);
    fireEvent.keyDown(rowById(6), { key: 'ArrowRight' });
    expect(domRows().length).toBe(10);
  });

  it('选中树节点后详情展示标签与全部属性', () => {
    renderInspector({ dom: makeDomPayload() });

    fireEvent.click(rowById(7));

    expect(rowById(7).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('inspector-node-tag').textContent).toBe('<button>');
    const attributes = screen.getAllByTestId('inspector-attribute-row');
    expect(attributes.map((row) => row.textContent)).toEqual([
      'idsubmit',
      'classprimary',
      'data-testidsubmit-order',
    ]);
  });

  it('truncated 时显式提示裁剪，并可直接「更深」', () => {
    const { spies } = renderInspector({ dom: makeDomPayload(true) });

    const strip = screen.getByTestId('inspector-truncated');
    expect(strip.textContent).toContain('树已被裁剪');
    expect(strip.textContent).toContain('深度 4');

    fireEvent.click(screen.getByTestId('inspector-truncated-deeper'));
    expect(spies.onRequestDom).toHaveBeenCalledWith(8);
  });

  it('刷新按当前深度重取，「更深」按 4 档递增到上限后禁用', () => {
    const { spies } = renderInspector({ dom: makeDomPayload() });

    fireEvent.click(screen.getByTestId('inspector-dom-refresh'));
    expect(spies.onRequestDom).toHaveBeenLastCalledWith(4);

    fireEvent.click(screen.getByTestId('inspector-dom-deeper'));
    expect(spies.onRequestDom).toHaveBeenLastCalledWith(8);
    expect(screen.getByTestId('inspector-depth').textContent).toBe('深度 8/12');

    fireEvent.click(screen.getByTestId('inspector-dom-deeper'));
    expect(spies.onRequestDom).toHaveBeenLastCalledWith(12);
    expect(screen.getByTestId('inspector-depth').textContent).toBe('深度 12/12');

    const deeper = screen.getByTestId('inspector-dom-deeper') as HTMLButtonElement;
    expect(deeper.disabled).toBe(true);
    expect(deeper.title).toContain('已到后端深度上限');
  });

  it('已取到数据时不重复自动请求；首次进入才自动取一次', () => {
    const withData = renderInspector({ dom: makeDomPayload() });
    expect(withData.spies.onRequestDom).not.toHaveBeenCalled();
    cleanup();

    const withoutData = renderInspector();
    expect(withoutData.spies.onRequestDom).toHaveBeenCalledTimes(1);
    expect(withoutData.spies.onRequestDom).toHaveBeenCalledWith(4);
  });
});

// ── 状态 ───────────────────────────────────────────────────────────────

describe('BrowserInspectorPanel 状态', () => {
  it('请求在途时展示骨架屏', () => {
    renderInspector({ domStatus: 'loading' });

    expect(screen.getByTestId('inspector-dom-loading').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByTestId('inspector-dom-tree')).toBeNull();
  });

  it('从未请求时给出空态与请求入口', () => {
    const { spies } = renderInspector({ domStatus: 'idle' });

    const empty = screen.getByTestId('inspector-dom-empty');
    expect(empty.textContent).toContain('尚未获取 DOM 树');

    fireEvent.click(screen.getByRole('button', { name: '获取 DOM 树' }));
    expect(spies.onRequestDom).toHaveBeenCalledWith(4);
  });

  it('请求失败时给出错误态与重试', () => {
    const { spies } = renderInspector({ domStatus: 'error' });

    const notice = screen.getByTestId('inspector-dom-error');
    expect(notice.textContent).toContain('读取 DOM 树失败');
    fireEvent.click(within(notice).getByRole('button', { name: '重试' }));
    expect(spies.onRequestDom).toHaveBeenCalledWith(4);
  });

  it('协议错误以提示条呈现，且不覆盖已有数据', () => {
    renderInspector({
      dom: makeDomPayload(),
      errorMessage: 'DOM_TREE_FAILED：获取页面 DOM 树失败。',
    });

    expect(screen.getByTestId('inspector-error').textContent).toContain('DOM_TREE_FAILED');
    expect(domRows().length).toBe(10);
  });

  it('实时引擎不可用时给出占位而不是空态，并且不自动请求', () => {
    const { spies } = renderInspector({
      unavailable: true,
      unavailableHint: '未检测到可用的调试浏览器。',
    });

    expect(screen.getByTestId('inspector-unavailable-notice').textContent).toContain(
      '未检测到可用的调试浏览器。',
    );
    expect(screen.queryByTestId('inspector-dom-empty')).toBeNull();
    expect(spies.onRequestDom).not.toHaveBeenCalled();
  });

  it('引擎不可用但已有数据时保留数据并明确标注来源', () => {
    renderInspector({ dom: makeDomPayload(), unavailable: true });

    expect(screen.getByTestId('inspector-unavailable').textContent).toContain('最后一次');
    expect(domRows().length).toBe(10);
  });
});

// ── 无障碍视图 ─────────────────────────────────────────────────────────

describe('BrowserInspectorPanel 无障碍视图', () => {
  it('切换视图后渲染无障碍树，选中节点的状态渲染成芯片', () => {
    const { spies } = renderInspector({ a11y: makeA11yPayload() });

    fireEvent.click(screen.getByTestId('inspector-view-a11y'));
    expect(spies.onRequestA11y).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('inspector-a11y-row').length).toBe(6);
    expect(screen.getByTestId('inspector-summary').textContent).toBe('6 个节点');

    const checkbox = screen
      .getAllByTestId('inspector-a11y-row')
      .find((row) => row.getAttribute('data-row-id') === '0.1.1');
    if (checkbox === undefined) throw new Error('缺少 checkbox 行');
    fireEvent.click(checkbox);

    const detail = screen.getByTestId('inspector-a11y-detail');
    expect(detail.textContent).toContain('checkbox');
    expect(within(detail).getByTestId('inspector-a11y-chip-mixed').textContent).toBe('部分勾选');
    expect(within(detail).getByTestId('inspector-a11y-chip-unselected').textContent).toBe(
      '未选中',
    );

    const ignoredRow = screen
      .getAllByTestId('inspector-a11y-row')
      .find((row) => row.getAttribute('data-row-id') === '0.1.2');
    if (ignoredRow === undefined) throw new Error('缺少 ignored 行');
    expect(ignoredRow.getAttribute('data-depth')).toBe('2');
    expect(ignoredRow.textContent).toContain('ignored');
  });

  it('无障碍树为空时给出空态而不是空白', () => {
    const { spies } = renderInspector({ a11y: { root: null, nodeCount: 0 } });

    fireEvent.click(screen.getByTestId('inspector-view-a11y'));
    expect(screen.getByTestId('inspector-a11y-empty').textContent).toContain(
      '页面未提供无障碍树',
    );

    fireEvent.click(screen.getByRole('button', { name: '重新获取' }));
    expect(spies.onRequestA11y).toHaveBeenCalled();
  });
});

// ── 计算样式与拾取 ─────────────────────────────────────────────────────

describe('BrowserInspectorPanel 样式与拾取', () => {
  it('样式表默认只给「值得看」的声明，可显示全部与关键字筛选', () => {
    renderInspector({ dom: makeDomPayload(), node: NODE_PAYLOAD });

    const summary = screen.getByTestId('inspector-styles-summary').textContent ?? '';
    expect(summary).toContain('共 6 条');
    expect(summary).toContain('默认视图 3 条');
    expect(screen.getAllByTestId('inspector-style-row').length).toBe(3);

    fireEvent.click(screen.getByTestId('inspector-styles-show-all'));
    expect(screen.getAllByTestId('inspector-style-row').length).toBe(6);

    fireEvent.change(screen.getByLabelText('筛选计算样式'), { target: { value: 'z-index' } });
    expect(screen.getAllByTestId('inspector-style-row').length).toBe(1);
    expect(screen.getByTestId('inspector-styles-summary').textContent).toContain('匹配 1 / 6');

    fireEvent.change(screen.getByLabelText('筛选计算样式'), { target: { value: '没有这条' } });
    expect(screen.getByTestId('inspector-styles-no-match').textContent).toContain('没有匹配');
  });

  it('拾取回包到达后切回 DOM 视图、选中匹配节点并展示完整样式', () => {
    const { view } = renderInspector({ a11y: makeA11yPayload(), initialView: 'a11y' });
    expect(screen.queryByTestId('inspector-dom-tree')).toBeNull();

    view.rerender(
      <BrowserInspectorPanel
        dom={makeDomPayload()}
        a11y={makeA11yPayload()}
        node={NODE_PAYLOAD}
        onRequestDom={vi.fn()}
        onRequestA11y={vi.fn()}
        onRequestFullStyles={vi.fn()}
        onArmPick={vi.fn()}
        initialView="a11y"
      />,
    );

    expect(screen.getByTestId('inspector-dom-tree')).toBeTruthy();
    expect(rowById(7).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('inspector-selector').textContent).toBe('button#submit.primary');
    expect(screen.getByTestId('inspector-styles-source').textContent).toBe('完整样式');
    expect(screen.getByTestId('inspector-node-text').textContent).toBe('提交订单');
  });

  it('没有拾取坐标时「获取完整样式」禁用并说明原因，有坐标后下发', () => {
    const { view, spies } = renderInspector({ dom: makeDomPayload() });

    const button = screen.getByTestId('inspector-full-styles') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('先在页面中拾取元素');
    expect(screen.getByTestId('inspector-styles-empty').textContent).toContain('还没有该元素的样式');

    view.rerender(
      <BrowserInspectorPanel
        dom={makeDomPayload()}
        a11y={null}
        node={NODE_PAYLOAD}
        onRequestDom={spies.onRequestDom}
        onRequestA11y={spies.onRequestA11y}
        onRequestFullStyles={spies.onRequestFullStyles}
        onArmPick={spies.onArmPick}
      />,
    );

    const enabled = screen.getByTestId('inspector-full-styles') as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    fireEvent.click(enabled);
    expect(spies.onRequestFullStyles).toHaveBeenCalledTimes(1);
  });

  it('「在页面中拾取」武装 / 解除武装，并透传拾取状态', () => {
    const { spies } = renderInspector({ dom: makeDomPayload(), pickArmed: false });

    const pill = screen.getByTestId('inspector-arm-pick');
    expect(pill.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pill);
    expect(spies.onArmPick).toHaveBeenCalledTimes(1);
    expect(spies.onDisarmPick).not.toHaveBeenCalled();
    cleanup();

    const armed = renderInspector({ dom: makeDomPayload(), pickArmed: true });
    const armedPill = screen.getByTestId('inspector-arm-pick');
    expect(armedPill.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(armedPill);
    expect(armed.spies.onDisarmPick).toHaveBeenCalledTimes(1);
  });

  it('详情为空态时提示先选节点', () => {
    renderInspector({ dom: null });

    expect(screen.getByTestId('inspector-detail-empty').textContent).toContain('未选择节点');
  });
});
