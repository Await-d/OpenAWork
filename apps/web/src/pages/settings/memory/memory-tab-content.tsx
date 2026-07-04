import React, { useMemo, useRef, useState } from 'react';
import type {
  MemoryActionFeedback,
  MemoryEntry,
  MemoryLoadStatus,
  MemorySource,
  MemoryStats,
  MemoryType,
  UseMemoryManagementResult,
} from './memory-types.js';
import { BP, IS, SS, ST } from '../shared/settings-section-styles.js';
import { MemorySettingsPanel } from './memory-settings-panel.js';

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

const TYPE_ORDER: MemoryType[] = [
  'preference',
  'fact',
  'instruction',
  'project_context',
  'learned_pattern',
];

/* ── 样式常量（遵循 token 阶梯） ───────────────────── */

const BADGE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: 9999,
  fontSize: 10,
  fontWeight: 600,
  lineHeight: 1.4,
  letterSpacing: '0.02em',
  whiteSpace: 'nowrap',
};

const CARD: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid var(--border-default)',
  background: 'color-mix(in srgb, var(--bg-overlay) 94%, var(--bg-base))',
  padding: '12px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  transition: 'border-color 180ms ease, box-shadow 180ms ease',
};

const CARD_HOVER: React.CSSProperties = {
  ...CARD,
  borderColor: 'var(--accent)',
  boxShadow: '0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent)',
};

const KPI_CARD: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '12px 16px',
  borderRadius: 12,
  border: '1px solid var(--border-default)',
  background: 'linear-gradient(180deg, var(--bg-overlay), var(--bg-raised))',
  flex: 1,
  minWidth: 0,
  position: 'relative',
  overflow: 'hidden',
};

const KPI_NUM: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  lineHeight: 1.1,
  fontVariantNumeric: 'tabular-nums',
};

const KPI_LABEL: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 500,
};

const KPI_TOP_LINE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 1,
  background: 'linear-gradient(90deg, transparent, var(--border-emphasis), transparent)',
};

const ERROR_BOX: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--danger) 42%, var(--border-default))',
  background: 'color-mix(in srgb, var(--danger) 8%, var(--bg-overlay))',
  padding: '16px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const EMPTY_BOX: React.CSSProperties = {
  borderRadius: 12,
  border: '1px dashed var(--border-emphasis)',
  background: 'color-mix(in srgb, var(--bg-overlay) 96%, var(--bg-base))',
  padding: '40px 24px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  textAlign: 'center',
};

const BTN_GHOST: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--fg-default)',
  cursor: 'pointer',
  transition: 'background 150ms ease, border-color 150ms ease',
  whiteSpace: 'nowrap',
};

const BTN_DANGER: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid color-mix(in srgb, var(--danger) 40%, var(--border-default))',
  borderRadius: 8,
  padding: '5px 10px',
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--danger)',
  cursor: 'pointer',
  transition: 'background 150ms ease',
  whiteSpace: 'nowrap',
};

const FILTER_CHIP: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-default)',
  borderRadius: 9999,
  padding: '4px 12px',
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  transition: 'all 150ms ease',
  whiteSpace: 'nowrap',
};

const FILTER_CHIP_ACTIVE: React.CSSProperties = {
  ...FILTER_CHIP,
  background: 'var(--accent-muted)',
  border: '1px solid var(--accent-border)',
  color: 'var(--accent)',
};

/* ── 工具函数 ──────────────────────────────────────── */

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

/* ── 子组件 ────────────────────────────────────────── */

function LoadingPulse() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          style={{
            height: 56,
            borderRadius: 12,
            background:
              'linear-gradient(90deg, var(--bg-overlay) 25%, color-mix(in srgb, var(--bg-overlay) 80%, var(--accent)) 50%, var(--bg-overlay) 75%)',
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

function KpiGrid({ stats, status }: { stats: MemoryStats | null; status: MemoryLoadStatus }) {
  if (status === 'loading' || !stats) {
    return (
      <div style={{ display: 'flex', gap: 12 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            style={{
              ...KPI_CARD,
              height: 64,
              background:
                'linear-gradient(90deg, var(--bg-overlay) 25%, color-mix(in srgb, var(--bg-overlay) 80%, var(--accent)) 50%, var(--bg-overlay) 75%)',
              backgroundSize: '200% 100%',
              animation: `memoryShimmer 1.6s ease-in-out infinite`,
              animationDelay: `${String(i * 100)}ms`,
            }}
          />
        ))}
        <style>{`@keyframes memoryShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      </div>
    );
  }

  const cells: Array<{ label: string; value: string; accent?: boolean }> = [
    { label: '总条目', value: String(stats.total), accent: true },
    { label: '已启用', value: String(stats.enabled) },
    { label: '已停用', value: String(stats.disabled) },
    { label: '自动提取', value: String(stats.bySource.auto_extracted) },
  ];

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {cells.map((cell) => (
        <div key={cell.label} style={KPI_CARD}>
          <div style={KPI_TOP_LINE} />
          <span style={{ ...KPI_NUM, color: cell.accent ? 'var(--accent)' : 'var(--fg-strong)' }}>
            {cell.value}
          </span>
          <span style={KPI_LABEL}>{cell.label}</span>
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
      bg: 'color-mix(in srgb, var(--accent) 10%, var(--bg-overlay))',
      color: 'var(--accent)',
    },
    success: {
      bg: 'color-mix(in srgb, var(--success) 10%, var(--bg-overlay))',
      color: 'var(--success)',
    },
    error: {
      bg: 'color-mix(in srgb, var(--danger) 10%, var(--bg-overlay))',
      color: 'var(--danger)',
    },
    idle: {
      bg: 'transparent',
      color: 'var(--fg-muted)',
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
      {/* ── 行 1：类型 + 来源 + 启用状态 + 时间 ── */}
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
            color: 'var(--fg-muted)',
            background: 'color-mix(in srgb, var(--fg-muted) 10%, transparent)',
          }}
        >
          {SOURCE_LABELS[entry.source]}
        </span>
        <span
          style={{
            ...BADGE,
            color: entry.enabled ? 'var(--success)' : 'var(--fg-muted)',
            background: entry.enabled
              ? 'color-mix(in srgb, var(--success) 12%, transparent)'
              : 'color-mix(in srgb, var(--fg-muted) 10%, transparent)',
          }}
        >
          {entry.enabled ? '启用' : '停用'}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: 'var(--fg-muted)',
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatDate(entry.createdAt)}
        </span>
      </div>

      {/* ── 行 2：键名 + 置信度/优先级辅助信息 ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>
          {entry.key}
        </span>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          置信度 {formatConfidence(entry.confidence)} · 优先级 {String(entry.priority)}
        </span>
      </div>

      {/* ── 行 3：作用域（如有） ── */}
      {entry.workspaceRoot && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--fg-default)',
            padding: '6px 10px',
            borderRadius: 8,
            background: 'color-mix(in srgb, var(--bg-overlay) 75%, var(--bg-base))',
            border: '1px solid var(--border-subtle)',
            wordBreak: 'break-word',
          }}
        >
          作用域：{entry.workspaceRoot}
        </div>
      )}

      {/* ── 行 4：值 / 编辑区 ── */}
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
              style={{ ...BP, padding: '6px 14px', fontSize: 11 }}
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
            color: 'var(--fg-strong)',
            margin: 0,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {entry.value}
        </p>
      )}

      {/* ── 行 5：操作栏 ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
          paddingTop: 2,
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          更新于 {formatDate(entry.updatedAt)}
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

/* ── 主组件 ────────────────────────────────────────── */

export function MemoryTabContent({ memoryState }: MemoryTabContentProps) {
  const {
    filteredMemories,
    memories,
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

  const [typeFilter, setTypeFilter] = useState<MemoryType | 'all'>('all');

  // 按类型筛选（在搜索基础上叠加）
  const visibleMemories = useMemo(() => {
    if (typeFilter === 'all') {
      return filteredMemories;
    }
    return filteredMemories.filter((m) => m.type === typeFilter);
  }, [filteredMemories, typeFilter]);

  // 计算各类型计数（基于全量数据，非搜索结果）
  const typeCounts = useMemo(() => {
    const counts: Record<MemoryType, number> = {
      preference: 0,
      fact: 0,
      instruction: 0,
      project_context: 0,
      learned_pattern: 0,
    };
    for (const m of memories) {
      counts[m.type]++;
    }
    return counts;
  }, [memories]);

  // 是否有该类型的条目（用于隐藏空类型 chip）
  const availableTypes = useMemo(() => TYPE_ORDER.filter((t) => typeCounts[t] > 0), [typeCounts]);

  const hasActiveFilter = searchQuery.trim().length > 0 || typeFilter !== 'all';

  return (
    <>
      <ActionFeedbackBar feedback={actionFeedback} onClear={clearActionFeedback} />

      {/* ── 概览区：KPI + 操作 ── */}
      <section style={SS}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={ST}>记忆概览</h3>
          <div style={{ display: 'flex', gap: 8 }}>
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
            <button
              type="button"
              style={BP}
              onClick={() => void extractMemories()}
              aria-label="提取记忆"
            >
              提取记忆
            </button>
          </div>
        </div>
        <KpiGrid stats={stats} status={statsStatus} />
      </section>

      {/* ── 设置区 ── */}
      <section style={SS}>
        <h3 style={ST}>记忆设置</h3>
        <MemorySettingsPanel
          settings={settings}
          settingsStatus={settingsStatus}
          updateSettings={updateSettings}
        />
      </section>

      {/* ── 记忆列表区 ── */}
      <section style={SS}>
        {/* 工具栏：标题 + 搜索 + 计数 */}
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
          {memories.length > 0 && (
            <span
              style={{
                fontSize: 10,
                color: 'var(--fg-muted)',
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
              }}
            >
              {String(visibleMemories.length)} / {String(memories.length)}
            </span>
          )}
        </div>

        {/* 类型筛选 chips（仅有数据时显示） */}
        {availableTypes.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              style={typeFilter === 'all' ? FILTER_CHIP_ACTIVE : FILTER_CHIP}
              onClick={() => setTypeFilter('all')}
            >
              全部
            </button>
            {availableTypes.map((t) => (
              <button
                key={t}
                type="button"
                style={typeFilter === t ? FILTER_CHIP_ACTIVE : FILTER_CHIP}
                onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}
              >
                {TYPE_LABELS[t]}
                <span
                  style={{
                    marginLeft: 4,
                    opacity: 0.6,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {String(typeCounts[t])}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* 加载态 */}
        {loadStatus === 'loading' && <LoadingPulse />}

        {/* 错误态 */}
        {loadStatus === 'error' && loadError && (
          <div style={ERROR_BOX}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)' }}>
              记忆加载失败
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-default)', wordBreak: 'break-word' }}>
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

        {/* 空态 */}
        {loadStatus === 'loaded' && visibleMemories.length === 0 && (
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
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-strong)' }}>
              {hasActiveFilter ? '未找到匹配的记忆' : '还没有记忆'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', maxWidth: 260 }}>
              {hasActiveFilter
                ? '尝试调整搜索关键词或筛选条件'
                : 'Agent 会自动提取关键记忆，你也可以手动触发一次提取。'}
            </div>
            {!hasActiveFilter && (
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

        {/* 记忆卡片列表 */}
        {loadStatus === 'loaded' && visibleMemories.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleMemories.map((entry) => (
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
