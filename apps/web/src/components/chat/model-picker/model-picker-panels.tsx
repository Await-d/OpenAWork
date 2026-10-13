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

/** 思考强度权重:滑块填充、辉光与卡片流光都按它从「淡」到「浓」分级呈现。 */
const THINKING_INTENSITY: Record<ReasoningEffort, number> = {
  none: 0,
  minimal: 0.25,
  low: 0.45,
  medium: 0.65,
  high: 0.8,
  xhigh: 0.92,
  max: 1,
};

function formatContextWindow(value: number | undefined): string | null {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

const CONTEXT_WINDOW_PRESETS = [
  { value: undefined, label: '自动', detail: '使用模型预设' },
  { value: 272_000, label: '272K', detail: '适合常规长上下文' },
  { value: 400_000, label: '400K', detail: '适合中大型上下文' },
  { value: 1_000_000, label: '1M', detail: '适合超长上下文' },
] as const;

function sameContextWindow(left: number | undefined, right: number | undefined): boolean {
  return left === right || (left === undefined && right === undefined);
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
  anchorRect: { left: number; right: number; top: number; bottom: number },
  width: number,
  maxDesiredHeight: number,
  align: 'start' | 'end' | 'center',
  preferAbove = false,
) {
  const margin = 12;
  const gap = 6;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Horizontal: clamp panel within viewport
  const leftCandidate =
    align === 'start'
      ? anchorRect.left
      : align === 'center'
        ? (anchorRect.left + anchorRect.right) / 2 - width / 2
        : Math.max(margin, anchorRect.right - width);
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
      transformOrigin:
        align === 'start'
          ? ('top left' as const)
          : align === 'center'
            ? ('top center' as const)
            : ('top right' as const),
    };
  }

  // Open above
  const effectiveHeight = Math.max(160, Math.min(maxDesiredHeight, spaceAbove));
  return {
    left,
    top: Math.max(margin, anchorRect.top - effectiveHeight - gap),
    maxHeight: effectiveHeight,
    transformOrigin:
      align === 'start'
        ? ('bottom left' as const)
        : align === 'center'
          ? ('bottom center' as const)
          : ('bottom right' as const),
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
  reasoningOptions,
  contextWindow,
  contextWindowOverride,
  onChangeContextWindowOverride,
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
  /** 模型自声明的推理档位(来自 provider 配置 / models.dev);优先于按 modelId 推断。 */
  reasoningOptions?: readonly ModelReasoningOption[];
  contextWindow?: number;
  contextWindowOverride?: number;
  onChangeContextWindowOverride?: (value: number | undefined) => Promise<void> | void;
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
    'top left' | 'top center' | 'top right' | 'bottom left' | 'bottom center' | 'bottom right'
  >('bottom center');
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const [customContextWindow, setCustomContextWindow] = React.useState('');
  const [contextWindowSaving, setContextWindowSaving] = React.useState(false);
  const [contextWindowError, setContextWindowError] = React.useState<string | null>(null);
  const [fastSaving, setFastSaving] = React.useState(false);
  const [fastError, setFastError] = React.useState<string | null>(null);

  React.useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // 水平居中于「输入框」上方:以 composer 外壳宽度为水平锚点,
      // 垂直仍锚定按钮上方(找不到外壳时回退到按钮右对齐的旧范式)。
      const shell = el.closest<HTMLElement>('.composer-shell');
      const shellRect = shell?.getBoundingClientRect();
      // DOMRect 的 left/right/top/bottom 是原型上的 getter,不能靠展开拷贝
      // ({...rect} 会得到空对象,导致后续计算出 NaN),这里显式取四个值。
      const anchor =
        shell && shellRect
          ? {
              left: shellRect.left,
              right: shellRect.right,
              top: rect.top,
              bottom: rect.bottom,
            }
          : { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      const next = resolveFloatingPanelPosition(anchor, 320, 360, 'center', true);
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
    window.setTimeout(() => {
      const firstButton = panelRef.current?.querySelector<HTMLElement>('button:not([disabled])');
      firstButton?.focus();
    }, 0);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [onClose, open]);

  if (!open) return null;

  const supportedEfforts = getSupportedReasoningEffortsForModel(
    providerType,
    modelId,
    reasoningOptions,
  );
  const showFastSettings = providerType === 'openai';
  // 挡位是权威值：配置后直接生效（可高于模型预设），与网关解析口径一致；
  // 未配置挡位时回落模型预设。预设缺失的拉取模型同样可以调挡位。
  const effectiveContextWindow = contextWindowOverride ?? contextWindow;
  const hasContextWindow =
    effectiveContextWindow !== undefined &&
    Number.isFinite(effectiveContextWindow) &&
    effectiveContextWindow > 0;
  const selectedContextPreset = CONTEXT_WINDOW_PRESETS.find((preset) =>
    sameContextWindow(preset.value, contextWindowOverride),
  );
  const contextWindowLabel = formatContextWindow(effectiveContextWindow);
  const modelContextWindowLabel = formatContextWindow(contextWindow);

  const handleContextWindowChange = async (value: number | undefined) => {
    if (!onChangeContextWindowOverride || contextWindowSaving) return;
    setContextWindowError(null);
    setContextWindowSaving(true);
    try {
      await onChangeContextWindowOverride(value);
    } catch (error) {
      setContextWindowError(error instanceof Error ? error.message : '保存上下文挡位失败。');
    } finally {
      setContextWindowSaving(false);
    }
  };

  const handleCustomContextWindowSave = async () => {
    const rawValue = customContextWindow.trim();
    const parsed = Number(rawValue);
    if (!/^\d+$/.test(rawValue) || !Number.isInteger(parsed) || parsed < 1 || parsed > 10_000_000) {
      setContextWindowError('请输入 1–10,000,000 之间的整数 Token 数。');
      return;
    }
    await handleContextWindowChange(parsed);
  };

  const handleFastToggle = async () => {
    if (!onFastToggle || fastSaving) return;
    setFastError(null);
    setFastSaving(true);
    try {
      await onFastToggle(!fastEnabled);
    } catch (error) {
      setFastError(error instanceof Error ? error.message : '保存 OpenAI Fast 模式失败。');
    } finally {
      setFastSaving(false);
    }
  };

  // 思考滑块:「关闭」+ 从低到高的支持档位,统一用一个带刻度点的滑条表达,
  // 比一堆按钮更好理解,也天然带排序。
  const sortedSupportedEfforts = sortSupportedReasoningEfforts(supportedEfforts);
  const thinkingStops: Array<{ key: string; effort: ReasoningEffort | null; label: string }> = [
    { key: 'off', effort: null, label: '关闭' },
    ...sortedSupportedEfforts.map((effort) => ({
      key: effort,
      effort,
      label: formatReasoningEffortLabel(effort),
    })),
  ];
  const activeThinkingStopIndex = !thinkingEnabled
    ? 0
    : (() => {
        const exact = thinkingStops.findIndex((stop) => stop.effort === reasoningEffort);
        if (exact >= 0) return exact;
        // 当前档位不在这个模型的支持列表里（比如切换了模型）：就近钳制到
        // 最接近的支持档位，避免滑块永远停在「关闭」上看起来像没生效。
        let best = 1;
        let bestDiff = Number.POSITIVE_INFINITY;
        for (let i = 1; i < thinkingStops.length; i += 1) {
          const stop = thinkingStops[i];
          if (!stop || stop.effort === null) continue;
          const diff = Math.abs(
            REASONING_EFFORT_RANK[stop.effort] - REASONING_EFFORT_RANK[reasoningEffort],
          );
          if (diff < bestDiff) {
            bestDiff = diff;
            best = i;
          }
        }
        return best;
      })();
  const activeThinkingStop = thinkingStops[activeThinkingStopIndex] ?? thinkingStops[0];
  // 强度可视化:填充渐变到拇指位置、拇指辉光半径、均衡条点亮数与脉冲速度,
  // 全部由 THINKING_INTENSITY 驱动——档位越高,填充越「热」、辉光越大、条子闪得越快。
  const thinkingIntensity = activeThinkingStop?.effort
    ? (THINKING_INTENSITY[activeThinkingStop.effort] ?? 0)
    : 0;
  const sliderFillPercent =
    thinkingStops.length > 1 ? (activeThinkingStopIndex / (thinkingStops.length - 1)) * 100 : 0;
  const thinkingGlowPx = thinkingEnabled ? Math.round(thinkingIntensity * 8) : 0;
  // 每个档位配不同的脉冲节奏:低档轻柔单次、中档双拍、高档三连急促;越高越快、幅度越大。
  const thinkingPulseTier: 'soft' | 'mid' | 'hard' =
    thinkingIntensity <= 0.34 ? 'soft' : thinkingIntensity <= 0.72 ? 'mid' : 'hard';
  const thinkingPulseDuration = `${(2.8 - thinkingIntensity * 1.7).toFixed(2)}s`;
  const thinkingBreathe = (0.05 + thinkingIntensity * 0.07).toFixed(3);
  const handleThinkingStopSelect = (index: number) => {
    const stop = thinkingStops[index];
    if (!stop) return;
    if (stop.effort === null) {
      onChangeThinkingEnabled(false);
    } else {
      onChangeThinkingEnabled(true);
      onChangeReasoningEffort(stop.effort);
    }
  };

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
          .chat-model-settings-option:focus-visible,
          .chat-model-settings-custom-input:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
            box-shadow: 0 0 0 4px var(--accent-subtle);
          }
          .chat-model-settings-fast-toggle:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
            box-shadow: 0 0 0 4px var(--accent-subtle);
          }
          .chat-model-settings-close:focus-visible,
          .chat-model-settings-apply:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
            box-shadow: 0 0 0 4px var(--accent-subtle);
          }
          /* 思考等级卡片:安静中性为底。底色几乎不染色,只有边框与一条很窄的流光
             随强度轻微升温,避免整卡被蓝色「洗白」 */
          .chat-model-settings-thinking-card {
            position: relative;
            overflow: hidden;
            border-radius: 10px;
            background: color-mix(
              in oklch,
              var(--accent) calc(var(--thinking-intensity, 0) * var(--thinking-intensity, 0) * 4%),
              var(--bg-raised)
            );
            border: 1px solid
              color-mix(
                in oklch,
                var(--accent) calc(var(--thinking-intensity, 0) * var(--thinking-intensity, 0) * 22%),
                var(--border-default) 100%
              );
            transition: background 320ms ease, border-color 320ms ease;
          }
          .chat-model-settings-thinking-card::before {
            content: '';
            position: absolute;
            top: 0;
            bottom: 0;
            left: 0;
            width: 38%;
            pointer-events: none;
            background: linear-gradient(
              100deg,
              transparent 0%,
              color-mix(in oklch, var(--accent) 5%, transparent) 45%,
              color-mix(in oklch, var(--accent) 9%, transparent) 55%,
              transparent 100%
            );
            opacity: calc(var(--thinking-intensity, 0) * 0.9);
            transform: translateX(-110%);
          }
          .chat-model-settings-thinking-card--shimmer::before {
            animation: chat-thinking-card-shimmer calc(4s - var(--thinking-intensity, 0) * 2.2s) ease-in-out infinite;
          }
          @keyframes chat-thinking-card-shimmer {
            0% { transform: translateX(-110%); }
            45%, 100% { transform: translateX(calc(100% / 0.38)); }
          }
          @media (prefers-reduced-motion: reduce) {
            .chat-model-settings-thinking-card--shimmer::before {
              animation: none;
            }
          }
          /* 思考等级滑条:12px 轨道 + 22px 圆拇指;呼吸与脉冲速度由 CSS 变量控制 */
          .chat-model-settings-thinking-slider {
            -webkit-appearance: none;
            appearance: none;
            height: 12px;
            border-radius: 999px;
            background: var(--border-default);
          }
          .chat-model-settings-thinking-slider:disabled {
            cursor: not-allowed;
          }
          .chat-model-settings-thinking-slider::-webkit-slider-runnable-track {
            height: 12px;
            border-radius: 999px;
            background: transparent;
          }
          .chat-model-settings-thinking-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 22px;
            height: 22px;
            margin-top: -5px;
            border: 3px solid var(--bg-overlay);
            border-radius: 50%;
            background: var(--accent);
            box-shadow:
              0 2px 6px rgba(0, 0, 0, 0.5),
              0 0 var(--thinking-glow, 0px) color-mix(in oklch, var(--accent) 50%, transparent);
            cursor: pointer;
          }
          .chat-model-settings-thinking-slider:not(:disabled)::-webkit-slider-thumb {
            animation: chat-thinking-thumb-breathe var(--thinking-pulse-duration, 2.4s) ease-in-out infinite;
          }
          .chat-model-settings-thinking-slider:not(:disabled)::-webkit-slider-thumb:hover {
            box-shadow:
              0 2px 6px rgba(0, 0, 0, 0.5),
              0 0 calc(var(--thinking-glow, 0px) + 6px) color-mix(in oklch, var(--accent) 70%, transparent);
          }
          .chat-model-settings-thinking-slider::-moz-range-track {
            height: 12px;
            border-radius: 999px;
            background: var(--border-default);
          }
          .chat-model-settings-thinking-slider::-moz-range-progress {
            height: 12px;
            border-radius: 999px;
            background: var(--accent);
          }
          .chat-model-settings-thinking-slider::-moz-range-thumb {
            width: 22px;
            height: 22px;
            border: 3px solid var(--bg-overlay);
            border-radius: 50%;
            background: var(--accent);
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
            cursor: pointer;
          }
          /* 拇指呼吸幅度随档位加大 */
          @keyframes chat-thinking-thumb-breathe {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(calc(1 + var(--thinking-breathe, 0.08))); }
          }
          /* 档位脉冲光环:soft 单次缓胀 / mid 双拍 / hard 三连急促 */
          .chat-model-settings-thinking-halo {
            position: absolute;
            top: 6px;
            left: 0;
            width: 42px;
            height: 42px;
            margin: -21px 0 0 -21px;
            border-radius: 50%;
            pointer-events: none;
            background: radial-gradient(
              circle,
              color-mix(in oklch, var(--accent) 42%, transparent) 0%,
              color-mix(in oklch, var(--accent) 16%, transparent) 56%,
              transparent 74%
            );
            animation-duration: var(--thinking-pulse-duration, 2.4s);
            animation-iteration-count: infinite;
            animation-timing-function: ease-out;
            will-change: transform, opacity;
          }
          .chat-model-settings-thinking-halo--soft { animation-name: chat-thinking-halo-soft; }
          .chat-model-settings-thinking-halo--mid { animation-name: chat-thinking-halo-mid; }
          .chat-model-settings-thinking-halo--hard { animation-name: chat-thinking-halo-hard; }
          @keyframes chat-thinking-halo-soft {
            0% { transform: scale(0.6); opacity: 0; }
            32% { opacity: 0.55; }
            100% { transform: scale(1.24); opacity: 0; }
          }
          @keyframes chat-thinking-halo-mid {
            0% { transform: scale(0.62); opacity: 0; }
            22% { opacity: 0.6; }
            42% { transform: scale(1.04); opacity: 0.08; }
            58% { opacity: 0.5; }
            100% { transform: scale(1.34); opacity: 0; }
          }
          @keyframes chat-thinking-halo-hard {
            0% { transform: scale(0.6); opacity: 0; }
            14% { opacity: 0.72; }
            30% { transform: scale(0.98); opacity: 0.1; }
            44% { opacity: 0.62; }
            60% { transform: scale(1.22); opacity: 0.08; }
            74% { opacity: 0.5; }
            100% { transform: scale(1.48); opacity: 0; }
          }
          @media (prefers-reduced-motion: reduce) {
            .chat-model-settings-thinking-halo,
            .chat-model-settings-thinking-slider:not(:disabled)::-webkit-slider-thumb,
            .chat-model-settings-thinking-card--shimmer::before {
              animation: none !important;
            }
          }
          .chat-model-settings-thinking-slider:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
          }
          .chat-model-settings-scroll::-webkit-scrollbar { width: 5px; }
          .chat-model-settings-scroll::-webkit-scrollbar-track { background: transparent; }
          .chat-model-settings-scroll::-webkit-scrollbar-thumb {
            background: var(--scrollbar-thumb);
            border-radius: 999px;
          }
          .chat-model-settings-scroll::-webkit-scrollbar-thumb:hover {
            background: var(--scrollbar-thumb-hover);
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
              {effectiveContextWindow ? <CapabilityTag label={contextWindowLabel ?? ''} /> : null}
            </div>
          </div>
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
                    overflowWrap: 'anywhere',
                  }}
                >
                  OpenAI Fast 模式（service_tier=priority）
                </span>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className="chat-model-settings-fast-toggle"
                  role="switch"
                  aria-checked={fastEnabled}
                  aria-label="切换 OpenAI Fast 模式"
                  aria-busy={fastSaving}
                  onClick={() => void handleFastToggle()}
                  disabled={!onFastToggle || fastSaving}
                  style={{
                    position: 'relative',
                    width: 36,
                    height: 20,
                    padding: 0,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderColor: fastEnabled ? 'var(--accent-border)' : 'var(--border-default)',
                    background: fastEnabled ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                    cursor: onFastToggle && !fastSaving ? 'pointer' : 'not-allowed',
                    opacity: fastSaving ? 0.7 : 1,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: fastEnabled ? 18 : 2,
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: fastEnabled ? 'var(--accent)' : 'var(--fg-muted)',
                      transition: 'left 100ms cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                  />
                </button>
                <span
                  role="status"
                  aria-live="polite"
                  style={{
                    minWidth: 52,
                    padding: '3px 7px',
                    borderRadius: 999,
                    border: '1px solid var(--border-subtle)',
                    background: fastEnabled ? 'var(--accent-muted)' : 'var(--bg-base)',
                    color: fastEnabled ? 'var(--accent)' : 'var(--fg-muted)',
                    fontSize: 9.5,
                    fontWeight: 700,
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {fastSaving ? '保存中…' : fastEnabled ? '已开启' : '未开启'}
                </span>
              </div>
            </div>
          )}
          {hasContextWindow && onChangeContextWindowOverride && (
            <div
              style={{
                padding: '10px 14px 8px',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    color: 'var(--fg-muted)',
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  自动压缩上下文
                </span>
                {contextWindow !== undefined && contextWindow > 0 ? (
                  <span style={{ color: 'var(--fg-subtle)', fontSize: 9 }}>
                    模型预设 {modelContextWindowLabel}
                  </span>
                ) : null}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: 4,
                }}
              >
                {CONTEXT_WINDOW_PRESETS.map((preset) => {
                  const active = sameContextWindow(preset.value, contextWindowOverride);
                  return (
                    <button
                      key={preset.label}
                      className={`chat-model-settings-option${active ? ' is-active' : ''}`}
                      type="button"
                      disabled={!onChangeContextWindowOverride || contextWindowSaving}
                      aria-pressed={active}
                      title={preset.detail}
                      onClick={() => void handleContextWindowChange(preset.value)}
                      style={{
                        minWidth: 0,
                        minHeight: 28,
                        padding: '4px 3px',
                        border: active
                          ? '1px solid var(--accent-border)'
                          : '1px solid var(--border-subtle)',
                        borderRadius: 6,
                        background: active ? 'var(--accent-muted)' : 'var(--bg-base)',
                        color: active ? 'var(--accent)' : 'var(--fg-default)',
                        cursor: 'pointer',
                        fontSize: 10,
                        fontWeight: 700,
                        opacity: contextWindowSaving ? 0.6 : 1,
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                <input
                  className="chat-model-settings-custom-input"
                  value={customContextWindow}
                  onChange={(event) => {
                    setCustomContextWindow(event.target.value);
                    setContextWindowError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleCustomContextWindowSave();
                    }
                  }}
                  inputMode="numeric"
                  aria-label="自定义上下文 Token 数"
                  placeholder="自定义 Token"
                  disabled={!onChangeContextWindowOverride || contextWindowSaving}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 28,
                    padding: '0 8px',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                    background: 'var(--bg-base)',
                    color: 'var(--fg-strong)',
                    fontSize: 10,
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  className="chat-model-settings-apply"
                  onClick={() => void handleCustomContextWindowSave()}
                  disabled={
                    !onChangeContextWindowOverride ||
                    contextWindowSaving ||
                    !customContextWindow.trim()
                  }
                  style={{
                    minWidth: 42,
                    padding: '0 8px',
                    border: '1px solid var(--border-default)',
                    borderRadius: 6,
                    background: 'var(--bg-surface)',
                    color: 'var(--fg-default)',
                    cursor: 'pointer',
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                >
                  {contextWindowSaving ? '保存中' : '应用'}
                </button>
              </div>
              <div style={{ minHeight: 14, marginTop: 3, color: 'var(--fg-subtle)', fontSize: 9 }}>
                {contextWindowError ??
                  (selectedContextPreset
                    ? `当前：${selectedContextPreset.label}，统计与自动压缩会立即使用有效窗口。`
                    : contextWindowOverride
                      ? `当前：${formatContextWindow(contextWindowOverride)}，统计与自动压缩会立即使用有效窗口。`
                      : '未配置挡位时按模型预设统计；配置后挡位为权威值，自动压缩按其触发。')}
              </div>
            </div>
          )}
          {showFastSettings && (
            <div
              style={{
                margin: '0 14px 8px',
                color: 'var(--fg-muted)',
                fontSize: 9.5,
                lineHeight: 1.45,
              }}
            >
              当前开关会同步保存到设置 / 连接中的 OpenAI Provider，并立即影响后续请求。
            </div>
          )}
          {showFastSettings && fastError ? (
            <div
              role="alert"
              style={{
                margin: '0 14px 8px',
                color: 'var(--complement)',
                fontSize: 9.5,
                lineHeight: 1.45,
              }}
            >
              {fastError}
            </div>
          ) : null}
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
              {/* 思考等级卡片:左侧大字档位 + 说明,右侧加粗滑条;卡片底色/流光随强度升温 */}
              <div
                className={`chat-model-settings-thinking-card${
                  thinkingEnabled ? ' chat-model-settings-thinking-card--shimmer' : ''
                }`}
                style={
                  {
                    margin: 0,
                    padding: '12px 14px',
                    opacity: canConfigureThinking ? 1 : 0.6,
                    cursor: 'default',
                    '--thinking-intensity': thinkingEnabled ? thinkingIntensity : 0,
                    '--thinking-glow': `${thinkingGlowPx}px`,
                    '--thinking-pulse-duration': thinkingPulseDuration,
                    '--thinking-breathe': thinkingBreathe,
                  } as CSSProperties
                }
              >
                <div
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  {/* 顶部行:左侧标题,右侧当前档位 + 简短说明 */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'var(--fg-muted)',
                      }}
                    >
                      思考等级
                    </span>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'flex-end',
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 9.5,
                          color: thinkingEnabled ? 'var(--fg-muted)' : 'var(--fg-subtle)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          transition: 'color 200ms ease',
                        }}
                        title={
                          activeThinkingStop && activeThinkingStop.effort !== null
                            ? describeReasoningEffort(activeThinkingStop.effort)
                            : '直接回答，不额外推理'
                        }
                      >
                        {activeThinkingStop && activeThinkingStop.effort !== null
                          ? describeReasoningEffort(activeThinkingStop.effort)
                          : '直接回答，不额外推理'}
                      </span>
                    </span>
                  </div>
                  {/* 全宽滑条:轨道刻度点 + 档位标签 */}
                  <div style={{ position: 'relative' }}>
                    <input
                      type="range"
                      className="chat-model-settings-thinking-slider"
                      min={0}
                      max={Math.max(0, thinkingStops.length - 1)}
                      step={1}
                      value={activeThinkingStopIndex}
                      disabled={!canConfigureThinking}
                      aria-label="思考等级"
                      aria-valuetext={activeThinkingStop ? activeThinkingStop.label : '关闭'}
                      onChange={(event) => handleThinkingStopSelect(Number(event.target.value))}
                      style={{
                        display: 'block',
                        width: '100%',
                        accentColor: 'var(--accent)',
                        cursor: canConfigureThinking ? 'pointer' : 'not-allowed',
                        opacity: canConfigureThinking ? 1 : 0.5,
                        margin: 0,
                        background: thinkingEnabled
                          ? `linear-gradient(90deg, color-mix(in oklch, var(--accent) 62%, transparent) 0%, var(--accent) ${sliderFillPercent}%, color-mix(in oklch, var(--fg-subtle) 30%, transparent) ${sliderFillPercent}%)`
                          : 'color-mix(in oklch, var(--fg-subtle) 30%, transparent)',
                      }}
                    />
                    {/* 档位脉冲光环:跟随拇指位置,节奏随档位变化(低=单次缓胀 / 中=双拍 / 高=三连急促) */}
                    {thinkingEnabled ? (
                      <span
                        aria-hidden="true"
                        className={`chat-model-settings-thinking-halo chat-model-settings-thinking-halo--${thinkingPulseTier}`}
                        style={{
                          left: `calc(11px + (100% - 22px) * ${sliderFillPercent / 100})`,
                        }}
                      />
                    ) : null}
                    {/* 轨道刻度:细竖线,与各档位对齐(当前档位由拇指本身表示,不重复画) */}
                    <div
                      style={{
                        position: 'absolute',
                        left: 11,
                        right: 11,
                        top: 0,
                        height: 12,
                        pointerEvents: 'none',
                      }}
                      aria-hidden="true"
                    >
                      {thinkingStops.map((stop, index) => {
                        if (index === activeThinkingStopIndex) return null;
                        const reached = thinkingEnabled && index <= activeThinkingStopIndex;
                        return (
                          <span
                            key={stop.key}
                            style={{
                              position: 'absolute',
                              top: '50%',
                              left:
                                thinkingStops.length === 1
                                  ? '50%'
                                  : `${(index / (thinkingStops.length - 1)) * 100}%`,
                              transform: 'translate(-50%, -50%)',
                              width: 2,
                              height: 12,
                              borderRadius: 1,
                              background: reached
                                ? 'color-mix(in oklch, var(--fg-on-accent) 45%, transparent)'
                                : 'color-mix(in oklch, var(--fg-muted) 45%, transparent)',
                              transition: 'background 160ms ease',
                            }}
                          />
                        );
                      })}
                    </div>
                    {/* 档位标签:与刻度对齐,从左到右「关闭 → 最强」 */}
                    <div
                      style={{
                        position: 'relative',
                        height: 14,
                        marginTop: 10,
                        marginLeft: 11,
                        marginRight: 11,
                      }}
                    >
                      {thinkingStops.map((stop, index) => (
                        <span
                          key={stop.key}
                          style={{
                            position: 'absolute',
                            left:
                              thinkingStops.length === 1
                                ? '50%'
                                : `${(index / (thinkingStops.length - 1)) * 100}%`,
                            transform: 'translateX(-50%)',
                            fontSize: 9.5,
                            fontWeight: stop.key === activeThinkingStop?.key ? 700 : 500,
                            color:
                              stop.key === activeThinkingStop?.key
                                ? 'var(--accent)'
                                : 'var(--fg-subtle)',
                            whiteSpace: 'nowrap',
                            transition: 'color 200ms ease',
                          }}
                        >
                          {stop.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
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
