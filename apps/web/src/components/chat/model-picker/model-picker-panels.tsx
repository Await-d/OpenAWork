import React from 'react';
import {
  describeReasoningEffort,
  getSupportedReasoningEffortsForModel,
  inferSupportsThinking,
  resolveProviderVisual,
} from '@openAwork/shared-ui';
import type { ReasoningEffort } from '../../conversation-runtime/messages/support.js';
import { buildFilteredModelGroups, type ModelPickerProvider } from './model-picker-search.js';

function formatContextWindow(value: number | undefined): string | null {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function CapabilityTag({
  label,
  tone = 'default',
}: {
  label: string;
  tone?: 'default' | 'accent' | 'emerald' | 'violet';
}) {
  const colorMap: Record<
    'default' | 'accent' | 'emerald' | 'violet',
    { bg: string; color: string }
  > = {
    default: { bg: 'var(--bg-overlay)', color: 'var(--fg-muted)' },
    accent: { bg: 'var(--accent-muted)', color: 'var(--accent)' },
    emerald: {
      bg: 'color-mix(in oklch, var(--success) 14%, transparent)',
      color: 'color-mix(in oklch, var(--success) 82%, var(--fg-on-accent) 18%)',
    },
    violet: {
      bg: 'color-mix(in oklch, var(--accent) 14%, transparent)',
      color: 'color-mix(in oklch, var(--accent) 78%, white 22%)',
    },
  };
  const style = colorMap[tone];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        padding: '0 7px',
        borderRadius: 999,
        background: style.bg,
        color: style.color,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  );
}

function resolveFloatingPanelPosition(
  anchorRect: DOMRect,
  width: number,
  maxDesiredHeight: number,
  align: 'start' | 'end',
  preferAbove = false,
) {
  const margin = 12;
  const gap = 6;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Horizontal: clamp panel within viewport
  const leftCandidate =
    align === 'start' ? anchorRect.left : Math.max(margin, anchorRect.right - width);
  const left = Math.min(
    Math.max(margin, leftCandidate),
    Math.max(margin, viewportWidth - width - margin),
  );

  const spaceBelow = viewportHeight - anchorRect.bottom - margin;
  const spaceAbove = anchorRect.top - margin;

  // Decide direction: prefer above when requested (composer is at bottom),
  // otherwise follow original space-based heuristic.
  const openAbove = preferAbove
    ? spaceAbove >= 160 || spaceAbove >= spaceBelow
    : spaceBelow >= Math.min(180, maxDesiredHeight) || spaceBelow >= spaceAbove;

  if (!openAbove) {
    // Open below
    const effectiveHeight = Math.max(160, Math.min(maxDesiredHeight, spaceBelow));
    return {
      left,
      top: Math.min(anchorRect.bottom + gap, viewportHeight - margin - effectiveHeight),
      maxHeight: effectiveHeight,
      transformOrigin: align === 'start' ? ('top left' as const) : ('top right' as const),
    };
  }

  // Open above
  const effectiveHeight = Math.max(160, Math.min(maxDesiredHeight, spaceAbove));
  return {
    left,
    top: Math.max(margin, anchorRect.top - effectiveHeight - gap),
    maxHeight: effectiveHeight,
    transformOrigin: align === 'start' ? ('bottom left' as const) : ('bottom right' as const),
  };
}

export function ModelPicker({
  anchorRef,
  providers,
  activeProviderId,
  activeModelId,
  onSelect,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  providers: ModelPickerProvider[];
  activeProviderId: string;
  activeModelId: string;
  onSelect: (providerId: string, modelId: string) => Promise<void> | void;
  onClose: () => void;
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
    'top left' | 'top right' | 'bottom left' | 'bottom right'
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
            background: var(--border-default);
            border-radius: 999px;
          }
          .chat-model-picker-scroll::-webkit-scrollbar-thumb:hover {
            background: var(--border-emphasis);
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
          <span
            style={{
              fontSize: 10,
              color: 'var(--fg-muted)',
              fontWeight: 500,
            }}
          >
            {groups.reduce((sum, g) => sum + g.models.length, 0)} 个可用
          </span>
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

export function ModelSettingsPopover({
  anchorRef,
  open,
  onClose,
  modelLabel,
  providerType,
  modelId,
  supportsThinking,
  canConfigureThinking,
  contextWindow,
  supportsTools,
  supportsVision,
  thinkingEnabled,
  reasoningEffort,
  onChangeThinkingEnabled,
  onChangeReasoningEffort,
  fastEnabled = false,
  onFastToggle,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
  modelLabel: string;
  providerType?: string;
  modelId?: string;
  supportsThinking: boolean;
  canConfigureThinking: boolean;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  onChangeThinkingEnabled: (value: boolean) => void;
  onChangeReasoningEffort: (value: ReasoningEffort) => void;
  fastEnabled?: boolean;
  onFastToggle?: (enabled: boolean) => Promise<void> | void;
}) {
  const [top, setTop] = React.useState(0);
  const [left, setLeft] = React.useState(0);
  const [maxHeight, setMaxHeight] = React.useState(320);
  const [transformOrigin, setTransformOrigin] = React.useState<
    'top left' | 'top right' | 'bottom left' | 'bottom right'
  >('bottom right');
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const [localFastEnabled, setLocalFastEnabled] = React.useState(fastEnabled);
  const effectiveFastEnabled = localFastEnabled;

  React.useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = resolveFloatingPanelPosition(rect, 320, 360, 'end', true);
      setLeft(next.left);
      setTop(next.top);
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
  }, [anchorRef, open]);

  React.useEffect(() => {
    if (!open) return;

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
            'button:not([disabled]), [tabindex="0"]',
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
    window.setTimeout(() => {
      const firstButton = panelRef.current?.querySelector<HTMLElement>('button:not([disabled])');
      firstButton?.focus();
    }, 0);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [onClose, open]);

  React.useEffect(() => {
    setLocalFastEnabled(fastEnabled);
  }, [fastEnabled]);

  if (!open) return null;

  const supportedEfforts = getSupportedReasoningEffortsForModel(providerType, modelId);
  const showFastSettings = providerType === 'openai';

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2000 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
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
        id="chat-model-settings-dialog"
        ref={panelRef}
        style={{
          position: 'absolute',
          top,
          left,
          zIndex: 1,
          minWidth: 300,
          width: 320,
          maxWidth: 'min(320px, calc(100vw - 16px))',
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-lg)',
          padding: 0,
          maxHeight,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transformOrigin,
          animation: 'chat-model-picker-enter 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <style>{`
          .chat-model-settings-option {
            transition: background 100ms ease, color 100ms ease;
          }
          .chat-model-settings-option:hover:not([disabled]):not(.is-active) {
            background: color-mix(in oklch, var(--accent) 6%, transparent) !important;
          }
          .chat-model-settings-scroll::-webkit-scrollbar { width: 5px; }
          .chat-model-settings-scroll::-webkit-scrollbar-track { background: transparent; }
          .chat-model-settings-scroll::-webkit-scrollbar-thumb {
            background: var(--border-default);
            border-radius: 999px;
          }
          .chat-model-settings-scroll::-webkit-scrollbar-thumb:hover {
            background: var(--border-emphasis);
          }
        `}</style>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 14px 8px',
            borderBottom: '1px solid var(--border-subtle)',
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
            <path
              d="M9.5 9a2.5 2.5 0 1 1 5 0c0 1.6-1.5 2.2-2.2 2.8-.4.3-.6.7-.6 1.2"
              stroke="currentColor"
            />
            <circle cx="12" cy="17" r=".8" fill="currentColor" />
            <path d="M12 2a8.5 8.5 0 0 0-5.7 14.8c.4.4.7.9.8 1.5l.2 1.1a1.4 1.4 0 0 0 1.4 1.1h6.6a1.4 1.4 0 0 0 1.4-1.1l.2-1.1c.1-.6.4-1.1.8-1.5A8.5 8.5 0 0 0 12 2Z" />
          </svg>
          <div
            id={titleId}
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--fg-strong)',
              letterSpacing: '0.01em',
            }}
          >
            模型设置
          </div>
        </div>
        {/* Scrollable body */}
        <div
          className="chat-model-settings-scroll"
          style={{ overflowY: 'auto', overscrollBehavior: 'contain', flex: 1, minHeight: 0 }}
        >
          {/* Model info */}
          <div
            style={{
              padding: '8px 14px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--fg-strong)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginBottom: 5,
              }}
            >
              {modelLabel}
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {supportsVision && <CapabilityTag label="视觉" tone="emerald" />}
              {supportsTools && <CapabilityTag label="工具" tone="accent" />}
              {supportsThinking && <CapabilityTag label="思考" tone="violet" />}
              {contextWindow ? (
                <CapabilityTag label={formatContextWindow(contextWindow) ?? ''} />
              ) : null}
            </div>
          </div>
          {/* Fast settings — use current chat model as fast model */}
          {showFastSettings && (
            <div
              style={{
                margin: '8px 14px',
                padding: '9px 12px',
                borderRadius: 9,
                background: 'color-mix(in oklch, var(--accent) 7%, transparent)',
                border:
                  '1px solid color-mix(in oklch, var(--accent) 20%, var(--border-subtle) 80%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-strong)' }}>
                  Fast 快速模型
                </span>
                <span
                  style={{
                    fontSize: 9.5,
                    color: 'var(--fg-muted)',
                    lineHeight: 1.4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {effectiveFastEnabled
                    ? `用当前模型（${modelLabel}）处理标题/辅助任务`
                    : '关闭 — 标题/辅助任务走默认路径'}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={effectiveFastEnabled}
                onClick={() => {
                  const next = !effectiveFastEnabled;
                  setLocalFastEnabled(next);
                  void onFastToggle?.(next);
                }}
                disabled={!onFastToggle}
                style={{
                  position: 'relative',
                  width: 32,
                  height: 18,
                  borderRadius: 999,
                  border: 'none',
                  background: effectiveFastEnabled ? 'var(--accent)' : 'var(--border-default)',
                  cursor: onFastToggle ? 'pointer' : 'default',
                  flexShrink: 0,
                  transition: 'background 120ms ease',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    left: effectiveFastEnabled ? 16 : 2,
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: 'var(--fg-on-accent)',
                    transition: 'left 120ms ease',
                  }}
                />
              </button>
            </div>
          )}
          {/* Thinking section */}
          {supportsThinking ? (
            <div style={{ padding: '4px 14px 10px' }}>
              {!canConfigureThinking ? (
                <div
                  style={{
                    marginBottom: 7,
                    padding: '7px 9px',
                    borderRadius: 8,
                    background: 'color-mix(in oklch, var(--accent) 9%, transparent)',
                    color: 'var(--fg-default)',
                    fontSize: 10,
                    lineHeight: 1.45,
                  }}
                >
                  当前模型具备思考能力，但它的思考模式由模型本身决定，不能在这里单独开关。
                </div>
              ) : null}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 9,
                  fontWeight: 700,
                  color: 'var(--fg-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 6,
                  padding: '0 2px',
                }}
              >
                思考等级
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {/* Off option */}
                <button
                  className={`chat-model-settings-option${!thinkingEnabled ? ' is-active' : ''}`}
                  type="button"
                  disabled={!canConfigureThinking}
                  onClick={() => onChangeThinkingEnabled(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    border: 'none',
                    borderRadius: 7,
                    background: !thinkingEnabled ? 'var(--accent-muted)' : 'transparent',
                    color: !thinkingEnabled ? 'var(--accent)' : 'var(--fg-default)',
                    padding: '7px 10px',
                    cursor: canConfigureThinking ? 'pointer' : 'not-allowed',
                    opacity: canConfigureThinking ? 1 : 0.45,
                    fontSize: 11,
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {!thinkingEnabled ? (
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
                        style={{ opacity: 0.3 }}
                      >
                        <circle cx="12" cy="12" r="8" />
                      </svg>
                    )}
                  </span>
                  <span style={{ fontWeight: 600 }}>关闭思考</span>
                </button>
                {/* Effort levels */}
                {supportedEfforts.map((level) => {
                  const active = thinkingEnabled && reasoningEffort === level;
                  const desc = describeReasoningEffort(level);
                  return (
                    <button
                      className={`chat-model-settings-option${active ? ' is-active' : ''}`}
                      key={level}
                      type="button"
                      disabled={!canConfigureThinking}
                      onClick={() => {
                        onChangeThinkingEnabled(true);
                        onChangeReasoningEffort(level);
                      }}
                      title={desc}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        border: 'none',
                        borderRadius: 7,
                        background: active
                          ? 'color-mix(in oklch, var(--accent) 14%, transparent)'
                          : 'transparent',
                        color: active
                          ? 'color-mix(in oklch, var(--accent) 85%, var(--fg-on-accent) 15%)'
                          : 'var(--fg-default)',
                        padding: '7px 10px',
                        cursor: canConfigureThinking ? 'pointer' : 'not-allowed',
                        opacity: canConfigureThinking ? 1 : 0.45,
                        textAlign: 'left',
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                      }}
                    >
                      <span
                        style={{
                          width: 14,
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {active ? (
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
                            style={{ opacity: 0.3 }}
                          >
                            <circle cx="12" cy="12" r="8" />
                          </svg>
                        )}
                      </span>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.03em',
                          flexShrink: 0,
                        }}
                      >
                        {level}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: '10px 14px',
                fontSize: 10.5,
                color: 'var(--fg-muted)',
                lineHeight: 1.5,
              }}
            >
              当前模型没有单独的思考等级设置。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
