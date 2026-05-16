import { useCallback, useState } from 'react';
import type { ChatMessage } from '../session-conversation/runtime/support.js';

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
        // 使用 fixed 定位让 toolbar 始终对齐视口中心,而非父级(此前 sticky
        // 在窄消息列容器内,会被侧边栏/编辑器影响视觉位置)。
        position: 'fixed',
        bottom: 96,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 14px',
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        zIndex: 100,
        width: 'fit-content',
        // 防止超过视口
        maxWidth: 'calc(100vw - 32px)',
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-2)',
          marginRight: 4,
        }}
      >
        已选 {selectedCount} 条
      </span>

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
      <ToolbarButton label="取消" icon="✕" onClick={onCancel} />
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
        color: disabled ? 'var(--text-4)' : 'var(--text-2)',
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
