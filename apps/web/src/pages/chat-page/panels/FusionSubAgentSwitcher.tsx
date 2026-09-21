import { useRef, type KeyboardEvent } from 'react';
import { useHorizontalWheelScroll } from '../../../hooks/use-horizontal-wheel-scroll.js';
import { getStatusLabel, type SubAgentRunItem } from './sub-agent-run-list.js';
import './FusionSubAgentSwitcher.css';

export interface FusionSubAgentSwitcherProps {
  readonly items: readonly SubAgentRunItem[];
  readonly onSelectSession: (sessionId: string) => void;
  readonly selectedSessionId: string | null;
}

function resolveChipLabel(item: SubAgentRunItem): string {
  const candidates: readonly (string | undefined)[] = [
    item.title,
    item.taskLabel,
    item.assignedAgent,
    item.shortSessionId,
  ];

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return item.sessionId;
}

/**
 * 子代理 tab 内的紧凑切换器：每个子代理一枚 chip，横向滚动；只有当存在多个
 * 子代理时才出现（单个子代理无需切换，直接看预览即可）。
 */
export function FusionSubAgentSwitcher({
  items,
  onSelectSession,
  selectedSessionId,
}: FusionSubAgentSwitcherProps) {
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const { attachRef: attachRailRef } = useHorizontalWheelScroll<HTMLDivElement>();

  if (items.length <= 1) {
    return null;
  }

  const selectedIndex = items.findIndex((item) => item.sessionId === selectedSessionId);
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const moveSelection = (nextIndex: number): void => {
    const nextItem = items[nextIndex];
    if (!nextItem) {
      return;
    }

    onSelectSession(nextItem.sessionId);
    chipRefs.current.get(nextItem.sessionId)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % items.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + items.length) % items.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = items.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    moveSelection(nextIndex);
  };

  return (
    <div
      ref={attachRailRef}
      className="fusion-sub-agent-switcher"
      role="tablist"
      aria-label="子代理切换"
    >
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        const label = resolveChipLabel(item);
        const statusLabel = getStatusLabel(item.status);

        return (
          <button
            key={item.sessionId}
            type="button"
            role="tab"
            aria-selected={isSelected}
            className="fusion-sub-agent-switcher__chip"
            data-active={isSelected ? 'true' : 'false'}
            data-status={item.status}
            onClick={() => onSelectSession(item.sessionId)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            ref={(element) => {
              if (element) {
                chipRefs.current.set(item.sessionId, element);
              } else {
                chipRefs.current.delete(item.sessionId);
              }
            }}
            tabIndex={index === tabbableIndex ? 0 : -1}
            title={label}
          >
            <span aria-hidden="true" className="fusion-sub-agent-switcher__dot" />
            <span className="fusion-sub-agent-switcher__label">{label}</span>
            <span className="fusion-sub-agent-switcher__status-sr">{statusLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
