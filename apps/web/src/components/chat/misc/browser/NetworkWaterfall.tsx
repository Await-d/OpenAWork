/**
 * 网络瀑布（Waterfall）视图。
 *
 * 数据与列表视图完全同源：宿主（`BrowserConsolePanel`）传入同一份按 tab 隔离的
 * `ConsoleEntry[]`，本组件只筛出网络条目并渲染时间轴——不另建网络存储，也不重做
 * 三段归并（`upsertNetworkEntry` 已把 request / response / failed 并成同一条记录）。
 *
 * 几何 / 格式化数学放在文件顶部的纯函数里（`computeWaterfallLayout` /
 * `formatWaterfallDuration` / `classifyNetworkStatus` / `normalizeDurationMs`），
 * 组件本身只负责渲染与交互状态，辅助函数可直接单测。
 *
 * 颜色一律走 E · Nebula token（`--success` / `--aux` / `--warning` / `--danger`）；
 * 状态类的语义映射集中在 `WATERFALL_STATUS_META`，不散落在 JSX 里。
 *
 * 样式不依赖任何 CSS 类：全部内联（与 `BrowserToolbar` 一致），伪类状态由 React
 * state 驱动；token 引用统一经 `WF_TOKEN` 并带 `currentColor` 兜底（原因见该常量）。
 * 筛选 pill 与控制台视图切换共用 `BrowserPill`。
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ConsoleEntry, NetworkExchange } from './browser-console-types.js';
import { BrowserPill } from './browser-pill.js';
import { formatHeaderLines } from './browser-console-format.js';
import { copyTextToClipboard } from './browser-clipboard.js';
import { buildNetworkHar, downloadNetworkHar } from './network-har.js';
import type { HarExchange, NetworkHarContext } from './network-har.js';

// ── 纯辅助函数（可单测）──────────────────────────────────────────────────

/** 请求在网络视图里的状态分类：成功 / 重定向 / 4xx-5xx / 网络层失败 / 尚未返回。 */
export type WaterfallStatusClass = 'ok' | 'redirect' | 'error' | 'failed' | 'pending';

export interface WaterfallStatusMeta {
  label: string;
  /** E · Nebula token 引用（禁止硬编码色值）。 */
  color: string;
}

/** 状态类 → 展示文案与语义色 token。 */
export const WATERFALL_STATUS_META: Record<WaterfallStatusClass, WaterfallStatusMeta> = {
  ok: { label: '2xx', color: 'var(--success)' },
  redirect: { label: '3xx', color: 'var(--aux)' },
  error: { label: '4xx-5xx', color: 'var(--warning)' },
  failed: { label: '失败', color: 'var(--danger)' },
  pending: { label: '请求中', color: 'var(--fg-subtle)' },
};

/** 轨道里可见的最小条宽（%）：0ms 的请求也必须有视觉存在感。 */
export const WATERFALL_MIN_BAR_PCT = 1;

/** 把网络记录归类到状态类；`errorMessage` 优先于状态码（网络层失败没有状态码）。 */
export function classifyNetworkStatus(
  network: Pick<NetworkExchange, 'status' | 'errorMessage'>,
): WaterfallStatusClass {
  if (typeof network.errorMessage === 'string' && network.errorMessage.length > 0) {
    return 'failed';
  }
  const { status } = network;
  if (status === undefined) return 'pending';
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 300 && status < 400) return 'redirect';
  return 'error';
}

/** 已记录的耗时；`undefined` / 负数 / 非有限值都视为未记录。 */
export function normalizeDurationMs(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

export interface WaterfallLayoutInput {
  id: string;
  /** 请求开始时刻（epoch ms，取自 `ConsoleEntry.timestamp`）。 */
  startedAt: number;
  /** 已记录的耗时（ms）。 */
  durationMs?: number;
}

export interface WaterfallLayoutItem {
  id: string;
  /** 相对时间轴左端的偏移（%，保留两位小数）。 */
  leftPct: number;
  /** 已记录的耗时；null = 未记录。 */
  durationMs: number | null;
  /** 相对宽度（%）；null = 未记录，渲染为不确定态而不是零宽条。 */
  widthPct: number | null;
}

export interface WaterfallLayout {
  items: WaterfallLayoutItem[];
  /** 时间轴总跨度（ms）；空输入为 0，非空时至少 1，避免零跨度除零。 */
  spanMs: number;
}

/**
 * 计算瀑布几何：以最早开始时刻为原点，`durationMs` 决定条宽。
 *
 * 边界约定：
 * - 空输入 → `{ items: [], spanMs: 0 }`；
 * - 全部同刻且零耗时 → `spanMs` 兜底为 1，条仍以最小宽度可见；
 * - 未记录耗时的条从起点延伸到轨道末端（不确定态），起点贴右边界时向内收
 *   1%，保证仍然可见；
 * - 百分比保留两位小数，同输入永远得到同输出。
 */
export function computeWaterfallLayout(items: readonly WaterfallLayoutInput[]): WaterfallLayout {
  if (items.length === 0) return { items: [], spanMs: 0 };

  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const startedAt = toFiniteMs(item.startedAt);
    const duration = normalizeDurationMs(item.durationMs) ?? 0;
    start = Math.min(start, startedAt);
    end = Math.max(end, startedAt + duration);
  }
  const spanMs = Math.max(end - start, 1);

  return {
    items: items.map((item) => {
      const startedAt = toFiniteMs(item.startedAt);
      const duration = normalizeDurationMs(item.durationMs);
      const leftPct = roundPct(((startedAt - start) / spanMs) * 100);

      if (duration === null) {
        return {
          id: item.id,
          leftPct: clamp(leftPct, 0, 100 - WATERFALL_MIN_BAR_PCT),
          durationMs: null,
          widthPct: null,
        };
      }

      const widthPct = clamp(
        roundPct((duration / spanMs) * 100),
        WATERFALL_MIN_BAR_PCT,
        Math.max(100 - leftPct, WATERFALL_MIN_BAR_PCT),
      );
      return { id: item.id, leftPct, durationMs: duration, widthPct };
    }),
    spanMs,
  };
}

/** 耗时的紧凑展示：`18ms` / `1.24s` / `1.08min`；未记录时是 `—`。 */
export function formatWaterfallDuration(ms: number | null | undefined): string {
  const value = normalizeDurationMs(ms ?? undefined);
  if (value === null) return '—';
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${formatSeconds(value / 1000)}s`;
  return `${formatSeconds(value / 60_000)}min`;
}

function formatSeconds(value: number): string {
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toFiniteMs(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

// ── 内联样式 token ──────────────────────────────────────────────────────

/**
 * 内联样式引用的 E · Nebula token。
 *
 * 全部写成「应用 token + `currentColor` 兜底」：本组件可能被渲染在尚未加载应用级
 * token 表（`index.css`）的宿主里（验收 harness、独立预览）。裸 `var()` 在那里会在
 * computed-value 阶段整体失效——边框、选中底色、焦点环会一起消失，界面退化成纯
 * 文本（历史版本里「筛选 pill 看不出选中」就是这个原因）。兜底不含任何硬编码色值，
 * 只按比例混出 `currentColor`；token 表存在时兜底永远不会生效。
 */
const WF_TOKEN = {
  /** `bg-*` 四个面：面板 / 深一层的卡片 / 轨道与骨架条。 */
  surface: 'var(--bg-overlay, color-mix(in oklch, currentColor 6%, transparent))',
  surfaceBase: 'var(--bg-raised, color-mix(in oklch, currentColor 4%, transparent))',
  surfaceRaised: 'var(--bg-elevated, color-mix(in oklch, currentColor 10%, transparent))',
  hoverBg: 'var(--bg-hover, color-mix(in oklch, currentColor 10%, transparent))',
  pressedBg: 'var(--bg-active, color-mix(in oklch, currentColor 14%, transparent))',
  selectedBg: 'var(--accent-subtle, color-mix(in oklch, currentColor 8%, transparent))',
  textStrong: 'var(--fg-strong, currentColor)',
  textDefault: 'var(--fg-default, currentColor)',
  textMuted: 'var(--fg-muted, color-mix(in oklch, currentColor 70%, transparent))',
  textSubtle: 'var(--fg-subtle, color-mix(in oklch, currentColor 52%, transparent))',
  borderSubtle: 'var(--border-subtle, color-mix(in oklch, currentColor 12%, transparent))',
  borderDefault: 'var(--border-default, color-mix(in oklch, currentColor 20%, transparent))',
  borderEmphasis: 'var(--border-emphasis, color-mix(in oklch, currentColor 32%, transparent))',
  focusRing: 'var(--accent-subtle, color-mix(in oklch, currentColor 10%, transparent))',
  accent: 'var(--accent, currentColor)',
} as const;

function mergeBoxShadow(...shadows: Array<string | null>): string {
  const parts = shadows.filter((value): value is string => value !== null);
  return parts.length > 0 ? parts.join(', ') : 'none';
}

// ── 组件 ────────────────────────────────────────────────────────────────

/** 采集状态：`unavailable` = 无实时引擎 / 未录制；`loading` = 等待首批事件。 */
export type NetworkCaptureStatus = 'ready' | 'loading' | 'unavailable';

export interface NetworkWaterfallProps {
  /** 与列表视图同源的条目（含网络记录）。 */
  entries: ConsoleEntry[];
  /** HAR 导出上下文（页面 URL / 标题）。 */
  context?: NetworkHarContext;
  /** 采集状态；缺省视为正常采集。 */
  captureStatus?: NetworkCaptureStatus;
}

interface WaterfallRow {
  entry: ConsoleEntry;
  network: NetworkExchange;
  statusClass: WaterfallStatusClass;
}

const STATUS_FILTERS: ReadonlyArray<{ value: WaterfallStatusClass | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'ok', label: '2xx' },
  { value: 'redirect', label: '3xx' },
  { value: 'error', label: '4xx-5xx' },
];

/** URL 超过该长度才展示展开 / 收起控件。 */
const URL_TRUNCATE_CHARS = 64;

const FEEDBACK_CLEAR_MS = 1_600;

export function NetworkWaterfall({
  entries,
  context,
  captureStatus = 'ready',
}: NetworkWaterfallProps) {
  const [resourceType, setResourceType] = useState<string>('all');
  const [statusClass, setStatusClass] = useState<WaterfallStatusClass | 'all'>('all');
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [urlExpanded, setUrlExpanded] = useState(false);

  const rows = collectWaterfallRows(entries);
  const resourceTypes = collectResourceTypes(rows);
  const visibleRows = rows.filter((row) => {
    if (onlyFailures && row.statusClass !== 'failed') return false;
    if (statusClass !== 'all' && row.statusClass !== statusClass) return false;
    if (resourceType !== 'all' && row.network.resourceType !== resourceType) return false;
    return true;
  });

  const layout = computeWaterfallLayout(
    rows.map((row) => ({
      id: row.entry.id,
      startedAt: row.entry.timestamp,
      durationMs: row.network.durationMs,
    })),
  );
  const layoutById = new Map(layout.items.map((item) => [item.id, item] as const));
  const failureCount = visibleRows.filter((row) => row.statusClass === 'failed').length;
  const totalDurationMs = visibleRows.reduce(
    (sum, row) => sum + (normalizeDurationMs(row.network.durationMs) ?? 0),
    0,
  );
  const unknownDurationCount = visibleRows.filter(
    (row) => normalizeDurationMs(row.network.durationMs) === null,
  ).length;
  const selectedRow = visibleRows.find((row) => row.entry.id === selectedId) ?? null;

  const exportHar = (): void => {
    const exchanges: HarExchange[] = visibleRows.map((row) => ({
      ...row.network,
      startedAtMs: row.entry.timestamp,
    }));
    downloadNetworkHar(
      buildNetworkHar(exchanges, context ?? {}),
      `openawork-network-${Date.now()}.har`,
    );
  };

  return (
    <div
      data-testid="network-waterfall"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        fontSize: 11,
        lineHeight: 1.5,
      }}
    >
      {captureStatus === 'unavailable' ? (
        <WaterfallNotice
          icon={<WaterfallOffIcon />}
          title="未开始录制"
          description="实时引擎不可用或未在录制网络流量。Tauri 原生窗口需依赖网关侧实时引擎采集，可先处理上方引擎提示；也可在 Web 模式或开发者工具中查看。"
        />
      ) : captureStatus === 'loading' ? (
        <WaterfallSkeleton />
      ) : rows.length === 0 ? (
        <WaterfallNotice
          icon={<WaterfallActivityIcon />}
          title="暂无网络请求"
          description="打开页面或触发一次请求后，这里会按时间轴展示每个请求的耗时。"
        />
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              flexShrink: 0,
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            {STATUS_FILTERS.map((filter) => (
              <BrowserPill
                key={filter.value}
                label={filter.label}
                active={statusClass === filter.value}
                onClick={() => setStatusClass(filter.value)}
                testId={`waterfall-status-${filter.value}`}
              />
            ))}
            <BrowserPill
              label={failureCount > 0 ? `仅失败 ${failureCount}` : '仅失败'}
              active={onlyFailures}
              onClick={() => setOnlyFailures((value) => !value)}
              testId="waterfall-failures-toggle"
            />
            <div style={{ flex: 1 }} />
            <span
              data-testid="waterfall-summary"
              style={{ fontSize: 9.5, color: WF_TOKEN.textMuted, whiteSpace: 'nowrap' }}
            >
              {`${visibleRows.length} 个请求 · ${failureCount} 个失败 · 总耗时 ${formatWaterfallDuration(totalDurationMs)}`}
              {unknownDurationCount > 0 ? ` · ${unknownDurationCount} 条未记录耗时` : ''}
            </span>
            <WaterfallActionButton
              label="导出 HAR"
              title="导出当前筛选结果为 HAR 1.2 文件"
              testId="waterfall-export"
              disabled={visibleRows.length === 0}
              onClick={exportHar}
            />
          </div>

          {resourceTypes.length > 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                flexShrink: 0,
                overflowX: 'auto',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <span style={{ fontSize: 9, color: WF_TOKEN.textSubtle, flexShrink: 0 }}>类型</span>
              <BrowserPill
                label="全部"
                active={resourceType === 'all'}
                onClick={() => setResourceType('all')}
                testId="waterfall-type-all"
              />
              {resourceTypes.map((type) => (
                <BrowserPill
                  key={type}
                  label={type}
                  active={resourceType === type}
                  onClick={() => setResourceType(type)}
                  testId={`waterfall-type-${type}`}
                />
              ))}
            </div>
          ) : null}

          {visibleRows.length === 0 ? (
            <WaterfallNotice
              icon={<WaterfallActivityIcon />}
              title="当前筛选条件下无匹配"
              description="调整状态类 / 类型筛选，或关闭「仅失败」后重试。"
            />
          ) : (
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                overflowX: 'hidden',
                padding: '0 8px 4px',
                scrollbarWidth: 'thin',
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '4px 0',
                  fontSize: 9,
                  color: WF_TOKEN.textSubtle,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <span style={{ flex: 1 }}>0ms</span>
                <span>{formatWaterfallDuration(layout.spanMs / 2)}</span>
                <span style={{ flex: 1, textAlign: 'right' }}>
                  {formatWaterfallDuration(layout.spanMs)}
                </span>
              </div>
              {visibleRows.map((row) => (
                <WaterfallRowButton
                  key={row.entry.id}
                  row={row}
                  item={layoutById.get(row.entry.id)}
                  selected={row.entry.id === selectedId}
                  onSelect={() => {
                    setSelectedId((current) => (current === row.entry.id ? null : row.entry.id));
                    setUrlExpanded(false);
                  }}
                />
              ))}
            </div>
          )}

          {selectedRow !== null ? (
            <WaterfallDetail
              row={selectedRow}
              expanded={urlExpanded}
              onToggleUrl={() => setUrlExpanded((value) => !value)}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function WaterfallRowButton({
  row,
  item,
  selected,
  onSelect,
}: {
  row: WaterfallRow;
  item: WaterfallLayoutItem | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  const meta = WATERFALL_STATUS_META[row.statusClass];
  const { network } = row;
  const method = network.method.length > 0 ? network.method.toUpperCase() : 'GET';

  return (
    <button
      type="button"
      data-testid="waterfall-row"
      data-status-class={row.statusClass}
      aria-pressed={selected}
      title={`${method} ${network.url}`}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        width: '100%',
        padding: '4px 8px',
        border: 'none',
        borderRadius: 8,
        background: selected
          ? WF_TOKEN.selectedBg
          : pressed
            ? WF_TOKEN.pressedBg
            : hovered
              ? WF_TOKEN.hoverBg
              : 'transparent',
        color: WF_TOKEN.textDefault,
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        outline: focused ? `2px solid ${WF_TOKEN.accent}` : 'none',
        outlineOffset: -2,
        boxShadow: mergeBoxShadow(
          selected ? `inset 2px 0 0 0 ${WF_TOKEN.accent}` : null,
          focused ? `0 0 0 4px ${WF_TOKEN.focusRing}` : null,
        ),
        transition: 'background 100ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          style={{
            flexShrink: 0,
            width: 40,
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: WF_TOKEN.textMuted,
          }}
        >
          {method}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 10.5,
            color: WF_TOKEN.textDefault,
          }}
        >
          {toDisplayTarget(network.url)}
        </span>
        <span style={{ fontSize: 10, fontWeight: 600, color: meta.color }}>
          {formatStatusLabel(row)}
        </span>
        <span
          style={{
            width: 46,
            flexShrink: 0,
            textAlign: 'right',
            fontSize: 9.5,
            color: WF_TOKEN.textMuted,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatWaterfallDuration(network.durationMs)}
        </span>
      </span>
      <span
        style={{
          position: 'relative',
          display: 'block',
          height: 10,
          borderRadius: 4,
          background: WF_TOKEN.surfaceRaised,
          overflow: 'hidden',
        }}
      >
        {item === undefined ? null : item.widthPct === null ? (
          <span
            data-indeterminate="true"
            data-testid="waterfall-bar"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${item.leftPct}%`,
              right: 0,
              borderRadius: 4,
              background: 'color-mix(in oklch, currentColor 14%, transparent)',
              border: '1px dashed currentColor',
              color: meta.color,
            }}
          />
        ) : (
          <span
            data-testid="waterfall-bar"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${item.leftPct}%`,
              width: `${item.widthPct}%`,
              borderRadius: 4,
              background: 'currentColor',
              color: meta.color,
            }}
          />
        )}
      </span>
    </button>
  );
}

function WaterfallDetail({
  row,
  expanded,
  onToggleUrl,
  onClose,
}: {
  row: WaterfallRow;
  expanded: boolean;
  onToggleUrl: () => void;
  onClose: () => void;
}) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    },
    [],
  );

  const { network } = row;
  const meta = WATERFALL_STATUS_META[row.statusClass];
  const method = network.method.length > 0 ? network.method.toUpperCase() : 'GET';
  const canExpandUrl = network.url.length > URL_TRUNCATE_CHARS;
  const resourceType =
    typeof network.resourceType === 'string' && network.resourceType.length > 0
      ? network.resourceType
      : '未知';

  const copyUrl = (): void => {
    void copyTextToClipboard(network.url).then((ok) => {
      setFeedback(ok ? '已复制' : '复制失败');
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
      feedbackTimerRef.current = window.setTimeout(() => {
        feedbackTimerRef.current = null;
        setFeedback(null);
      }, FEEDBACK_CLEAR_MS);
    });
  };

  return (
    <div
      data-testid="waterfall-detail"
      style={{
        flexShrink: 0,
        maxHeight: '45%',
        overflowY: 'auto',
        padding: '8px 12px',
        borderTop: `1px solid ${WF_TOKEN.borderDefault}`,
        background: WF_TOKEN.surface,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <DetailFact label="方法" value={method} />
        <DetailFact
          label="状态"
          value={`${formatStatusLabel(row)}${network.statusText ? ` ${network.statusText}` : ''}`}
          color={meta.color}
        />
        <DetailFact label="耗时" value={formatWaterfallDuration(network.durationMs)} />
        <DetailFact label="类型" value={resourceType} />
        <div style={{ flex: 1 }} />
        {feedback !== null ? (
          <span role="status" style={{ fontSize: 9, color: 'var(--success, currentColor)' }}>
            {feedback}
          </span>
        ) : null}
        <WaterfallActionButton label="复制 URL" title="复制完整 URL" onClick={copyUrl} />
        <WaterfallActionButton label="✕" title="关闭详情" ariaLabel="关闭详情" onClick={onClose} />
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginTop: 4 }}>
        <span
          title={network.url}
          style={
            expanded
              ? {
                  flex: 1,
                  minWidth: 0,
                  fontSize: 10,
                  color: WF_TOKEN.textDefault,
                  fontFamily: 'var(--font-mono, monospace)',
                  wordBreak: 'break-all',
                }
              : {
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 10,
                  color: WF_TOKEN.textDefault,
                  fontFamily: 'var(--font-mono, monospace)',
                }
          }
        >
          {network.url}
        </span>
        {canExpandUrl ? (
          <WaterfallActionButton
            label={expanded ? '收起 URL' : '展开 URL'}
            title="展开或收起完整 URL"
            onClick={onToggleUrl}
          />
        ) : null}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 8,
          marginTop: 8,
        }}
      >
        <HeaderBlock
          title="请求头（已脱敏）"
          text={formatHeaderLines(network.requestHeaders) || '无'}
        />
        <HeaderBlock
          title="响应头（已脱敏）"
          text={formatHeaderLines(network.responseHeaders) || '无'}
        />
      </div>
      <p
        data-testid="waterfall-body-note"
        style={{ margin: '8px 0 0', fontSize: 9.5, lineHeight: 1.6, color: WF_TOKEN.textSubtle }}
      >
        未采集响应体：本阶段只记录请求 / 响应元数据，需要响应体请在开发者工具中查看。
      </p>
    </div>
  );
}

function DetailFact({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5 }}>
      <span style={{ color: WF_TOKEN.textSubtle }}>{label}</span>
      <span style={{ fontWeight: 600, color: color ?? WF_TOKEN.textDefault }}>{value}</span>
    </span>
  );
}

function HeaderBlock({ title, text }: { title: string; text: string }) {
  return (
    <div
      style={{
        border: `1px solid ${WF_TOKEN.borderSubtle}`,
        borderRadius: 8,
        overflow: 'hidden',
        background: WF_TOKEN.surfaceBase,
      }}
    >
      <div
        style={{
          padding: '4px 8px',
          background: WF_TOKEN.surface,
          fontSize: 9,
          color: WF_TOKEN.textMuted,
        }}
      >
        {title}
      </div>
      <pre
        style={{
          margin: 0,
          padding: '4px 8px',
          maxHeight: 88,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 10,
          color: WF_TOKEN.textDefault,
        }}
      >
        {text}
      </pre>
    </div>
  );
}

function WaterfallActionButton({
  label,
  title,
  ariaLabel,
  testId,
  disabled = false,
  onClick,
}: {
  label: string;
  title?: string;
  ariaLabel?: string;
  testId?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  const interactive = !disabled;

  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        height: 20,
        padding: '0 8px',
        borderRadius: 6,
        border: `1px solid ${interactive && (hovered || focused) ? WF_TOKEN.borderEmphasis : WF_TOKEN.borderSubtle}`,
        background: !interactive
          ? WF_TOKEN.surface
          : pressed
            ? WF_TOKEN.pressedBg
            : hovered
              ? WF_TOKEN.hoverBg
              : WF_TOKEN.surface,
        color: interactive && hovered ? WF_TOKEN.textStrong : WF_TOKEN.textDefault,
        fontSize: 9.5,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        cursor: interactive ? 'pointer' : 'not-allowed',
        opacity: interactive ? 1 : 0.5,
        outline: focused ? `2px solid ${WF_TOKEN.accent}` : 'none',
        outlineOffset: 2,
        boxShadow: focused ? `0 0 0 4px ${WF_TOKEN.focusRing}` : 'none',
        transition:
          'background 100ms cubic-bezier(0.4, 0, 0.2, 1), border-color 100ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {label}
    </button>
  );
}

function WaterfallNotice({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div
      data-testid="waterfall-notice"
      style={{
        margin: 16,
        padding: '24px 16px',
        textAlign: 'center',
        border: `1px dashed ${WF_TOKEN.borderEmphasis}`,
        borderRadius: 12,
        background: WF_TOKEN.surface,
      }}
    >
      <span
        aria-hidden="true"
        style={{ display: 'inline-flex', color: WF_TOKEN.textSubtle, opacity: 0.6 }}
      >
        {icon}
      </span>
      <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: WF_TOKEN.textStrong }}>
        {title}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 11,
          lineHeight: 1.6,
          color: WF_TOKEN.textMuted,
          maxWidth: 320,
          marginInline: 'auto',
        }}
      >
        {description}
      </div>
    </div>
  );
}

function WaterfallSkeleton() {
  return (
    <div
      data-testid="waterfall-loading"
      aria-busy="true"
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        flex: 1,
        minHeight: 0,
      }}
    >
      <span style={{ fontSize: 10, color: WF_TOKEN.textMuted }}>正在等待网络事件…</span>
      {[0, 1, 2, 3].map((index) => (
        <span key={index} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span
            style={{
              display: 'block',
              width: `${55 + index * 9}%`,
              height: 8,
              borderRadius: 4,
              background: WF_TOKEN.surfaceRaised,
            }}
          />
          <span
            style={{
              display: 'block',
              width: `${88 - index * 12}%`,
              height: 10,
              borderRadius: 4,
              background: WF_TOKEN.surfaceRaised,
            }}
          />
        </span>
      ))}
    </div>
  );
}

function WaterfallActivityIcon() {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </svg>
  );
}

function WaterfallOffIcon() {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

// ── 非导出辅助 ──────────────────────────────────────────────────────────

function collectWaterfallRows(entries: readonly ConsoleEntry[]): WaterfallRow[] {
  const rows: WaterfallRow[] = [];
  for (const entry of entries) {
    const network = entry.network;
    if (entry.level !== 'network' || network === undefined) continue;
    rows.push({ entry, network, statusClass: classifyNetworkStatus(network) });
  }
  return rows;
}

/** 出现过的资源类型（去重并按字典序）；iframe 注入路径没有该字段时返回空数组。 */
function collectResourceTypes(rows: readonly WaterfallRow[]): string[] {
  const types = new Set<string>();
  for (const row of rows) {
    const type = row.network.resourceType;
    if (typeof type === 'string' && type.length > 0) types.add(type);
  }
  return [...types].sort();
}

/** 行内展示用目标：去掉 scheme，保留 host + path（完整 URL 在 title / 详情里）。 */
function toDisplayTarget(url: string): string {
  const schemeEnd = url.indexOf('://');
  return schemeEnd < 0 ? url : url.slice(schemeEnd + 3);
}

function formatStatusLabel(row: WaterfallRow): string {
  if (typeof row.network.status === 'number') return String(row.network.status);
  return row.statusClass === 'failed' ? '失败' : '—';
}
