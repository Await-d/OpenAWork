/**
 * 检查器右侧的详情面板：DOM 节点详情与无障碍节点详情。
 *
 * DOM 详情的计算样式默认只展示「值得看」的声明（451 条裸 dump 没人能读），
 * 并提供关键字筛选与「显示全部」开关；筛选规则在
 * `buildInspectorStyleView` 里，本文件只负责渲染与交互状态。
 *
 * 无障碍详情把状态（focused / disabled / expanded / selected / checked …）渲染成
 * 芯片：布尔状态一定显式给出（`false` 也是信息）。
 */

import { useState } from 'react';
import type { BrowserLiveA11yNode } from '@openAwork/shared';
import {
  buildInspectorStyleView,
  describeA11yStateChips,
  toInspectorInline,
} from './browser-inspector-model.js';
import type { InspectorNodeDetail } from './browser-inspector-model.js';
import {
  InspectorActionButton,
  InspectorChip,
  InspectorDomIcon,
  InspectorSearchIcon,
} from './browser-inspector-chrome.js';
import { BrowserPill } from './browser-pill.js';
import { INSPECTOR_TOKEN } from './browser-inspector-tokens.js';

const NODE_TEXT_MAX_CHARS = 400;

const SECTION_TITLE_STYLE = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: INSPECTOR_TOKEN.textSubtle,
} as const;

const MONO_ROW_STYLE = {
  display: 'grid',
  gridTemplateColumns: 'minmax(96px, 40%) 1fr',
  gap: 8,
  padding: '2px 8px',
  fontFamily: INSPECTOR_TOKEN.mono,
  fontSize: 10,
  lineHeight: 1.6,
  borderBottom: `1px solid ${INSPECTOR_TOKEN.borderSubtle}`,
} as const;

// ── DOM 节点详情 ───────────────────────────────────────────────────────

export interface InspectorNodeDetailPaneProps {
  detail: InspectorNodeDetail;
  /** 最近一次拾取坐标是否已知（决定「获取完整样式」能否直接下发）。 */
  canRequestFullStyles: boolean;
  fullStylesBusy: boolean;
  unavailable: boolean;
  onRequestFullStyles: () => void;
  onArmPick: () => void;
}

export function InspectorNodeDetailPane({
  detail,
  canRequestFullStyles,
  fullStylesBusy,
  unavailable,
  onRequestFullStyles,
  onArmPick,
}: InspectorNodeDetailPaneProps) {
  const attributes = Object.entries(detail.attributes);
  const text = toInspectorInline(detail.text, NODE_TEXT_MAX_CHARS + 1);
  const styles = detail.styles;

  return (
    <div data-testid="inspector-node-detail" style={{ padding: '8px 0 16px' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          padding: '0 8px 8px',
        }}
      >
        <span
          data-testid="inspector-node-tag"
          style={{ fontFamily: INSPECTOR_TOKEN.mono, fontSize: 12, color: INSPECTOR_TOKEN.accent }}
        >
          {`<${detail.nodeName.trim().toLowerCase()}>`}
        </span>
        {detail.fromPick ? (
          <InspectorChip
            label={detail.fullStyles ? '完整样式' : '拾取样式'}
            tone={detail.fullStyles ? 'success' : 'info'}
            testId="inspector-styles-source"
          />
        ) : null}
        {detail.selectorAmbiguous ? (
          <InspectorChip
            label="选择器可能不唯一"
            tone="warning"
            testId="inspector-selector-warning"
          />
        ) : null}
      </div>

      {detail.selector !== null ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '0 8px 8px',
            minWidth: 0,
          }}
        >
          <span style={{ ...SECTION_TITLE_STYLE, paddingTop: 2 }}>选择器</span>
          <code
            data-testid="inspector-selector"
            title={detail.selector}
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: INSPECTOR_TOKEN.mono,
              fontSize: 10,
              color: INSPECTOR_TOKEN.textDefault,
              wordBreak: 'break-all',
            }}
          >
            {detail.selector}
          </code>
        </div>
      ) : null}

      {detail.selectorStrategy !== null ? (
        <div style={{ padding: '0 8px 8px', fontSize: 9.5, color: INSPECTOR_TOKEN.textSubtle }}>
          {`推导方式：${detail.selectorStrategy}`}
        </div>
      ) : null}

      <section style={{ padding: '0 0 8px' }}>
        <div style={{ ...SECTION_TITLE_STYLE, padding: '4px 8px' }}>
          {`属性（${attributes.length}）`}
        </div>
        {attributes.length === 0 ? (
          <div
            data-testid="inspector-attributes-empty"
            style={{ padding: '2px 8px', fontSize: 10, color: INSPECTOR_TOKEN.textSubtle }}
          >
            该元素没有任何属性。
          </div>
        ) : (
          attributes.map(([name, value]) => (
            <div key={name} data-testid="inspector-attribute-row" style={MONO_ROW_STYLE}>
              <span style={{ color: INSPECTOR_TOKEN.aux, wordBreak: 'break-all' }}>{name}</span>
              <span style={{ color: INSPECTOR_TOKEN.textStrong, wordBreak: 'break-all' }}>
                {value}
              </span>
            </div>
          ))
        )}
      </section>

      {text.length > 0 ? (
        <section style={{ padding: '0 0 8px' }}>
          <div style={{ ...SECTION_TITLE_STYLE, padding: '4px 8px' }}>文本</div>
          <div
            data-testid="inspector-node-text"
            style={{
              padding: '2px 8px',
              fontFamily: INSPECTOR_TOKEN.mono,
              fontSize: 10,
              lineHeight: 1.6,
              color: INSPECTOR_TOKEN.textDefault,
              wordBreak: 'break-word',
            }}
          >
            {text.length > NODE_TEXT_MAX_CHARS
              ? `${text.slice(0, NODE_TEXT_MAX_CHARS)}…（已截断）`
              : text}
          </div>
        </section>
      ) : null}

      <ComputedStylesSection
        styles={styles}
        fullStyles={detail.fullStyles}
        canRequestFullStyles={canRequestFullStyles}
        busy={fullStylesBusy}
        unavailable={unavailable}
        onRequestFullStyles={onRequestFullStyles}
        onArmPick={onArmPick}
      />
    </div>
  );
}

// ── 计算样式 ───────────────────────────────────────────────────────────

function ComputedStylesSection({
  styles,
  fullStyles,
  canRequestFullStyles,
  busy,
  unavailable,
  onRequestFullStyles,
  onArmPick,
}: {
  styles: Record<string, string> | null;
  fullStyles: boolean;
  canRequestFullStyles: boolean;
  busy: boolean;
  unavailable: boolean;
  onRequestFullStyles: () => void;
  onArmPick: () => void;
}) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const view = styles === null ? null : buildInspectorStyleView(styles, { query, showAll });

  return (
    <section>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
        }}
      >
        <span style={SECTION_TITLE_STYLE}>计算样式</span>
        {view !== null ? (
          <span
            data-testid="inspector-styles-summary"
            style={{ fontSize: 9.5, color: INSPECTOR_TOKEN.textMuted }}
          >
            {view.searching
              ? `匹配 ${view.rows.length} / ${view.total} 条`
              : `共 ${view.total} 条 · 默认视图 ${view.notableCount} 条（隐藏 ${view.hiddenCount} 条默认声明）`}
          </span>
        ) : null}
        <div style={{ flex: 1 }} />
        <InspectorActionButton
          label={busy ? '读取中…' : fullStyles ? '重新获取完整样式' : '获取完整样式'}
          title={
            canRequestFullStyles
              ? '按最近一次拾取的位置重新请求该元素的全部计算样式（node.styles）'
              : '先在页面中拾取元素：检查器需要拾取坐标才能请求完整样式'
          }
          testId="inspector-full-styles"
          disabled={unavailable || busy || !canRequestFullStyles}
          busy={busy}
          onClick={onRequestFullStyles}
        />
      </div>

      {view === null ? (
        <div data-testid="inspector-styles-empty" style={{ padding: '4px 8px' }}>
          <div style={{ fontSize: 10, lineHeight: 1.6, color: INSPECTOR_TOKEN.textMuted }}>
            还没有该元素的样式数据。用「在页面中拾取」选中元素，或对已拾取的元素请求完整样式。
          </div>
          <div style={{ marginTop: 8 }}>
            <InspectorActionButton
              label="在页面中拾取"
              title="在预览画面上点击目标元素"
              testId="inspector-styles-pick"
              disabled={unavailable}
              onClick={onArmPick}
            />
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 8px 4px',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                flex: 1,
                minWidth: 120,
                height: 20,
                padding: '0 8px',
                borderRadius: INSPECTOR_TOKEN.radiusSm,
                border: `1px solid ${INSPECTOR_TOKEN.borderSubtle}`,
                background: INSPECTOR_TOKEN.surface,
                color: INSPECTOR_TOKEN.textSubtle,
              }}
            >
              <InspectorSearchIcon />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="筛选样式（属性或值）"
                aria-label="筛选计算样式"
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 18,
                  border: 'none',
                  background: 'transparent',
                  color: INSPECTOR_TOKEN.textDefault,
                  fontSize: 9.5,
                  outline: 'none',
                }}
              />
            </span>
            <BrowserPill
              label="显示全部"
              title="显示全部计算样式（含默认值与厂商前缀属性）"
              active={showAll}
              onClick={() => setShowAll((value) => !value)}
              testId="inspector-styles-show-all"
              size="sm"
            />
          </div>

          {view.rows.length === 0 ? (
            <div
              data-testid="inspector-styles-no-match"
              style={{ padding: '4px 8px', fontSize: 10, color: INSPECTOR_TOKEN.textMuted }}
            >
              {view.searching
                ? '没有匹配的样式声明，换个关键字试试。'
                : '未发现非默认声明；切换「显示全部」可以看到该元素的全部计算样式。'}
            </div>
          ) : (
            <div data-testid="inspector-styles-table" style={{ overflowX: 'hidden' }}>
              {view.rows.map((row) => (
                <div
                  key={row.property}
                  data-testid="inspector-style-row"
                  data-property={row.property}
                  data-notable={row.notable}
                  style={MONO_ROW_STYLE}
                >
                  <span style={{ color: INSPECTOR_TOKEN.aux, wordBreak: 'break-all' }}>
                    {row.property}
                  </span>
                  <span style={{ color: INSPECTOR_TOKEN.textStrong, wordBreak: 'break-all' }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── 无障碍节点详情 ─────────────────────────────────────────────────────

export function InspectorA11yDetailPane({ node }: { node: BrowserLiveA11yNode | null }) {
  if (node === null) {
    return (
      <div style={{ padding: '8px' }}>
        <InspectorEmptyDetail
          title="未选择无障碍节点"
          description="在左侧树中选择一个节点，查看它的 role / 名称 / 值以及状态。"
        />
      </div>
    );
  }

  const chips = describeA11yStateChips(node);
  const facts: Array<[string, string]> = [
    ['role', node.role.length > 0 ? node.role : '—'],
    ['name', toInspectorInline(node.name, 240) || '—'],
    ['value', node.value === undefined ? '—' : toInspectorInline(node.value, 240) || '—'],
    ['description', toInspectorInline(node.description ?? '', 240) || '—'],
    ['ignored', node.ignored ? '是' : '否'],
  ];
  if (typeof node.level === 'number') facts.push(['level', String(node.level)]);

  return (
    <div data-testid="inspector-a11y-detail" style={{ padding: '8px 0 16px' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 4,
          padding: '0 8px 8px',
        }}
      >
        {chips.length === 0 ? (
          <span style={{ fontSize: 9.5, color: INSPECTOR_TOKEN.textSubtle }}>无状态标记</span>
        ) : (
          chips.map((chip) => (
            <InspectorChip
              key={chip.key}
              label={chip.label}
              tone={chip.tone}
              testId={`inspector-a11y-chip-${chip.key}`}
            />
          ))
        )}
      </div>
      <div style={{ ...SECTION_TITLE_STYLE, padding: '4px 8px' }}>属性</div>
      {facts.map(([name, value]) => (
        <div key={name} data-testid="inspector-a11y-fact" style={MONO_ROW_STYLE}>
          <span style={{ color: INSPECTOR_TOKEN.aux }}>{name}</span>
          <span style={{ color: INSPECTOR_TOKEN.textStrong, wordBreak: 'break-word' }}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function InspectorEmptyDetail({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      data-testid="inspector-detail-empty"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: '24px 16px',
        textAlign: 'center',
        border: `1px dashed ${INSPECTOR_TOKEN.borderSubtle}`,
        borderRadius: INSPECTOR_TOKEN.radiusLg,
        background: INSPECTOR_TOKEN.surfaceBase,
      }}
    >
      <span aria-hidden="true" style={{ color: INSPECTOR_TOKEN.textSubtle, opacity: 0.6 }}>
        <InspectorDomIcon size={24} />
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color: INSPECTOR_TOKEN.textStrong }}>
        {title}
      </span>
      <span
        style={{
          fontSize: 10.5,
          lineHeight: 1.6,
          color: INSPECTOR_TOKEN.textMuted,
          maxWidth: 300,
        }}
      >
        {description}
      </span>
    </div>
  );
}
