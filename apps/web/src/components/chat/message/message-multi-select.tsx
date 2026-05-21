import { useCallback, useState } from 'react';
import type { ChatMessage } from '../../conversation-runtime/messages/support.js';

export interface MultiSelectState {
  enabled: boolean;
  selectedIds: Set<string>;
}

export interface UseMessageMultiSelectReturn {
  multiSelect: MultiSelectState;
  enableMultiSelect: () => void;
  disableMultiSelect: () => void;
  toggleMessage: (messageId: string) => void;
  selectAll: (messages: ChatMessage[]) => void;
  clearSelection: () => void;
  isSelected: (messageId: string) => boolean;
  selectedCount: number;
  getSelectedMessages: (messages: ChatMessage[]) => ChatMessage[];
}

export function useMessageMultiSelect(): UseMessageMultiSelectReturn {
  const [multiSelect, setMultiSelect] = useState<MultiSelectState>({
    enabled: false,
    selectedIds: new Set(),
  });

  const enableMultiSelect = useCallback(() => {
    setMultiSelect({ enabled: true, selectedIds: new Set() });
  }, []);

  const disableMultiSelect = useCallback(() => {
    setMultiSelect({ enabled: false, selectedIds: new Set() });
  }, []);

  const toggleMessage = useCallback((messageId: string) => {
    setMultiSelect((prev) => {
      const next = new Set(prev.selectedIds);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return { ...prev, selectedIds: next };
    });
  }, []);

  const selectAll = useCallback((messages: ChatMessage[]) => {
    setMultiSelect((prev) => ({
      ...prev,
      selectedIds: new Set(messages.map((m) => m.id)),
    }));
  }, []);

  const clearSelection = useCallback(() => {
    setMultiSelect((prev) => ({ ...prev, selectedIds: new Set() }));
  }, []);

  const isSelected = useCallback(
    (messageId: string) => multiSelect.selectedIds.has(messageId),
    [multiSelect.selectedIds],
  );

  const getSelectedMessages = useCallback(
    (messages: ChatMessage[]) => messages.filter((m) => multiSelect.selectedIds.has(m.id)),
    [multiSelect.selectedIds],
  );

  return {
    multiSelect,
    enableMultiSelect,
    disableMultiSelect,
    toggleMessage,
    selectAll,
    clearSelection,
    isSelected,
    selectedCount: multiSelect.selectedIds.size,
    getSelectedMessages,
  };
}

// ---------------------------------------------------------------------------
// Multi-select toolbar — floating bar shown when multi-select is active
// ---------------------------------------------------------------------------

interface MultiSelectToolbarProps {
  selectedCount: number;
  onCopy: () => void;
  onExport: () => void;
  onBookmark: () => void;
  onSelectAll: () => void;
  onCancel: () => void;
}

export function MultiSelectToolbar({
  selectedCount,
  onCopy,
  onExport,
  onBookmark,
  onSelectAll,
  onCancel,
}: MultiSelectToolbarProps) {
  return (
    <div
      data-testid="multi-select-toolbar"
      style={{
        // 渲染在 ChatTopBar 槽内、紧贴顶栏下方,所以是普通 block;
        // sticky/fixed 都会和 SessionConversationView 的 split flex 行冲突。
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        background: 'color-mix(in oklch, var(--accent) 10%, var(--bg-overlay)',
        borderBottom: '1px solid color-mix(in oklch, var(--accent) 35%, var(--border-default)',
        flexWrap: 'wrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          borderRadius: 6,
          background: 'color-mix(in oklch, var(--accent) 24%, var(--bg-overlay)',
          color: 'var(--accent)',
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--fg-strong)',
        }}
      >
        多选模式 · 已选 <span style={{ color: 'var(--accent)' }}>{selectedCount}</span> 条
      </span>

      <span style={{ flex: 1 }} aria-hidden="true" />

      <ToolbarButton label="复制" icon="📋" onClick={onCopy} disabled={selectedCount === 0} />
      <ToolbarButton label="导出" icon="📤" onClick={onExport} disabled={selectedCount === 0} />
      <ToolbarButton label="收藏" icon="⭐" onClick={onBookmark} disabled={selectedCount === 0} />

      <div
        style={{
          width: 1,
          height: 18,
          background: 'var(--border-subtle)',
          margin: '0 4px',
        }}
      />

      <ToolbarButton label="全选" icon="☑" onClick={onSelectAll} />
      <ToolbarButton label="退出" icon="✕" onClick={onCancel} />
    </div>
  );
}

function ToolbarButton({
  label,
  icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      style={{
        height: 28,
        padding: '0 8px',
        borderRadius: 5,
        border: '1px solid var(--border-subtle)',
        background: 'transparent',
        color: disabled ? 'var(--text-4)' : 'var(--fg-default)',
        fontSize: 11,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{ fontSize: 12 }}>{icon}</span>
      {label}
    </button>
  );
}
