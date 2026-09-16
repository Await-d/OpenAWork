/**
 * 控制台条目的可展开调用栈区块。
 *
 * 折叠态只占一行（`堆栈 · N 帧`），展开后逐帧展示：优先 source map 解析出的
 * 源码位置，未映射的帧回落打包后位置并带「未映射」标记——不会把 bundle URL
 * 伪装成源码路径。每帧提供 `文件:行:列` 的复制入口（没有编辑器深链集成，不发明跳转）。
 *
 * 样式全部内联 + E · Nebula token（带 `currentColor` 兜底，原因见 `BrowserPill`）：
 * 本组件可能在尚未加载应用 token 表的宿主里渲染（验收 harness / 独立预览）。
 * hover / pressed / focus 由 React state 驱动，键盘可达性由原生 `button` 提供。
 */

import { useId, useState } from 'react';
import type { ConsoleStackFrameView, ConsoleStackView } from './browser-console-stack.js';
import { CONSOLE_STACK_UNMAPPED_LABEL } from './browser-console-stack.js';

const TOKEN = {
  hoverBg: 'var(--bg-hover, color-mix(in oklch, currentColor 10%, transparent))',
  pressedBg: 'var(--bg-active, color-mix(in oklch, currentColor 14%, transparent))',
  surface: 'var(--bg-overlay, color-mix(in oklch, currentColor 6%, transparent))',
  textStrong: 'var(--fg-strong, currentColor)',
  textDefault: 'var(--fg-default, currentColor)',
  textMuted: 'var(--fg-muted, color-mix(in oklch, currentColor 70%, transparent))',
  textSubtle: 'var(--fg-subtle, color-mix(in oklch, currentColor 52%, transparent))',
  borderSubtle: 'var(--border-subtle, color-mix(in oklch, currentColor 14%, transparent))',
  borderEmphasis: 'var(--border-emphasis, color-mix(in oklch, currentColor 32%, transparent))',
  accent: 'var(--accent, currentColor)',
  focusRing: 'var(--accent-subtle, color-mix(in oklch, currentColor 10%, transparent))',
} as const;

const TRANSITION =
  'background 100ms cubic-bezier(0.4, 0, 0.2, 1), border-color 100ms cubic-bezier(0.4, 0, 0.2, 1), color 100ms cubic-bezier(0.4, 0, 0.2, 1)';

export interface ConsoleStackSectionProps {
  /** 纯格式化后的视图（由 `buildConsoleStackView` 产出，保证至少一帧）。 */
  view: ConsoleStackView;
  /** 复制单帧完整 `文件:行:列`；回执由调用方（条目行）统一展示。 */
  onCopyFrame: (location: string) => void;
}

export function ConsoleStackSection({ view, onCopyFrame }: ConsoleStackSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  const panelId = useId();

  return (
    <div style={{ padding: '0 8px 4px 32px' }}>
      <button
        type="button"
        data-testid="console-stack-toggle"
        data-mapped={view.hasMappedFrames ? 'true' : 'false'}
        aria-expanded={expanded}
        aria-controls={panelId}
        title={
          view.hasMappedFrames
            ? `调用栈（${view.total} 帧，已映射到源码）`
            : `调用栈（${view.total} 帧，未映射到源码）`
        }
        onClick={() => setExpanded((value) => !value)}
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
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          height: 18,
          padding: '0 8px',
          borderRadius: 6,
          border: `1px solid ${
            hovered || pressed ? TOKEN.borderEmphasis : TOKEN.borderSubtle
          }`,
          background: pressed ? TOKEN.pressedBg : hovered ? TOKEN.hoverBg : 'transparent',
          color: hovered || pressed ? TOKEN.textDefault : TOKEN.textMuted,
          fontFamily: 'inherit',
          fontSize: 9.5,
          fontWeight: 500,
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          outline: focused ? `2px solid ${TOKEN.accent}` : 'none',
          outlineOffset: 2,
          boxShadow: focused ? `0 0 0 4px ${TOKEN.focusRing}` : 'none',
          transition: TRANSITION,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 8 }}>
          {expanded ? '▾' : '▸'}
        </span>
        {`堆栈 · ${view.total} 帧`}
      </button>

      {expanded ? (
        <div
          id={panelId}
          data-testid="console-stack-panel"
          role="list"
          aria-label="调用栈帧"
          style={{
            marginTop: 4,
            border: `1px solid ${TOKEN.borderSubtle}`,
            borderRadius: 6,
            background: TOKEN.surface,
            overflow: 'visible',
          }}
        >
          {view.frames.map((frame) => (
            <StackFrameRow
              key={frame.ordinal}
              frame={frame}
              last={frame.ordinal === view.frames.length}
              onCopyFrame={onCopyFrame}
            />
          ))}
          {view.hiddenCount > 0 ? (
            <div
              data-testid="console-stack-hidden"
              style={{ padding: '4px 8px', fontSize: 9, color: TOKEN.textSubtle }}
            >
              {`…另有 ${view.hiddenCount} 帧未展示`}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StackFrameRow({
  frame,
  last,
  onCopyFrame,
}: {
  frame: ConsoleStackFrameView;
  last: boolean;
  onCopyFrame: (location: string) => void;
}) {
  return (
    <div
      role="listitem"
      data-testid="console-stack-frame"
      data-unmapped={frame.unmapped ? 'true' : 'false'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        borderBottom: last ? undefined : `1px solid ${TOKEN.borderSubtle}`,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 14,
          flexShrink: 0,
          textAlign: 'right',
          fontSize: 9,
          color: TOKEN.textSubtle,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {frame.ordinal}
      </span>
      {frame.functionName !== null ? (
        <span
          title={frame.functionName}
          style={{
            flexShrink: 0,
            maxWidth: 140,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 10,
            fontWeight: 600,
            color: TOKEN.textStrong,
          }}
        >
          {frame.functionName}
        </span>
      ) : null}
      <span
        data-testid="console-stack-location"
        title={frame.location}
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 10.5,
          color: frame.unmapped ? TOKEN.textMuted : TOKEN.textDefault,
        }}
      >
        {frame.displayLocation}
      </span>
      {frame.unmapped ? (
        <span
          data-testid="console-stack-unmapped"
          style={{
            flexShrink: 0,
            padding: '0 4px',
            borderRadius: 4,
            border: `1px solid ${TOKEN.borderSubtle}`,
            color: TOKEN.textSubtle,
            fontSize: 8.5,
            lineHeight: 1.6,
          }}
        >
          {CONSOLE_STACK_UNMAPPED_LABEL}
        </span>
      ) : null}
      <span style={{ flex: 1 }} />
      <StackCopyButton location={frame.location} onCopy={onCopyFrame} />
    </div>
  );
}

function StackCopyButton({
  location,
  onCopy,
}: {
  location: string;
  onCopy: (location: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <button
      type="button"
      data-testid="console-stack-frame-copy"
      title={`复制 ${location}`}
      onClick={() => onCopy(location)}
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
        flexShrink: 0,
        height: 16,
        padding: '0 8px',
        borderRadius: 4,
        border: `1px solid ${hovered || pressed ? TOKEN.borderEmphasis : TOKEN.borderSubtle}`,
        background: pressed ? TOKEN.pressedBg : hovered ? TOKEN.hoverBg : 'transparent',
        color: hovered || pressed ? TOKEN.textDefault : TOKEN.textMuted,
        fontFamily: 'inherit',
        fontSize: 9,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        outline: focused ? `2px solid ${TOKEN.accent}` : 'none',
        outlineOffset: 2,
        boxShadow: focused ? `0 0 0 4px ${TOKEN.focusRing}` : 'none',
        transition: TRANSITION,
      }}
    >
      复制位置
    </button>
  );
}
