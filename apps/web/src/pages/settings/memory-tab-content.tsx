import React, { useRef, useState } from 'react';
import type {
  MemoryActionFeedback,
  MemoryEntry,
  MemoryLoadStatus,
  MemorySettings,
  MemorySource,
  MemoryStats,
  MemoryType,
  UseMemoryManagementResult,
} from './memory-types.js';
import { BP, IS, SS, ST } from './settings-section-styles.js';

interface MemoryTabContentProps {
  memoryState: UseMemoryManagementResult;
}

const SOURCE_LABELS: Record<MemorySource, string> = {
  manual: '手动',
  auto_extracted: '自动提取',
  api: 'API',
};

const TYPE_LABELS: Record<MemoryType, string> = {
  preference: '偏好',
  fact: '事实',
  instruction: '指令',
  project_context: '项目上下文',
  learned_pattern: '学习模式',
};

const BADGE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 7px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 600,
  lineHeight: 1.4,
  letterSpacing: '0.02em',
  whiteSpace: 'nowrap',
};

const CARD: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'color-mix(in srgb, var(--surface) 94%, var(--bg))',
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  transition: 'border-color 180ms ease, box-shadow 180ms ease',
};

const CARD_HOVER: React.CSSProperties = {
  ...CARD,
  borderColor: 'var(--accent)',
  boxShadow: '0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent)',
};

const STAT_CELL: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  padding: '10px 0',
  flex: 1,
  minWidth: 0,
};

const STAT_NUM: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--text)',
  lineHeight: 1.2,
  fontVariantNumeric: 'tabular-nums',
};

const STAT_LABEL: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-3)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 500,
};

const ERROR_BOX: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--danger) 42%, var(--border))',
  background: 'color-mix(in srgb, var(--danger) 8%, var(--surface))',
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const EMPTY_BOX: React.CSSProperties = {
  borderRadius: 10,
  border: '1px dashed var(--border)',
  background: 'color-mix(in srgb, var(--surface) 96%, var(--bg))',
  padding: '32px 20px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 10,
  textAlign: 'center',
};

const TOGGLE_TRACK: React.CSSProperties = {
  position: 'relative',
  width: 36,
  height: 20,
  borderRadius: 10,
  cursor: 'pointer',
  transition: 'background 200ms ease',
  flexShrink: 0,
  border: 'none',
  padding: 0,
};

const TOGGLE_KNOB: React.CSSProperties = {
  position: 'absolute',
  top: 2,
  width: 16,
  height: 16,
  borderRadius: '50%',
  background: 'white',
  transition: 'left 200ms ease',
  boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
};

const BTN_GHOST: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '5px 10px',
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--text-2)',
  cursor: 'pointer',
  transition: 'background 150ms ease, border-color 150ms ease',
  whiteSpace: 'nowrap',
};

const BTN_DANGER: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid color-mix(in srgb, var(--danger) 40%, var(--border))',
  borderRadius: 8,
  padding: '4px 8px',
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--danger)',
  cursor: 'pointer',
  transition: 'background 150ms ease',
  whiteSpace: 'nowrap',
};

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatConfidence(confidence: number): string {
  return `${String(Math.round(confidence * 100))}%`;
}

function LoadingPulse() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '8px 0',
      }}
    >
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          style={{
            height: 56,
            borderRadius: 10,
            background:
              'linear-gradient(90deg, var(--surface) 25%, color-mix(in srgb, var(--surface) 80%, var(--accent)) 50%, var(--surface) 75%)',
            backgroundSize: '200% 100%',
            animation: `memoryShimmer 1.6s ease-in-out infinite`,
            animationDelay: `${String(i * 120)}ms`,
          }}
        />
      ))}
      <style>{`@keyframes memoryShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </div>
  );
}

function StatsBar({ stats, status }: { stats: MemoryStats | null; status: MemoryLoadStatus }) {
  if (status === 'loading' || !stats) {
    return (
      <div
        style={{
          height: 64,
          borderRadius: 10,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          color: 'var(--text-3)',
        }}
      >
        {status === 'loading' ? '统计加载中…' : '暂无统计数据'}
      </div>
    );
  }

  const cells: Array<{ label: string; value: string }> = [
    { label: '总条目', value: String(stats.total) },
    { label: '已启用', value: String(stats.enabled) },
    { label: '手动', value: String(stats.bySource.manual) },
    { label: '自动提取', value: String(stats.bySource.auto_extracted) },
  ];

  return (
    <div
      style={{
        display: 'flex',
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        overflow: 'hidden',
      }}
    >
      {cells.map((cell, idx) => (
        <div
          key={cell.label}
          style={{
            ...STAT_CELL,
            borderLeft: idx > 0 ? '1px solid var(--border-subtle)' : 'none',
          }}
        >
          <span style={STAT_NUM}>{cell.value}</span>
          <span style={STAT_LABEL}>{cell.label}</span>
        </div>
      ))}
    </div>
  );
}

function ActionFeedbackBar({
  feedback,
  onClear,
}: {
  feedback: MemoryActionFeedback;
  onClear: () => void;
}) {
  if (feedback.status === 'idle') {
    return null;
  }

  const colorMap = {
    pending: {
      bg: 'color-mix(in srgb, var(--accent) 10%, var(--surface))',
      color: 'var(--accent)',
    },
    success: {
      bg: 'color-mix(in srgb, var(--success) 10%, var(--surface))',
      color: 'var(--success)',
    },
    error: {
      bg: 'color-mix(in srgb, var(--danger) 10%, var(--surface))',
      color: 'var(--danger)',
    },
    idle: {
      bg: 'transparent',
      color: 'var(--text-3)',
    },
  } as const;
  const scheme = colorMap[feedback.status];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        borderRadius: 8,
        padding: '8px 12px',
        background: scheme.bg,
        color: scheme.color,
        fontSize: 11,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <span>{feedback.message}</span>
      {feedback.status !== 'pending' && (
        <button
          type="button"
          onClick={onClear}
          aria-label="关闭提示"
          style={{
            background: 'none',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
            padding: '0 2px',
            opacity: 0.7,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function MemoryCard({
  entry,
  onDelete,
  onUpdate,
}: {
  entry: MemoryEntry;
  onDelete: (id: string) => Promise<void>;
  onUpdate: (id: string, value: string) => Promise<void>;
}) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(entry.value);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== entry.value) {
      void onUpdate(entry.id, trimmed);
    }
    setEditing(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setEditValue(entry.value);
      setEditing(false);
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      handleSave();
    }
  };

  const handleDeleteClick = () => {
    if (confirmDelete) {
      void onDelete(entry.id);
      setConfirmDelete(false);
      return;
    }

    setConfirmDelete(true);
    setTimeout(() => setConfirmDelete(false), 3000);
  };

  return (
    <div
      style={hovered ? CARD_HOVER : CARD}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setConfirmDelete(false);
      }}
      role="article"
      aria-label={`记忆条目 ${entry.key}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            ...BADGE,
            color: 'var(--accent)',
            background: 'var(--accent-muted)',
          }}
        >
          {TYPE_LABELS[entry.type]}
        </span>
        <span
          style={{
            ...BADGE,
            color: 'var(--text-2)',
            background: 'color-mix(in srgb, var(--text-3) 10%, transparent)',
          }}
        >
          {SOURCE_LABELS[entry.source]}
        </span>
        <span
          style={{
            ...BADGE,
            color: entry.enabled ? 'var(--success)' : 'var(--text-3)',
            background: entry.enabled
              ? 'color-mix(in srgb, var(--success) 12%, transparent)'
              : 'color-mix(in srgb, var(--text-3) 10%, transparent)',
          }}
        >
          {entry.enabled ? '已启用' : '已停用'}
        </span>
        <span
          style={{
            ...BADGE,
            color: 'var(--text-3)',
            background: 'color-mix(in srgb, var(--border) 60%, transparent)',
          }}
        >
          置信度 {formatConfidence(entry.confidence)}
        </span>
        <span
          style={{
            ...BADGE,
            color: 'var(--text-3)',
            background: 'color-mix(in srgb, var(--border) 60%, transparent)',
          }}
        >
          优先级 {String(entry.priority)}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: 'var(--text-3)',
            whiteSpace: 'nowrap',
          }}
        >
          {formatDate(entry.createdAt)}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase' }}>键</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{entry.key}</div>
      </div>

      {entry.workspaceRoot && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-2)',
            padding: '8px 10px',
            borderRadius: 8,
            background: 'color-mix(in srgb, var(--surface) 75%, var(--bg))',
            border: '1px solid var(--border-subtle)',
            wordBreak: 'break-word',
          }}
        >
          作用域：{entry.workspaceRoot}
        </div>
      )}

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            ref={textareaRef}
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            style={{
              ...IS,
              resize: 'vertical',
              minHeight: 56,
              fontFamily: 'inherit',
              lineHeight: 1.5,
            }}
            aria-label="编辑记忆值"
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              type="button"
              style={BTN_GHOST}
              onClick={() => {
                setEditValue(entry.value);
                setEditing(false);
              }}
            >
              取消
            </button>
            <button
              type="button"
              style={{ ...BP, padding: '5px 12px', fontSize: 11 }}
              onClick={handleSave}
            >
              保存
            </button>
          </div>
        </div>
      ) : (
        <p
          style={{
            fontSize: 12,
            color: 'var(--text)',
            margin: 0,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {entry.value}
        </p>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
          更新时间 {formatDate(entry.updatedAt)}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {!editing && (
            <button
              type="button"
              style={BTN_GHOST}
              onClick={() => {
                setEditValue(entry.value);
                setEditing(true);
                requestAnimationFrame(() => textareaRef.current?.focus());
              }}
              aria-label="编辑"
            >
              编辑
            </button>
          )}
          <button
            type="button"
            style={{
              ...BTN_DANGER,
              background: confirmDelete
                ? 'color-mix(in srgb, var(--danger) 12%, transparent)'
                : 'transparent',
            }}
            onClick={handleDeleteClick}
            aria-label={confirmDelete ? '确认删除' : '删除'}
          >
            {confirmDelete ? '确认删除？' : '删除'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  ariaLabel,
  onToggle,
}: {
  title: string;
  description: string;
  checked: boolean;
  ariaLabel: string;
  onToggle: () => void;
}) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
        <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        style={{
          ...TOGGLE_TRACK,
          background: checked ? 'var(--accent)' : 'var(--border)',
        }}
        onClick={onToggle}
      >
        <span
          style={{
            ...TOGGLE_KNOB,
            left: checked ? 18 : 2,
          }}
        />
      </button>
    </div>
  );
}

function SettingsPanel({
  settings,
  settingsStatus,
  updateSettings,
}: {
  settings: MemorySettings;
  settingsStatus: MemoryLoadStatus;
  updateSettings: (patch: Partial<MemorySettings>) => Promise<void>;
}) {
  if (settingsStatus === 'loading') {
    return <div style={{ fontSize: 11, color: 'var(--text-3)', padding: 8 }}>设置加载中…</div>;
  }

  if (settingsStatus === 'error') {
    return (
      <div style={{ fontSize: 11, color: 'var(--danger)', padding: 8 }}>
        设置加载失败，请稍后重试。
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ToggleRow
        title="启用记忆系统"
        description="关闭后不会在 system prompt 注入记忆，也不会自动提取。"
        checked={settings.enabled}
        ariaLabel="切换记忆系统"
        onToggle={() => void updateSettings({ enabled: !settings.enabled })}
      />

      <ToggleRow
        title="自动提取"
        description="每次请求完成后，从用户消息里提取可复用的记忆。"
        checked={settings.autoExtract}
        ariaLabel="切换自动提取"
        onToggle={() => void updateSettings({ autoExtract: !settings.autoExtract })}
      />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 160 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-2)' }}>
            最大注入预算
          </span>
          <input
            type="number"
            min={100}
            max={10000}
            value={settings.maxTokenBudget}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(value) && value >= 100 && value <= 10000) {
                void updateSettings({ maxTokenBudget: value });
              }
            }}
            style={{ ...IS, width: '100%' }}
            aria-label="最大注入预算"
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 160 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-2)' }}>最低置信度</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={settings.minConfidence}
            onChange={(event) => {
              const value = Number.parseFloat(event.target.value);
              if (Number.isFinite(value) && value >= 0 && value <= 1) {
                void updateSettings({ minConfidence: value });
              }
            }}
            style={{ ...IS, width: '100%' }}
            aria-label="最低置信度"
          />
        </label>
      </div>
    </div>
  );
}

export function MemoryTabContent({ memoryState }: MemoryTabContentProps) {
  const {
    filteredMemories,
    loadStatus,
    loadError,
    stats,
    statsStatus,
    settings,
    settingsStatus,
    actionFeedback,
    searchQuery,
    setSearchQuery,
    refreshMemories,
    refreshStats,
    deleteMemory,
    updateMemory,
    extractMemories,
    updateSettings,
    clearActionFeedback,
  } = memoryState;

  return (
    <>
      <ActionFeedbackBar feedback={actionFeedback} onClear={clearActionFeedback} />

      <section style={SS}>
        <h3 style={ST}>记忆概览</h3>
        <StatsBar stats={stats} status={statsStatus} />
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <button
            type="button"
            style={BP}
            onClick={() => void extractMemories()}
            aria-label="提取记忆"
          >
            提取记忆
          </button>
          <button
            type="button"
            style={BTN_GHOST}
            onClick={() => {
              void refreshMemories();
              void refreshStats();
            }}
            aria-label="刷新"
          >
            刷新
          </button>
        </div>
      </section>

      <section style={SS}>
        <h3 style={ST}>记忆设置</h3>
        <SettingsPanel
          settings={settings}
          settingsStatus={settingsStatus}
          updateSettings={updateSettings}
        />
      </section>

      <section style={SS}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h3 style={{ ...ST, margin: 0, flex: 'none' }}>记忆列表</h3>
          <input
            type="search"
            placeholder="搜索 key、value、类型、来源…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            style={{
              ...IS,
              flex: 1,
              minWidth: 160,
              maxWidth: 320,
            }}
            aria-label="搜索记忆"
          />
        </div>

        {loadStatus === 'loading' && <LoadingPulse />}

        {loadStatus === 'error' && loadError && (
          <div style={ERROR_BOX}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)' }}>
              记忆加载失败
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', wordBreak: 'break-word' }}>
              {loadError}
            </div>
            <button
              type="button"
              style={{ ...BTN_GHOST, alignSelf: 'flex-start' }}
              onClick={() => void refreshMemories()}
            >
              重试
            </button>
          </div>
        )}

        {loadStatus === 'loaded' && filteredMemories.length === 0 && (
          <div style={EMPTY_BOX}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'var(--accent-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
              }}
            >
              ✦
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              {searchQuery ? '未找到匹配的记忆' : '还没有记忆'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', maxWidth: 260 }}>
              {searchQuery
                ? '尝试调整搜索关键词，或清除搜索查看所有记忆'
                : 'Agent 会自动提取关键记忆，你也可以手动触发一次提取。'}
            </div>
            {!searchQuery && (
              <button
                type="button"
                style={{ ...BP, marginTop: 4 }}
                onClick={() => void extractMemories()}
              >
                立即提取
              </button>
            )}
          </div>
        )}

        {loadStatus === 'loaded' && filteredMemories.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredMemories.map((entry) => (
              <MemoryCard
                key={entry.id}
                entry={entry}
                onDelete={deleteMemory}
                onUpdate={updateMemory}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
