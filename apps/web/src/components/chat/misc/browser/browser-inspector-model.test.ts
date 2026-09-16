/**
 * 元素检查器纯逻辑的单测：树展开 / 压平、拾取定位、样式筛选、状态芯片、
 * 线路数据收窄。全部不依赖 React。
 */

import { describe, expect, it } from 'vitest';
import type { BrowserLiveA11yNode, BrowserLiveDomNode } from '@openAwork/shared';
import {
  INSPECTOR_MAX_DEPTH,
  a11yNodePathId,
  buildA11yNodeLabelParts,
  buildDomNodeLabelParts,
  buildInspectorNodeDetail,
  buildInspectorStyleView,
  clampInspectorDepth,
  countDomTreeNodes,
  defaultExpandedA11yIds,
  defaultExpandedDomIds,
  describeA11yStateChips,
  expandIds,
  findA11yNode,
  findDomNode,
  findDomNodePath,
  firstElementNodeId,
  flattenA11yTree,
  flattenDomTree,
  isDefaultStyleDeclaration,
  isMaxInspectorDepth,
  isNotableStyle,
  matchDomNodeForNodePayload,
  nextInspectorDepth,
  toA11yPayload,
  toDomPayload,
  toInspectorInline,
  toNodePayload,
  toggleExpandedId,
} from './browser-inspector-model.js';

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

/**
 * #document → html → head / body → div#app.shell → button#submit + ul → li ×2
 */
function makeDomRoot(): BrowserLiveDomNode {
  return domNode(1, '#document', {}, [
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
}

function a11yNode(partial: Partial<BrowserLiveA11yNode> = {}): BrowserLiveA11yNode {
  return { role: 'generic', name: '', ignored: false, ...partial };
}

function makeA11yRoot(): BrowserLiveA11yNode {
  return a11yNode({
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
  });
}

// ── 深度 ───────────────────────────────────────────────────────────────

describe('检查器深度', () => {
  it('收敛到 [1, 12]，非法输入回落默认深度 4', () => {
    expect(clampInspectorDepth(undefined)).toBe(4);
    expect(clampInspectorDepth(Number.NaN)).toBe(4);
    expect(clampInspectorDepth(0)).toBe(1);
    expect(clampInspectorDepth(-3)).toBe(1);
    expect(clampInspectorDepth(7.6)).toBe(8);
    expect(clampInspectorDepth(99)).toBe(INSPECTOR_MAX_DEPTH);
  });

  it('「更深」按 4 档递增并在上限处封顶', () => {
    expect(nextInspectorDepth(4)).toBe(8);
    expect(nextInspectorDepth(8)).toBe(12);
    expect(nextInspectorDepth(12)).toBe(12);
    expect(isMaxInspectorDepth(12)).toBe(true);
    expect(isMaxInspectorDepth(8)).toBe(false);
    expect(isMaxInspectorDepth(undefined)).toBe(false);
  });
});

// ── DOM 树 ─────────────────────────────────────────────────────────────

describe('DOM 树展开与压平', () => {
  it('默认展开集合包含所有带子节点的节点', () => {
    const expanded = defaultExpandedDomIds(makeDomRoot());
    expect([...expanded].sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 6, 8]);
  });

  it('默认全展开时压平出全部 10 个节点，层级按深度递增', () => {
    const rows = flattenDomTree(makeDomRoot(), defaultExpandedDomIds(makeDomRoot()));
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rows.find((row) => row.id === 7)?.depth).toBe(4);
    expect(rows.find((row) => row.id === 5)?.depth).toBe(2);
    expect(rows.find((row) => row.id === 1)?.depth).toBe(0);
  });

  it('折叠一个节点只隐藏它的子树，祖先链保持不变', () => {
    const root = makeDomRoot();
    let expanded = defaultExpandedDomIds(root);
    expanded = toggleExpandedId(expanded, 6);
    const rows = flattenDomTree(root, expanded);

    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.find((row) => row.id === 6)?.hasChildren).toBe(true);
    expect(rows.find((row) => row.id === 6)?.expanded).toBe(false);

    expanded = toggleExpandedId(expanded, 6);
    expect(flattenDomTree(root, expanded).length).toBe(10);
  });

  it('展开集合是纯函数式更新，入参不被修改', () => {
    const before = new Set<number>([1]);
    const after = toggleExpandedId(before, 2);
    expect([...before]).toEqual([1]);
    expect([...after].sort((a, b) => a - b)).toEqual([1, 2]);

    const merged = expandIds(new Set<number>([1]), [2, 3]);
    expect([...merged].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('空树 / null 输入返回空结果', () => {
    expect(flattenDomTree(null, new Set())).toEqual([]);
    expect(countDomTreeNodes(null)).toBe(0);
    expect(firstElementNodeId(null)).toBeNull();
    expect(findDomNode(null, 1)).toBeNull();
  });

  it('按 id 找节点并给出祖先链（不含自身）', () => {
    const root = makeDomRoot();
    expect(findDomNode(root, 7)?.nodeName).toBe('BUTTON');
    expect(findDomNodePath(root, 7).map((node) => node.nodeId)).toEqual([1, 2, 5, 6, 7]);
    expect(findDomNode(root, 999)).toBeNull();
  });

  it('默认选中第一个真实元素：跳过 #document，回落到 html', () => {
    expect(firstElementNodeId(makeDomRoot())).toBe(2);
    expect(firstElementNodeId(domNode(1, '#text'))).toBe(1);
  });

  it('节点总数含根节点', () => {
    expect(countDomTreeNodes(makeDomRoot())).toBe(10);
  });

  it('子节点数大于已下发数量时，标签里明确给出省略数量', () => {
    const node = { ...domNode(6, 'DIV', { id: 'app' }), childCount: 12 };
    const text = buildDomNodeLabelParts(node)
      .map((part) => part.text)
      .join('');
    expect(text).toBe('<div#app>…+12');
    expect(flattenDomTree(node, new Set()).length).toBe(1);
  });
});

describe('DOM 标签片段', () => {
  it('拼出 tag / id / class / 闭合符，class 超过 3 个时折叠', () => {
    const parts = buildDomNodeLabelParts(
      domNode(1, 'DIV', { id: 'app', class: 'a b c d e' }, [domNode(2, 'SPAN')]),
    );
    expect(parts.map((part) => part.text).join('')).toBe('<div#app.a.b.c.+2>');
    expect(parts[0]?.tone).toBe('tag');
    expect(parts.some((part) => part.tone === 'attr')).toBe(true);
  });

  it('单行化：换行与连续空白压成一个空格并截断', () => {
    expect(toInspectorInline('  a\n\n b  ', 40)).toBe('a b');
    expect(toInspectorInline('abcdefghij', 5)).toBe('abcd…');
  });

  it('无障碍标签给出 role / 名称 / 值 / 标题层级', () => {
    const parts = buildA11yNodeLabelParts(
      a11yNode({ role: 'textbox', name: '备注', value: '尽快发货', level: 2 }),
    );
    expect(parts.map((part) => part.text).join('')).toBe('textbox “备注” = 尽快发货 h2');
  });
});

// ── 拾取定位 ───────────────────────────────────────────────────────────

describe('matchDomNodeForNodePayload', () => {
  it('按标签名 + 属性反查节点，并给出祖先链', () => {
    const match = matchDomNodeForNodePayload(makeDomRoot(), {
      nodeName: 'BUTTON',
      attributes: { id: 'submit', class: 'primary', 'data-testid': 'submit-order' },
    });
    expect(match?.node.nodeId).toBe(7);
    expect(match?.ancestorIds).toEqual([1, 2, 5, 6]);
  });

  it('标签名大小写不敏感（树里是大写、回包可能是小写）', () => {
    const match = matchDomNodeForNodePayload(makeDomRoot(), {
      nodeName: 'button',
      attributes: { id: 'submit' },
    });
    expect(match?.node.nodeId).toBe(7);
  });

  it('命中多个候选时取最深的一个（拾取命中的是点上的元素）', () => {
    const root = domNode(1, '#document', {}, [
      domNode(2, 'DIV', { class: 'card' }, [domNode(3, 'DIV', { class: 'card' })]),
    ]);
    const match = matchDomNodeForNodePayload(root, { nodeName: 'DIV', attributes: { class: 'card' } });
    expect(match?.node.nodeId).toBe(3);
  });

  it('无属性且存在多个同名候选时返回 null（宁可不定位也不误导）', () => {
    const root = domNode(1, '#document', {}, [domNode(2, 'DIV'), domNode(3, 'DIV')]);
    expect(matchDomNodeForNodePayload(root, { nodeName: 'DIV', attributes: {} })).toBeNull();
    expect(
      matchDomNodeForNodePayload(root, { nodeName: 'DIV', attributes: { id: 'nope' } }),
    ).toBeNull();
    expect(matchDomNodeForNodePayload(null, { nodeName: 'DIV', attributes: {} })).toBeNull();
  });
});

// ── 无障碍树 ───────────────────────────────────────────────────────────

describe('无障碍树', () => {
  it('下标路径 id 与展开压平一致', () => {
    expect(a11yNodePathId([])).toBe('0');
    expect(a11yNodePathId([0, 2, 1])).toBe('0.2.1');

    const root = makeA11yRoot();
    const expanded = defaultExpandedA11yIds(root);
    const rows = flattenA11yTree(root, expanded);
    expect(rows.map((row) => row.id)).toEqual(['0', '0.0', '0.1', '0.1.0', '0.1.1', '0.1.2']);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 1, 2, 2, 2]);
  });

  it('折叠子树后只保留该节点本身', () => {
    const root = makeA11yRoot();
    const rows = flattenA11yTree(root, new Set(['0']));
    expect(rows.map((row) => row.id)).toEqual(['0', '0.0', '0.1']);
    expect(rows.find((row) => row.id === '0.1')?.expanded).toBe(false);
  });

  it('按 id 取回节点；空树返回空结果', () => {
    const root = makeA11yRoot();
    expect(findA11yNode(root, '0.1.0')?.role).toBe('button');
    expect(findA11yNode(root, '0.0')?.role).toBe('heading');
    expect(findA11yNode(root, '0.9')).toBeNull();
    expect(findA11yNode(root, '9.9')).toBeNull();
    expect(flattenA11yTree(null, new Set())).toEqual([]);
    expect(defaultExpandedA11yIds(null).size).toBe(0);
  });
});

describe('describeA11yStateChips', () => {
  it('布尔状态显式成芯片：true / false 都有标签', () => {
    const chips = describeA11yStateChips(
      a11yNode({
        role: 'checkbox',
        focused: true,
        disabled: true,
        expanded: false,
        selected: false,
        checked: 'mixed',
        ignored: true,
      }),
    );
    expect(chips.map((chip) => chip.key)).toEqual([
      'focused',
      'disabled',
      'collapsed',
      'unselected',
      'mixed',
      'ignored',
    ]);
    expect(chips.find((chip) => chip.key === 'mixed')?.tone).toBe('warning');
    expect(chips.find((chip) => chip.key === 'focused')?.tone).toBe('accent');
  });

  it('全部状态都不存在时没有芯片；checked=true 是 success 语义', () => {
    expect(describeA11yStateChips(a11yNode())).toEqual([]);
    const chips = describeA11yStateChips(a11yNode({ checked: true, expanded: true, selected: true }));
    expect(chips.map((chip) => `${chip.key}:${chip.tone}`)).toEqual([
      'expanded:info',
      'selected:accent',
      'checked:success',
    ]);
  });
});

// ── 计算样式筛选 ───────────────────────────────────────────────────────

const SAMPLE_STYLES: Record<string, string> = {
  display: 'flex',
  position: 'static',
  'z-index': 'auto',
  'margin-top': '0px',
  'margin-left': '12px',
  'padding-top': '4px',
  color: 'rgb(20, 20, 20)',
  'background-color': 'rgba(0, 0, 0, 0)',
  'font-size': '14px',
  '-webkit-font-smoothing': 'antialiased',
  opacity: '1',
  cursor: 'pointer',
  'transition-duration': '0s',
  'transition-property': 'all',
  'box-shadow': 'none',
  'border-top-width': '1px',
  'border-top-style': 'solid',
  'white-space': 'normal',
  'will-change': 'transform',
};

describe('isNotableStyle / isDefaultStyleDeclaration', () => {
  it('已知默认值（含前缀归族）判定为默认', () => {
    expect(isDefaultStyleDeclaration('position', 'static')).toBe(true);
    expect(isDefaultStyleDeclaration('margin-top', '0px')).toBe(true);
    expect(isDefaultStyleDeclaration('margin-top', '8px')).toBe(false);
    expect(isDefaultStyleDeclaration('border-radius', '0px')).toBe(true);
    expect(isDefaultStyleDeclaration('animation-name', 'none')).toBe(true);
    expect(isDefaultStyleDeclaration('color', 'rgb(0, 0, 0)')).toBe(false);
  });

  it('保留清单外的属性、厂商前缀属性、默认值都不算「值得看」', () => {
    expect(isNotableStyle('display', 'flex')).toBe(true);
    expect(isNotableStyle('display', 'block')).toBe(true);
    expect(isNotableStyle('position', 'absolute')).toBe(true);
    expect(isNotableStyle('position', 'static')).toBe(false);
    expect(isNotableStyle('margin-left', '12px')).toBe(true);
    expect(isNotableStyle('margin-top', '0px')).toBe(false);
    expect(isNotableStyle('-webkit-font-smoothing', 'antialiased')).toBe(false);
    expect(isNotableStyle('--custom-property', '1')).toBe(false);
    expect(isNotableStyle('opacity', '0.5')).toBe(true);
    expect(isNotableStyle('opacity', '1')).toBe(false);
    expect(isNotableStyle('will-change', 'transform')).toBe(true);
  });
});

describe('buildInspectorStyleView', () => {
  it('默认视图只给「值得看」的声明，并如实统计被隐藏的数量', () => {
    const view = buildInspectorStyleView(SAMPLE_STYLES);
    expect(view.total).toBe(19);
    expect(view.notableCount).toBe(9);
    expect(view.hiddenCount).toBe(10);
    expect(view.searching).toBe(false);
    expect(view.rows.map((row) => row.property)).toEqual([
      'display',
      'margin-left',
      'padding-top',
      'color',
      'font-size',
      'cursor',
      'border-top-width',
      'border-top-style',
      'will-change',
    ]);
  });

  it('「显示全部」给全部声明，并保留 notable 标记', () => {
    const view = buildInspectorStyleView(SAMPLE_STYLES, { showAll: true });
    expect(view.rows.length).toBe(19);
    expect(view.rows.find((row) => row.property === 'z-index')?.notable).toBe(false);
    expect(view.rows.find((row) => row.property === 'display')?.notable).toBe(true);
  });

  it('搜索跨过默认筛选：能搜到被隐藏的属性名与值', () => {
    const byProperty = buildInspectorStyleView(SAMPLE_STYLES, { query: 'margin' });
    expect(byProperty.rows.map((row) => row.property)).toEqual(['margin-top', 'margin-left']);
    expect(byProperty.searching).toBe(true);

    const byValue = buildInspectorStyleView(SAMPLE_STYLES, { query: 'FLEX', showAll: false });
    expect(byValue.rows.map((row) => row.property)).toEqual(['display']);

    expect(buildInspectorStyleView(SAMPLE_STYLES, { query: '没有这条' }).rows).toEqual([]);
  });

  it('保持 payload 原序，且不修改入参', () => {
    const input = { color: 'rgb(1, 2, 3)', display: 'flex' };
    const view = buildInspectorStyleView(input);
    expect(view.rows.map((row) => row.property)).toEqual(['color', 'display']);
    expect(Object.keys(input)).toEqual(['color', 'display']);
  });
});

// ── 节点详情 ───────────────────────────────────────────────────────────

describe('buildInspectorNodeDetail', () => {
  it('两处都为空时没有详情', () => {
    expect(buildInspectorNodeDetail(null, null)).toBeNull();
  });

  it('只选中树节点时给出标签与属性，没有样式', () => {
    const detail = buildInspectorNodeDetail(
      domNode(7, 'BUTTON', { id: 'submit', class: 'primary' }),
      null,
    );
    expect(detail?.nodeName).toBe('BUTTON');
    expect(detail?.attributes).toEqual({ id: 'submit', class: 'primary' });
    expect(detail?.styles).toBeNull();
    expect(detail?.fromPick).toBe(false);
    expect(detail?.selector).toBeNull();
  });

  it('拾取回包优先使用 fullComputedStyles，并标记完整样式来源', () => {
    const detail = buildInspectorNodeDetail(domNode(7, 'BUTTON', { id: 'submit' }), {
      selector: 'button#submit',
      selectorUnique: false,
      selectorStrategy: 'id',
      nodeName: 'BUTTON',
      attributes: { id: 'submit' },
      text: '提交订单',
      computedStyles: { display: 'block' },
      fullComputedStyles: { display: 'flex', color: 'rgb(1, 1, 1)' },
    });
    expect(detail?.styles).toEqual({ display: 'flex', color: 'rgb(1, 1, 1)' });
    expect(detail?.fullStyles).toBe(true);
    expect(detail?.fromPick).toBe(true);
    expect(detail?.selector).toBe('button#submit');
    expect(detail?.selectorStrategy).toBe('id');
    expect(detail?.selectorAmbiguous).toBe(true);
    expect(detail?.text).toBe('提交订单');
  });

  it('空样式映射视为没有样式（不渲染空表）', () => {
    const detail = buildInspectorNodeDetail(null, {
      selector: 'div',
      nodeName: 'DIV',
      attributes: {},
      text: '',
      computedStyles: {},
    });
    expect(detail?.styles).toBeNull();
    expect(detail?.fullStyles).toBe(false);
  });
});

// ── 线路数据收窄 ───────────────────────────────────────────────────────

describe('线路数据收窄', () => {
  it('DOM 信封：形状不符返回 null，合法信封原样通过', () => {
    const payload = { root: domNode(1, '#document'), truncated: false };
    expect(toDomPayload(payload)).toEqual(payload);
    expect(toDomPayload({ root: payload.root })).toBeNull();
    expect(toDomPayload({ root: { nodeId: 1 }, truncated: false })).toBeNull();
    expect(toDomPayload({ root: domNode(1, '#document'), truncated: 'no' })).toBeNull();
    expect(toDomPayload(null)).toBeNull();
  });

  it('无障碍信封允许 root 为 null（空文档）', () => {
    expect(toA11yPayload({ root: null, nodeCount: 0 })).toEqual({ root: null, nodeCount: 0 });
    expect(toA11yPayload({ root: a11yNode({ role: 'button', name: 'ok' }), nodeCount: 1 })).not.toBeNull();
    expect(toA11yPayload({ root: { role: 'button' }, nodeCount: 1 })).toBeNull();
    expect(toA11yPayload({ root: null })).toBeNull();
  });

  it('元素信封：缺选择器 / 属性不是字符串映射时返回 null', () => {
    const ok = {
      selector: 'button#submit',
      nodeName: 'BUTTON',
      attributes: { id: 'submit' },
      text: '提交订单',
      computedStyles: { display: 'block' },
      selectorUnique: true,
      fullComputedStyles: { display: 'block' },
    };
    expect(toNodePayload(ok)).toEqual(ok);
    expect(toNodePayload({ ...ok, selector: '' })).toBeNull();
    expect(toNodePayload({ ...ok, attributes: { id: 1 } })).toBeNull();
    expect(toNodePayload('nope')).toBeNull();
    // 加法字段形状不符时只丢弃该字段，不让整份元素信息作废（computedStyles 仍在）。
    const degraded = toNodePayload({ ...ok, fullComputedStyles: 'nope' });
    expect(degraded?.selector).toBe('button#submit');
    expect(degraded?.fullComputedStyles).toBeUndefined();
  });
});
