import React from 'react';
import {
  describeReasoningEffort,
  getSupportedReasoningEffortsForModel,
} from '@openAwork/shared-ui';
import type { ReasoningEffort } from '../../pages/chat-page/support.js';
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
    default: { bg: 'var(--bg-2)', color: 'var(--text-3)' },
    accent: { bg: 'var(--accent-muted)', color: 'var(--accent)' },
    emerald: {
      bg: 'color-mix(in oklch, var(--success) 14%, transparent)',
      color: 'color-mix(in oklch, var(--success) 82%, white 18%)',
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
) {
  const margin = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const leftCandidate =
    align === 'start' ? anchorRect.left : Math.max(margin, anchorRect.right - width);
  const left = Math.min(
    Math.max(margin, leftCandidate),
    Math.max(margin, viewportWidth - width - margin),
  );

  const spaceBelow = viewportHeight - anchorRect.bottom - margin;
  const spaceAbove = anchorRect.top - margin;

  if (spaceBelow >= Math.min(180, maxDesiredHeight) || spaceBelow >= spaceAbove) {
    return {
      left,
      top: Math.min(
        anchorRect.bottom + 8,
        viewportHeight - margin - Math.min(maxDesiredHeight, Math.max(160, spaceBelow)),
      ),
      maxHeight: Math.max(160, Math.min(maxDesiredHeight, spaceBelow)),
      transformOrigin: align === 'start' ? ('top left' as const) : ('top right' as const),
    };
  }

  const maxHeight = Math.max(160, Math.min(maxDesiredHeight, spaceAbove));
  return {
    left,
    top: Math.max(margin, anchorRect.top - maxHeight - 8),
    maxHeight,
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
  >('top right');
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
      const next = resolveFloatingPanelPosition(rect, 340, 430, 'start');
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
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '6px 0 0',
          boxShadow: 'var(--shadow-lg)',
          minWidth: 320,
          width: 340,
          maxWidth: 'min(340px, calc(100vw - 16px))',
          maxHeight,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transformOrigin,
        }}
      >
        <div
          id={titleId}
          style={{
            padding: '2px 12px 6px',
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          选择模型
        </div>
        <div style={{ padding: '0 12px 8px' }}>
          <div
            className="chat-model-picker-search-shell"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              height: 30,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-2)',
              padding: '0 9px',
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ color: 'var(--text-3)', flexShrink: 0 }}
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
                color: 'var(--text)',
                fontSize: 11,
              }}
            />
          </div>
        </div>
        <div
          ref={listboxRef}
          role="listbox"
          aria-label="模型列表"
          style={{ overflowY: 'auto', padding: '0 0 8px', flex: 1, overscrollBehavior: 'contain' }}
        >
          {groups.map(({ provider, models }) => (
            <div key={provider.id}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 12px 3px',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <div
                  style={{
                    width: 15,
                    height: 15,
                    borderRadius: 4,
                    background: 'var(--surface)',
                    border: '1px solid var(--border-subtle)',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <img
                    src={`/logo-${provider.type}.svg`}
                    alt={provider.name}
                    width={11}
                    height={11}
                    style={{ objectFit: 'contain', filter: 'var(--provider-logo-filter, none)' }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: 'var(--text-3)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {provider.name}
                </span>
              </div>
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
                      alignItems: 'flex-start',
                      gap: 7,
                      width: '100%',
                      padding: '8px 10px',
                      border: 'none',
                      background: isActive ? 'var(--accent-muted)' : 'transparent',
                      color: isActive ? 'var(--accent)' : 'var(--text)',
                      fontSize: 11,
                      cursor: 'pointer',
                      textAlign: 'left',
                      borderRadius: 8,
                      margin: '0 6px 1px',
                    }}
                  >
                    <span
                      style={{
                        width: 18,
                        display: 'flex',
                        justifyContent: 'center',
                        paddingTop: 2,
                        color: isActive ? 'var(--accent)' : 'var(--text-3)',
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
                        >
                          <circle cx="12" cy="12" r="8" />
                        </svg>
                      )}
                    </span>
                    <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontWeight: 600,
                          fontSize: 11,
                        }}
                      >
                        {model.name}
                      </span>
                      <span
                        style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}
                      >
                        {model.supportsVision && <CapabilityTag label="视觉" tone="emerald" />}
                        {model.supportsTools && <CapabilityTag label="工具" tone="accent" />}
                        {model.supportsThinking && <CapabilityTag label="思考" tone="violet" />}
                        {contextLabel && <CapabilityTag label={contextLabel} />}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
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
}) {
  const [top, setTop] = React.useState(0);
  const [left, setLeft] = React.useState(0);
  const [maxHeight, setMaxHeight] = React.useState(250);
  const [transformOrigin, setTransformOrigin] = React.useState<
    'top left' | 'top right' | 'bottom left' | 'bottom right'
  >('top right');
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();

  React.useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = resolveFloatingPanelPosition(rect, 236, 260, 'end');
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

  if (!open) return null;

  const supportedEfforts = getSupportedReasoningEffortsForModel(providerType, modelId);

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
        style={{ position: 'absolute', inset: 0, background: 'transparent', border: 'none' }}
      />
      <div
        id="chat-model-settings-dialog"
        ref={panelRef}
        style={{
          position: 'absolute',
          top,
          left,
          zIndex: 1,
          width: 236,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-lg)',
          padding: 9,
          maxHeight,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          transformOrigin,
        }}
      >
        <div
          id={titleId}
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 8,
          }}
        >
          模型设置
        </div>
        <div style={{ marginBottom: 9 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
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
        {supportsThinking ? (
          <>
            {!canConfigureThinking ? (
              <div
                style={{
                  marginBottom: 8,
                  padding: '7px 9px',
                  borderRadius: 8,
                  background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                  color: 'var(--text-2)',
                  fontSize: 9.5,
                  lineHeight: 1.45,
                }}
              >
                当前模型具备思考能力，但它的思考模式由模型本身决定，不能在这里单独开关。
              </div>
            ) : null}
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: 'var(--text-3)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 6,
              }}
            >
              思考等级
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button
                className="chat-model-settings-option"
                type="button"
                disabled={!canConfigureThinking}
                onClick={() => onChangeThinkingEnabled(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  border: 'none',
                  borderRadius: 8,
                  background: !thinkingEnabled ? 'var(--accent-muted)' : 'transparent',
                  color: !thinkingEnabled ? 'var(--accent)' : 'var(--text-2)',
                  padding: '7px 9px',
                  cursor: canConfigureThinking ? 'pointer' : 'not-allowed',
                  opacity: canConfigureThinking ? 1 : 0.45,
                  fontSize: 11,
                }}
              >
                <span>关闭思考</span>
              </button>
              {supportedEfforts.map((level) => {
                const active = thinkingEnabled && reasoningEffort === level;
                const desc = describeReasoningEffort(level);
                return (
                  <button
                    className="chat-model-settings-option"
                    key={level}
                    type="button"
                    disabled={!canConfigureThinking}
                    onClick={() => {
                      onChangeThinkingEnabled(true);
                      onChangeReasoningEffort(level);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 7,
                      border: 'none',
                      borderRadius: 8,
                      background: active
                        ? 'color-mix(in oklch, var(--accent) 14%, transparent)'
                        : 'transparent',
                      color: active
                        ? 'color-mix(in oklch, var(--accent) 82%, white 18%)'
                        : 'var(--text-2)',
                      padding: '7px 9px',
                      cursor: canConfigureThinking ? 'pointer' : 'not-allowed',
                      opacity: canConfigureThinking ? 1 : 0.45,
                      textAlign: 'left',
                    }}
                    title={desc}
                  >
                    <span
                      style={{
                        minWidth: 44,
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                      }}
                    >
                      {level}
                    </span>
                    <span
                      style={{
                        fontSize: 9.5,
                        color: active ? 'inherit' : 'var(--text-3)',
                        lineHeight: 1.4,
                      }}
                    >
                      {desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5 }}>
            当前模型没有单独的思考等级设置。
          </div>
        )}
      </div>
    </div>
  );
}
