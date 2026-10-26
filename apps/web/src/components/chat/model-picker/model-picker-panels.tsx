import React, { type CSSProperties } from 'react';
import {
  REASONING_EFFORT_RANK,
  describeReasoningEffort,
  getSupportedReasoningEffortsForModel,
  inferSupportsThinking,
  resolveProviderVisual,
  sortSupportedReasoningEfforts,
} from '@openAwork/shared-ui';
import type { ModelReasoningOption } from '@openAwork/shared-ui';
import type { ReasoningEffort } from '../../conversation-runtime/messages/support.js';
import { buildFilteredModelGroups, type ModelPickerProvider } from './model-picker-search.js';
import { formatReasoningEffortLabel } from '../composer/reasoning-effort-label.js';

export { ModelSettingsPopover } from './model-settings-popover.js';
import {
  CONTEXT_WINDOW_PRESETS,
  RefreshIcon,
  THINKING_INTENSITY,
  CapabilityTag,
  formatContextWindow,
  resolveFloatingPanelPosition,
  sameContextWindow,
} from './model-picker-utils.js';

export function ModelPicker({
  anchorRef,
  providers,
  activeProviderId,
  activeModelId,
  onSelect,
  onClose,
  onRefresh,
  refreshing = false,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  providers: ModelPickerProvider[];
  activeProviderId: string;
  activeModelId: string;
  onSelect: (providerId: string, modelId: string) => Promise<void> | void;
  onClose: () => void;
  /**
   * 重新拉取 Provider / 模型目录。
   *
   * 弹层拿到的 `providers` 是宿主页面进页面时抓取的快照：用户在设置页增删模型、
   * 启停 Provider 或切换模型开关后，如果不重载整页，这里始终显示旧目录。提供该
   * 回调后弹层会渲染一个「刷新」按钮，让用户当场把目录拉成最新。
   */
  onRefresh?: () => void | Promise<void>;
  /** 目录刷新进行中：按钮转为旋转态并禁止重复触发。 */
  refreshing?: boolean;
}) {
  const [search, setSearch] = React.useState('');
  const groups = React.useMemo(
    () => buildFilteredModelGroups(providers, search),
    [providers, search],
  );
  const firstVisibleModelKey = React.useMemo(() => {
    const firstGroup = groups[0];
    const firstModel = firstGroup?.models[0];
    return firstGroup && firstModel ? `${firstGroup.provider.id}:${firstModel.id}` : null;
  }, [groups]);
  const [top, setTop] = React.useState(0);
  const [left, setLeft] = React.useState(0);
  const [maxHeight, setMaxHeight] = React.useState(430);
  const [transformOrigin, setTransformOrigin] = React.useState<
    'top left' | 'top center' | 'top right' | 'bottom left' | 'bottom center' | 'bottom right'
  >('bottom right');
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const listboxRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const titleId = React.useId();

  React.useLayoutEffect(() => {
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Composer sits at the bottom of the viewport, so prefer opening
      // above the button. Width 420 keeps long model labels readable.
      // Composer button is at the bottom-left; open above and align the
      // panel's right edge to the toolbar's right side so it grows
      // leftward/upward naturally from the button area.
      const next = resolveFloatingPanelPosition(rect, 400, 460, 'end', true);
      setTop(next.top);
      setLeft(next.left);
      setMaxHeight(next.maxHeight);
      setTransformOrigin(next.transformOrigin);
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef]);

  React.useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'Tab') {
        const focusables = Array.from(
          panelRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
          ) ?? [],
        );
        if (focusables.length === 0) {
          return;
        }
        const active =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const currentIndex = active ? focusables.indexOf(active) : -1;
        const nextIndex = event.shiftKey
          ? currentIndex <= 0
            ? focusables.length - 1
            : currentIndex - 1
          : currentIndex === -1 || currentIndex === focusables.length - 1
            ? 0
            : currentIndex + 1;
        event.preventDefault();
        focusables[nextIndex]?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [onClose]);

  const moveFocus = React.useCallback((direction: 'next' | 'prev' | 'start' | 'end') => {
    const buttons = Array.from(
      listboxRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    if (buttons.length === 0) return;
    const active =
      document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    const currentIndex = active ? buttons.indexOf(active) : -1;

    let nextIndex = 0;
    if (direction === 'start') {
      nextIndex = 0;
    } else if (direction === 'end') {
      nextIndex = buttons.length - 1;
    } else if (direction === 'next') {
      nextIndex = currentIndex >= 0 ? (currentIndex + 1) % buttons.length : 0;
    } else {
      nextIndex =
        currentIndex >= 0
          ? (currentIndex - 1 + buttons.length) % buttons.length
          : buttons.length - 1;
    }

    buttons[nextIndex]?.focus();
  }, []);

  const handleOptionKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveFocus('next');
          break;
        case 'ArrowUp':
          event.preventDefault();
          moveFocus('prev');
          break;
        case 'Home':
          event.preventDefault();
          moveFocus('start');
          break;
        case 'End':
          event.preventDefault();
          moveFocus('end');
          break;
        case ' ':
          event.preventDefault();
          event.currentTarget.click();
          break;
        default:
          break;
      }
    },
    [moveFocus],
  );

  const handleSearchKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveFocus('next');
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveFocus('end');
      }
    },
    [moveFocus],
  );

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2000 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="chat-model-settings-close"
        aria-label="关闭"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'default',
          width: '100%',
          height: '100%',
        }}
      />
      <div
        id="chat-model-picker-dialog"
        ref={panelRef}
        style={{
          position: 'absolute',
          top,
          left,
          zIndex: 1,
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          padding: 0,
          boxShadow: 'var(--shadow-lg)',
          minWidth: 340,
          width: 400,
          maxWidth: 'min(400px, calc(100vw - 16px))',
          maxHeight,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transformOrigin,
          animation: 'chat-model-picker-enter 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <style>{`
          @keyframes chat-model-picker-enter {
            from { opacity: 0; transform: scale(0.96) translateY(4px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
          }
          .chat-model-picker-option {
            transition: background 100ms ease, color 100ms ease;
          }
          .chat-model-picker-option:hover:not([aria-selected="true"]) {
            background: color-mix(in oklch, var(--accent) 6%, transparent);
          }
          .chat-model-picker-search-shell:focus-within {
            border-color: color-mix(in oklch, var(--accent) 50%, var(--border-default));
            box-shadow: 0 0 0 2px color-mix(in oklch, var(--accent) 14%, transparent);
          }
          .chat-model-picker-scroll::-webkit-scrollbar { width: 5px; }
          .chat-model-picker-scroll::-webkit-scrollbar-track { background: transparent; }
          .chat-model-picker-scroll::-webkit-scrollbar-thumb {
            background: var(--scrollbar-thumb);
            border-radius: 999px;
          }
          .chat-model-picker-scroll::-webkit-scrollbar-thumb:hover {
            background: var(--scrollbar-thumb-hover);
          }
          .chat-model-picker-refresh {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            padding: 0;
            border-radius: 6px;
            border: 1px solid var(--border-subtle);
            background: transparent;
            color: var(--fg-muted);
            cursor: pointer;
            flex-shrink: 0;
            transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
          }
          .chat-model-picker-refresh:hover:not(:disabled) {
            color: var(--accent);
            background: color-mix(in oklch, var(--accent) 10%, transparent);
            border-color: color-mix(in oklch, var(--accent) 35%, var(--border-subtle));
          }
          .chat-model-picker-refresh:active:not(:disabled) {
            background: color-mix(in oklch, var(--accent) 18%, transparent);
          }
          .chat-model-picker-refresh:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 1px;
          }
          .chat-model-picker-refresh:disabled {
            cursor: default;
            opacity: 0.7;
          }
          .chat-model-picker-refresh[data-refreshing='true'] svg {
            animation: chat-model-picker-refresh-spin 700ms linear infinite;
          }
          @keyframes chat-model-picker-refresh-spin {
            from { transform: rotate(0deg); }
            to   { transform: rotate(360deg); }
          }
          @media (prefers-reduced-motion: reduce) {
            .chat-model-picker-refresh[data-refreshing='true'] svg { animation: none; }
          }
        `}</style>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px 8px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div
            id={titleId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--fg-strong)',
              letterSpacing: '0.01em',
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ color: 'var(--accent)', flexShrink: 0 }}
            >
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            选择模型
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexShrink: 0,
            }}
          >
            {onRefresh ? (
              <button
                type="button"
                className="chat-model-picker-refresh"
                aria-label={refreshing ? '正在刷新模型列表' : '刷新模型列表'}
                title={refreshing ? '正在刷新…' : '刷新模型列表'}
                disabled={refreshing}
                data-refreshing={refreshing ? 'true' : 'false'}
                onClick={() => {
                  void onRefresh();
                }}
              >
                <RefreshIcon />
              </button>
            ) : null}
            <span
              style={{
                fontSize: 10,
                color: 'var(--fg-muted)',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {refreshing
                ? '刷新中…'
                : `${groups.reduce((sum, g) => sum + g.models.length, 0)} 个可用`}
            </span>
          </div>
        </div>
        {/* Search */}
        <div style={{ padding: '8px 14px 8px' }}>
          <div
            className="chat-model-picker-search-shell"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              height: 32,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-base)',
              padding: '0 10px',
              transition: 'border-color 120ms ease, box-shadow 120ms ease',
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ color: 'var(--fg-muted)', flexShrink: 0 }}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={inputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              aria-label="搜索模型"
              placeholder="搜索模型…"
              style={{
                flex: 1,
                minWidth: 0,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--fg-strong)',
                fontSize: 12.5,
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="清除搜索"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  border: 'none',
                  background: 'var(--border-subtle)',
                  color: 'var(--fg-muted)',
                  cursor: 'pointer',
                  flexShrink: 0,
                  fontSize: 10,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>
        {/* List */}
        <div
          ref={listboxRef}
          role="listbox"
          aria-label="模型列表"
          className="chat-model-picker-scroll"
          style={{
            overflowY: 'auto',
            padding: '0 0 8px',
            flex: 1,
            overscrollBehavior: 'contain',
          }}
        >
          {groups.length === 0 && (
            <div
              style={{
                padding: '28px 20px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{ color: 'var(--fg-muted)', opacity: 0.5 }}
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
                <path d="M8 11h6" />
              </svg>
              <span style={{ color: 'var(--fg-default)', fontWeight: 600, fontSize: 12.5 }}>
                未匹配到模型
              </span>
              <span style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.5 }}>
                试试提供商名、模型别名（如 sonnet / 4o / qwen）或模型 ID
              </span>
            </div>
          )}
          {groups.map(({ provider, models }) => {
            const providerVisual = resolveProviderVisual({
              providerType: provider.type,
              providerId: provider.id,
              providerName: provider.name,
            });
            return (
              <div key={provider.id}>
                {/* Provider header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 14px 4px',
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      background: 'var(--bg-base)',
                      border: '1px solid var(--border-subtle)',
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      fontWeight: 700,
                      color: 'var(--fg-muted)',
                      flexShrink: 0,
                    }}
                  >
                    {providerVisual.logoUrl ? (
                      <img
                        src={providerVisual.logoUrl}
                        alt={provider.name}
                        width={12}
                        height={12}
                        style={{
                          objectFit: 'contain',
                          filter: 'var(--provider-logo-filter, none)',
                        }}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <span>{providerVisual.fallbackGlyph ?? provider.type.slice(0, 2)}</span>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'var(--fg-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {provider.name}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      color: 'var(--fg-subtle)',
                      fontWeight: 500,
                    }}
                  >
                    {models.length}
                  </span>
                </div>
                {/* Model options */}
                {models.map((model) => {
                  const isActive = provider.id === activeProviderId && model.id === activeModelId;
                  const optionKey = `${provider.id}:${model.id}`;
                  const contextLabel = formatContextWindow(model.contextWindow);
                  return (
                    <button
                      role="option"
                      aria-selected={isActive}
                      className="chat-model-picker-option"
                      tabIndex={isActive || optionKey === firstVisibleModelKey ? 0 : -1}
                      key={model.id}
                      type="button"
                      onKeyDown={handleOptionKeyDown}
                      onClick={() => {
                        void onSelect(provider.id, model.id);
                        onClose();
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        width: 'calc(100% - 8px)',
                        padding: '5px 10px',
                        border: 'none',
                        background: isActive ? 'var(--accent-muted)' : 'transparent',
                        color: isActive ? 'var(--accent)' : 'var(--fg-strong)',
                        fontSize: 12,
                        cursor: 'pointer',
                        textAlign: 'left',
                        borderRadius: 7,
                        margin: '1px 4px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                      }}
                    >
                      <span
                        style={{
                          width: 16,
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
                          flexShrink: 0,
                        }}
                      >
                        {isActive ? (
                          <svg
                            width="9"
                            height="9"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg
                            width="9"
                            height="9"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                            style={{ opacity: 0.35 }}
                          >
                            <circle cx="12" cy="12" r="8" />
                          </svg>
                        )}
                      </span>
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontWeight: 600,
                          fontSize: 12,
                          flexShrink: 1,
                          minWidth: 0,
                        }}
                      >
                        {model.name}
                      </span>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                          flexShrink: 0,
                          marginLeft: 'auto',
                        }}
                      >
                        {model.supportsVision && <CapabilityTag label="视觉" tone="emerald" />}
                        {model.supportsTools && <CapabilityTag label="工具" tone="accent" />}
                        {inferSupportsThinking(
                          provider.type,
                          model.id,
                          model.supportsThinking === true,
                        ) && <CapabilityTag label="思考" tone="violet" />}
                        {contextLabel && <CapabilityTag label={contextLabel} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
