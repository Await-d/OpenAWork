/**
 * 元素检查器面板：DOM 树 / 无障碍树两个视图 + 节点详情。
 *
 * 数据边界与 `NetworkWaterfall` 一致——信封由宿主注入（`dom` / `a11y` / `node`），
 * 面板不订阅任何来源、不持有连接：这样验收 harness 可以直接挂上合成信封，
 * 组件测试也不需要假造 WebSocket。订阅与上行指令在 `use-browser-inspector`。
 *
 * 交互约定：
 * - DOM 视图默认请求深度 4（`INSPECTOR_DEFAULT_DEPTH`），「更深」按 4 档递增到后端
 *   上限 12；回包 `truncated === true` 时显式提示「树被裁剪」而不是假装完整；
 * - 元素拾取回包（`ch:'node'`）到达后自动切回 DOM 视图、展开祖先链并选中对应节点；
 * - 「获取完整样式」用最近一次拾取坐标下发 `node.styles`，没有坐标时按钮禁用并说明原因。
 *
 * 颜色 / 间距一律 E · Nebula token，样式全部内联（无 `className`）。
 */

import { useEffect, useRef, useState } from 'react';
import type {
  BrowserLiveA11yPayload,
  BrowserLiveDomPayload,
  BrowserLiveNodePayload,
} from '@openAwork/shared';
import {
  INSPECTOR_DEFAULT_DEPTH,
  INSPECTOR_MAX_DEPTH,
  buildA11yNodeLabelParts,
  buildDomNodeLabelParts,
  buildInspectorNodeDetail,
  clampInspectorDepth,
  countDomTreeNodes,
  defaultExpandedA11yIds,
  defaultExpandedDomIds,
  expandIds,
  findA11yNode,
  findDomNode,
  firstElementNodeId,
  flattenA11yTree,
  flattenDomTree,
  isMaxInspectorDepth,
  matchDomNodeForNodePayload,
  nextInspectorDepth,
  toggleExpandedId,
} from './browser-inspector-model.js';
import type {
  BrowserInspectorLoadStatus,
  BrowserInspectorView,
} from './browser-inspector-model.js';
import {
  InspectorActionButton,
  InspectorA11yIcon,
  InspectorDomIcon,
  InspectorNotice,
  InspectorOffIcon,
  InspectorSkeleton,
  InspectorStrip,
} from './browser-inspector-chrome.js';
import {
  InspectorA11yDetailPane,
  InspectorEmptyDetail,
  InspectorNodeDetailPane,
} from './browser-inspector-detail.js';
import { InspectorTreeView } from './browser-inspector-tree.js';
import type { InspectorTreeItem } from './browser-inspector-tree.js';
import { BrowserPill } from './browser-pill.js';
import { INSPECTOR_TOKEN } from './browser-inspector-tokens.js';

export interface BrowserInspectorPanelProps {
  /** DOM 树信封（`ch:'dom'`）；null = 尚未请求或引擎不可用。 */
  dom: BrowserLiveDomPayload | null;
  /** 无障碍树信封（`ch:'a11y'`）；`root === null` 表示页面没有可用的无障碍树。 */
  a11y: BrowserLiveA11yPayload | null;
  /** 元素信封（`ch:'node'`）：既可能是拾取结果，也可能是 `node.styles` 回包。 */
  node: BrowserLiveNodePayload | null;
  /** DOM 请求状态；缺省按 `idle` 处理。 */
  domStatus?: BrowserInspectorLoadStatus;
  a11yStatus?: BrowserInspectorLoadStatus;
  nodeStatus?: BrowserInspectorLoadStatus;
  /** 最近一次协议错误（`ch:'error'`）文案。 */
  errorMessage?: string | null;
  /** 实时引擎不可用（Tauri 原生窗口 / 网关声明不可用 / 未安装调试浏览器）。 */
  unavailable?: boolean;
  /** 引擎不可用时的中文可操作提示（来自网关 reason 翻译）。 */
  unavailableHint?: string | null;
  /** 元素拾取是否已武装（与工具栏共用同一状态）。 */
  pickArmed?: boolean;
  /** 初始视图；缺省 DOM。 */
  initialView?: BrowserInspectorView;
  /** 初始请求深度；缺省 4，内部收敛到 [1, 12]。 */
  initialDepth?: number;
  /** 请求 DOM 树（深度由面板内部递增，回包通过 `dom` 注入）。 */
  onRequestDom: (depth: number) => void;
  /** 请求无障碍树。 */
  onRequestA11y: () => void;
  /** 用最近一次拾取坐标请求完整计算样式（`node.styles`）。 */
  onRequestFullStyles: () => void;
  /** 武装元素拾取（下一次点击下发 `pick`，结果进 composer 与检查器）。 */
  onArmPick: () => void;
  /** 解除拾取武装；缺省时再次点击「在页面中拾取」只是重复武装。 */
  onDisarmPick?: () => void;
}

export function BrowserInspectorPanel({
  dom,
  a11y,
  node,
  domStatus = 'idle',
  a11yStatus = 'idle',
  nodeStatus = 'idle',
  errorMessage = null,
  unavailable = false,
  unavailableHint = null,
  pickArmed = false,
  initialView = 'dom',
  initialDepth = INSPECTOR_DEFAULT_DEPTH,
  onRequestDom,
  onRequestA11y,
  onRequestFullStyles,
  onArmPick,
  onDisarmPick,
}: BrowserInspectorPanelProps) {
  const [view, setView] = useState<BrowserInspectorView>(initialView);
  const [depth, setDepth] = useState(() => clampInspectorDepth(initialDepth));
  const [expandedDomIds, setExpandedDomIds] = useState<ReadonlySet<number>>(new Set<number>());
  const [selectedDomId, setSelectedDomId] = useState<number | null>(null);
  const [expandedA11yIds, setExpandedA11yIds] = useState<ReadonlySet<string>>(new Set<string>());
  const [selectedA11yId, setSelectedA11yId] = useState<string | null>(null);
  const [scrollTick, setScrollTick] = useState(0);
  const requestedRef = useRef(false);

  // 首次进入（或引擎从不可用恢复）时自动取一次 DOM 树，避免空面板。
  useEffect(() => {
    if (requestedRef.current) return;
    if (unavailable || dom !== null || domStatus !== 'idle') return;
    requestedRef.current = true;
    onRequestDom(depth);
  }, [unavailable, dom, domStatus, depth, onRequestDom]);

  // 新的 DOM 回包：重置展开集合（默认全展开；请求深度本身就是舒适默认值），
  // 并在没有选中项时落到第一个真实元素（`#document` 的详情没有信息量）。
  useEffect(() => {
    if (dom === null) return;
    setExpandedDomIds(defaultExpandedDomIds(dom.root));
    setSelectedDomId((current) =>
      current !== null && findDomNode(dom.root, current) !== null
        ? current
        : firstElementNodeId(dom.root),
    );
  }, [dom]);

  useEffect(() => {
    if (a11y === null) return;
    setExpandedA11yIds(defaultExpandedA11yIds(a11y.root));
    setSelectedA11yId((current) => (a11y.root === null ? null : (current ?? '0')));
  }, [a11y]);

  // 拾取 / 完整样式回包：切回 DOM 视图，展开祖先链，选中并滚动到对应节点。
  // 依赖里带上 `dom`：先拾取后取树（或树仍在途）时，树到达后要补一次定位。
  useEffect(() => {
    if (node === null) return;
    setView('dom');
    const match = matchDomNodeForNodePayload(dom?.root ?? null, node);
    if (match !== null) {
      setExpandedDomIds((current) => expandIds(current, [...match.ancestorIds, match.node.nodeId]));
      setSelectedDomId(match.node.nodeId);
    }
    setScrollTick((tick) => tick + 1);
  }, [node, dom]);

  const requestDomWithDepth = (next: number): void => {
    const clamped = clampInspectorDepth(next);
    setDepth(clamped);
    onRequestDom(clamped);
  };

  const domRoot = dom?.root ?? null;
  const domRows = flattenDomTree(domRoot, expandedDomIds);
  const domItems: InspectorTreeItem[] = domRows.map((row) => ({
    id: String(row.id),
    depth: row.depth,
    parts: buildDomNodeLabelParts(row.node),
    hasChildren: row.hasChildren,
    expanded: row.expanded,
  }));

  const a11yRoot = a11y?.root ?? null;
  const a11yRows = flattenA11yTree(a11yRoot, expandedA11yIds);
  const a11yItems: InspectorTreeItem[] = a11yRows.map((row) => ({
    id: row.id,
    depth: row.depth,
    parts: buildA11yNodeLabelParts(row.node),
    hasChildren: row.hasChildren,
    expanded: row.expanded,
    dimmed: row.node.ignored,
    note: row.node.ignored ? 'ignored' : undefined,
  }));

  const selectedDomNode = findDomNode(domRoot, selectedDomId ?? -1);
  const detail = buildInspectorNodeDetail(selectedDomNode, node);
  const selectedA11yNode = findA11yNode(a11yRoot, selectedA11yId ?? '');

  const hasDomData = dom !== null;
  const hasA11yData = a11y !== null;
  const canRequestFullStyles = node !== null;
  const fullStylesBusy = nodeStatus === 'loading';

  return (
    <div
      data-testid="browser-inspector"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        fontSize: 11,
        lineHeight: 1.5,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          flexShrink: 0,
          borderBottom: `1px solid ${INSPECTOR_TOKEN.borderSubtle}`,
        }}
      >
        <BrowserPill
          label="DOM"
          title="DOM 树视图：按层级查看页面元素"
          active={view === 'dom'}
          onClick={() => setView('dom')}
          testId="inspector-view-dom"
          size="sm"
        />
        <BrowserPill
          label="无障碍"
          title="无障碍树视图：role / 名称 / 状态"
          active={view === 'a11y'}
          onClick={() => setView('a11y')}
          testId="inspector-view-a11y"
          size="sm"
        />

        {view === 'dom' ? (
          <>
            <span
              data-testid="inspector-depth"
              title={`当前请求深度 ${depth}，后端上限 ${INSPECTOR_MAX_DEPTH}`}
              style={{
                fontSize: 9,
                color: INSPECTOR_TOKEN.textSubtle,
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {`深度 ${depth}/${INSPECTOR_MAX_DEPTH}`}
            </span>
            <InspectorActionButton
              label="刷新"
              title="按当前深度重新读取 DOM 树"
              testId="inspector-dom-refresh"
              disabled={unavailable || domStatus === 'loading'}
              onClick={() => requestDomWithDepth(depth)}
            />
            <InspectorActionButton
              label="更深"
              title={
                isMaxInspectorDepth(depth)
                  ? `已到后端深度上限 ${INSPECTOR_MAX_DEPTH}`
                  : `请求更深一档（${nextInspectorDepth(depth)}）的 DOM 树`
              }
              testId="inspector-dom-deeper"
              disabled={unavailable || domStatus === 'loading' || isMaxInspectorDepth(depth)}
              onClick={() => requestDomWithDepth(nextInspectorDepth(depth))}
            />
          </>
        ) : (
          <InspectorActionButton
            label="刷新"
            title="重新读取无障碍树"
            testId="inspector-a11y-refresh"
            disabled={unavailable || a11yStatus === 'loading'}
            onClick={onRequestA11y}
          />
        )}

        <BrowserPill
          label="在页面中拾取"
          title={
            pickArmed
              ? '拾取模式已开启：在预览画面上点击目标元素（Esc 退出）'
              : '开启拾取模式：在预览画面上点击目标元素'
          }
          active={pickArmed}
          onClick={() => {
            if (pickArmed) {
              onDisarmPick?.();
              return;
            }
            onArmPick();
          }}
          testId="inspector-arm-pick"
          size="sm"
        />

        <div style={{ flex: 1 }} />

        <span
          data-testid="inspector-summary"
          style={{
            fontSize: 9,
            color: INSPECTOR_TOKEN.textMuted,
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {view === 'dom'
            ? hasDomData
              ? `${countDomTreeNodes(domRoot)} 个节点`
              : '暂无 DOM 数据'
            : hasA11yData
              ? `${a11y?.nodeCount ?? 0} 个节点`
              : '暂无无障碍数据'}
        </span>
      </div>

      {errorMessage !== null ? (
        <InspectorStrip
          tone="danger"
          title="实时请求失败"
          description={errorMessage}
          testId="inspector-error"
        />
      ) : null}

      {unavailable ? (
        <InspectorStrip
          tone="warning"
          title="实时引擎不可用"
          description={
            view === 'dom' && hasDomData
              ? '以下为最后一次成功获取的数据。'
              : view === 'a11y' && hasA11yData
                ? '以下为最后一次成功获取的数据。'
                : undefined
          }
          testId="inspector-unavailable"
        />
      ) : null}

      {view === 'dom' && dom?.truncated === true ? (
        <InspectorStrip
          tone="warning"
          title="树已被裁剪"
          description={`后端在深度 ${depth} 或节点数上限处停止下发，更深的内容需要「更深」。`}
          testId="inspector-truncated"
          action={
            <InspectorActionButton
              label="更深"
              title={`请求更深一档（${nextInspectorDepth(depth)}）的 DOM 树`}
              testId="inspector-truncated-deeper"
              disabled={unavailable || isMaxInspectorDepth(depth)}
              onClick={() => requestDomWithDepth(nextInspectorDepth(depth))}
            />
          }
        />
      ) : null}

      <div
        data-testid="inspector-body"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          scrollbarWidth: 'thin',
        }}
      >
        <div
          data-testid="inspector-tree-column"
          style={{
            flex: '1 1 300px',
            minWidth: 200,
            minHeight: 0,
            background: INSPECTOR_TOKEN.surfaceBase,
          }}
        >
          {unavailable && !hasDomData && !hasA11yData ? (
            <InspectorNotice
              icon={<InspectorOffIcon />}
              title="实时引擎不可用"
              description={
                unavailableHint ??
                '当前环境无法连接调试浏览器（Tauri 原生窗口模式下不提供实时引擎）。请在 Web 模式或支持 CDP 的环境中查看页面结构。'
              }
              testId="inspector-unavailable-notice"
            />
          ) : view === 'dom' ? (
            <DomTreeBody
              items={domItems}
              payload={dom}
              status={domStatus}
              selectedId={selectedDomId === null ? null : String(selectedDomId)}
              scrollTick={scrollTick}
              onSelect={(id) => setSelectedDomId(Number(id))}
              onToggle={(id) =>
                setExpandedDomIds((current) => toggleExpandedId(current, Number(id)))
              }
              onRequestDom={() => requestDomWithDepth(depth)}
            />
          ) : (
            <A11yTreeBody
              items={a11yItems}
              payload={a11y}
              status={a11yStatus}
              selectedId={selectedA11yId}
              onSelect={setSelectedA11yId}
              onToggle={(id) => setExpandedA11yIds((current) => toggleExpandedId(current, id))}
              onRequestA11y={onRequestA11y}
            />
          )}
        </div>

        <div
          data-testid="inspector-detail-column"
          style={{
            flex: '1 1 340px',
            minWidth: 240,
            minHeight: 0,
          }}
        >
          {view === 'dom' ? (
            detail === null ? (
              <div style={{ padding: 8 }}>
                <InspectorEmptyDetail
                  title="未选择节点"
                  description="在左侧 DOM 树中选择节点，或点击「在页面中拾取」后在预览画面上点元素：拾取结果会带出选择器、属性和计算样式。"
                />
              </div>
            ) : (
              <InspectorNodeDetailPane
                detail={detail}
                canRequestFullStyles={canRequestFullStyles}
                fullStylesBusy={fullStylesBusy}
                unavailable={unavailable}
                onRequestFullStyles={onRequestFullStyles}
                onArmPick={onArmPick}
              />
            )
          ) : (
            <InspectorA11yDetailPane node={selectedA11yNode} />
          )}
        </div>
      </div>
    </div>
  );
}

function DomTreeBody({
  items,
  payload,
  status,
  selectedId,
  scrollTick,
  onSelect,
  onToggle,
  onRequestDom,
}: {
  items: InspectorTreeItem[];
  payload: BrowserLiveDomPayload | null;
  status: BrowserInspectorLoadStatus;
  selectedId: string | null;
  scrollTick: number;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRequestDom: () => void;
}) {
  if (status === 'loading' && payload === null) {
    return <InspectorSkeleton label="正在读取 DOM 树…" testId="inspector-dom-loading" />;
  }
  if (status === 'error' && payload === null) {
    return (
      <InspectorNotice
        icon={<InspectorDomIcon />}
        title="读取 DOM 树失败"
        description="网关拒绝了本次 dom.tree 请求，或页面在请求期间发生了跳转。可以重试。"
        testId="inspector-dom-error"
        action={
          <InspectorActionButton label="重试" title="重新请求 DOM 树" onClick={onRequestDom} />
        }
      />
    );
  }
  if (payload === null) {
    return (
      <InspectorNotice
        icon={<InspectorDomIcon />}
        title="尚未获取 DOM 树"
        description="DOM 树通过实时通道按深度读取，默认取 4 层；需要更深时用「更深」。"
        testId="inspector-dom-empty"
        action={
          <InspectorActionButton label="获取 DOM 树" title="请求 DOM 树" onClick={onRequestDom} />
        }
      />
    );
  }
  if (items.length === 0) {
    return (
      <InspectorNotice
        icon={<InspectorDomIcon />}
        title="DOM 树为空"
        description="页面还没有可读取的文档节点，刷新后重试。"
        testId="inspector-dom-empty"
      />
    );
  }
  return (
    <InspectorTreeView
      ariaLabel="DOM 树"
      testId="inspector-dom-tree"
      rowTestId="inspector-dom-row"
      toggleTestId="inspector-dom-toggle"
      items={items}
      selectedId={selectedId}
      onSelect={onSelect}
      onToggle={onToggle}
      scrollTick={scrollTick}
    />
  );
}

function A11yTreeBody({
  items,
  payload,
  status,
  selectedId,
  onSelect,
  onToggle,
  onRequestA11y,
}: {
  items: InspectorTreeItem[];
  payload: BrowserLiveA11yPayload | null;
  status: BrowserInspectorLoadStatus;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRequestA11y: () => void;
}) {
  if (status === 'loading' && payload === null) {
    return <InspectorSkeleton label="正在读取无障碍树…" testId="inspector-a11y-loading" />;
  }
  if (status === 'error' && payload === null) {
    return (
      <InspectorNotice
        icon={<InspectorA11yIcon />}
        title="读取无障碍树失败"
        description="网关拒绝了本次 a11y.tree 请求。可以重试。"
        testId="inspector-a11y-error"
        action={
          <InspectorActionButton label="重试" title="重新请求无障碍树" onClick={onRequestA11y} />
        }
      />
    );
  }
  if (payload === null) {
    return (
      <InspectorNotice
        icon={<InspectorA11yIcon />}
        title="尚未获取无障碍树"
        description="无障碍树展示 role / 名称 / 值与 focused、disabled、checked 等状态。"
        testId="inspector-a11y-empty"
        action={
          <InspectorActionButton
            label="获取无障碍树"
            title="请求无障碍树"
            onClick={onRequestA11y}
          />
        }
      />
    );
  }
  if (payload.root === null) {
    return (
      <InspectorNotice
        icon={<InspectorA11yIcon />}
        title="页面未提供无障碍树"
        description="当前页面没有可用的无障碍节点（可能是 about:blank 之类的空文档）。"
        testId="inspector-a11y-empty"
        action={
          <InspectorActionButton
            label="重新获取"
            title="重新请求无障碍树"
            onClick={onRequestA11y}
          />
        }
      />
    );
  }
  return (
    <InspectorTreeView
      ariaLabel="无障碍树"
      testId="inspector-a11y-tree"
      rowTestId="inspector-a11y-row"
      toggleTestId="inspector-a11y-toggle"
      items={items}
      selectedId={selectedId}
      onSelect={onSelect}
      onToggle={onToggle}
    />
  );
}
