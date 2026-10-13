import { useRef, useState, type KeyboardEvent } from 'react';
import { useHorizontalWheelScroll } from '../../../hooks/use-horizontal-wheel-scroll.js';
import { getStatusLabel, isActiveStatus, type SubAgentRunItem } from './sub-agent-run-list.js';
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
 * 子代理 tab 内的紧凑切换器：左侧一枚「仅活跃」筛选开关（运行中 / 等待处理），
 * 右侧每个子代理一枚 chip（系统序号徽章 + 标签），横向滚动；只有当存在多个
 * 子代理时才出现（单个子代理无需切换，直接看预览即可）。
 */
export function FusionSubAgentSwitcher({
  items,
  onSelectSession,
  selectedSessionId,
}: FusionSubAgentSwitcherProps) {
  const [activeOnly, setActiveOnly] = useState(false);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const { attachRef: attachRailRef } = useHorizontalWheelScroll<HTMLDivElement>();

  if (items.length <= 1) {
    return null;
  }

  const activeItems = items.filter((item) => isActiveStatus(item.status));
  const visibleItems = activeOnly ? activeItems : items;
  const selectedIndex = visibleItems.findIndex((item) => item.sessionId === selectedSessionId);
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const moveSelection = (nextIndex: number): void => {
    const nextItem = visibleItems[nextIndex];
    if (!nextItem) {
      return;
    }

    onSelectSession(nextItem.sessionId);
    chipRefs.current.get(nextItem.sessionId)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % visibleItems.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + visibleItems.length) % visibleItems.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = visibleItems.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    moveSelection(nextIndex);
  };

  return (
    <div className="fusion-sub-agent-switcher">
      <button
        type="button"
        className="fusion-sub-agent-switcher__filter"
        aria-pressed={activeOnly}
        aria-label={`仅显示活跃子代理（运行中 / 等待处理，共 ${activeItems.length} 个）`}
        title={activeOnly ? '显示全部子代理' : '只看活跃（运行中 / 等待处理）'}
        onClick={() => setActiveOnly((previous) => !previous)}
      >
        <svg
          aria-hidden="true"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        <span>活跃</span>
        {activeItems.length > 0 && (
          <span className="fusion-sub-agent-switcher__filter-count">{activeItems.length}</span>
        )}
      </button>
      <div
        ref={attachRailRef}
        className="fusion-sub-agent-switcher__rail"
        role="tablist"
        aria-label="子代理切换"
      >
        {visibleItems.length === 0 ? (
          <span className="fusion-sub-agent-switcher__empty">暂无活跃子代理</span>
        ) : (
          visibleItems.map((item, index) => {
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
                {item.sequence !== undefined && (
                  <span className="fusion-sub-agent-switcher__index">#{item.sequence}</span>
                )}
                <span className="fusion-sub-agent-switcher__label">{label}</span>
                <span className="fusion-sub-agent-switcher__status-sr">{statusLabel}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
