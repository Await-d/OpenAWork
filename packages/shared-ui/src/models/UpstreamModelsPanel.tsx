import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { color, radius, tokens } from '../tokens.js';

/**
 * 由本地同名模型迁移而来的元数据(上游 `/models` 不返回这些字段)。
 * 导入时会按 id 从本地配置迁移,避免同步进来的模型没有上下文大小 / 能力标记。
 */
export interface UpstreamModelMetadata {
  contextWindow?: number;
  maxOutputTokens?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
  supportsImageGeneration?: boolean;
  supportsImageGeneration4K?: boolean;
  reasoningOptions?: { type: string; values?: string[] }[];
}

/** 上游暴露的单个模型条目(仅保留同步所需字段)。 */
export interface UpstreamModelItem {
  id: string;
  label: string;
  ownedBy?: string;
  /** 本地同名模型迁移来的元数据(可能为空,表示本地没有同 id 的模型)。 */
  meta?: UpstreamModelMetadata;
}

/** 拉取上游模型列表的状态分类。 */
export type UpstreamModelsStatus =
  'ok' | 'auth_error' | 'rate_limited' | 'timeout' | 'not_found' | 'unsupported' | 'error';

/** 拉取上游模型列表的结构化结果(与网关 `/settings/providers/upstream-models` 对齐)。 */
export interface UpstreamModelsResult {
  ok: boolean;
  status: UpstreamModelsStatus;
  message: string;
  models: UpstreamModelItem[];
  protocol?: string;
  baseUrl?: string;
  latencyMs?: number;
}

/** 当前 provider 已配置的模型(用于判断「已添加」以及是否缺少可迁移的元数据)。 */
export interface UpstreamExistingModel extends UpstreamModelMetadata {
  id: string;
}

export interface UpstreamModelsPanelProps {
  result: UpstreamModelsResult;
  /**
   * 当前 provider 已配置的模型清单。除标记「已添加」外,还用于识别「已存在但缺少
   * 上下文 / 能力」的项——这些会被默认勾选,便于一次性把元数据补齐。
   */
  existingModels: UpstreamExistingModel[];
  /** 导入进行中(禁用交互)。 */
  importing: boolean;
  onImport: (models: UpstreamModelItem[]) => void;
  onClose: () => void;
}

/** 本地索引里存在、且当前模型缺少这些字段时,视为「可补齐」。 */
function needsBackfill(
  current: UpstreamExistingModel,
  meta: UpstreamModelMetadata | undefined,
): boolean {
  if (!meta) return false;
  return (Object.keys(meta) as (keyof UpstreamModelMetadata)[]).some(
    (key) => meta[key] !== undefined && current[key] === undefined,
  );
}

/**
 * 模型 id 的匹配键:上游与本地的大小写 / 首尾空白差异不应阻止「同名」判定
 * (例如上游返回 `GPT-4o`、本地配置为 `gpt-4o`)。仅用于匹配,展示仍用原始 id。
 */
function normalizeModelIdKey(id: string): string {
  return id.trim().toLowerCase();
}

const panelStyle: CSSProperties = {
  marginTop: tokens.spacing.sm,
  border: `1px solid ${tokens.color.borderSubtle}`,
  borderRadius: tokens.radius.md,
  background: tokens.color.surface2,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: tokens.spacing.sm,
  padding: `${tokens.spacing.sm}px ${tokens.spacing.md}px`,
  borderBottom: `1px solid ${tokens.color.borderSubtle}`,
};

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: tokens.spacing.sm,
  padding: `${tokens.spacing.xs}px ${tokens.spacing.md}px`,
  borderBottom: `1px solid ${tokens.color.borderSubtle}`,
  flexWrap: 'wrap',
};

const ghostButtonStyle: CSSProperties = {
  background: 'transparent',
  border: `1px solid ${color.borderEmphasis}`,
  borderRadius: tokens.radius.sm,
  color: 'var(--fg-muted)',
  padding: '0.2rem 0.6rem',
  fontSize: 11,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const listStyle: CSSProperties = {
  maxHeight: 260,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: tokens.spacing.sm,
  padding: `${tokens.spacing.xs}px ${tokens.spacing.md}px`,
  borderBottom: `1px solid ${tokens.color.borderSubtle}`,
};

const footerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: tokens.spacing.sm,
  padding: `${tokens.spacing.sm}px ${tokens.spacing.md}px`,
  borderTop: `1px solid ${tokens.color.borderSubtle}`,
  flexWrap: 'wrap',
};

function statusColor(status: UpstreamModelsStatus): string {
  if (status === 'ok') return 'var(--success)';
  if (status === 'auth_error' || status === 'not_found') return 'var(--contrast)';
  return 'var(--danger)';
}

function badgeStyle(textColor: string): CSSProperties {
  return {
    fontSize: 10,
    color: textColor,
    border: `1px solid ${tokens.color.borderSubtle}`,
    borderRadius: radius.xs,
    padding: '0 4px',
    flexShrink: 0,
  };
}

/** 上下文窗口的紧凑显示(1M / 200K / 128K)。 */
function formatContext(count: number | undefined): string | null {
  if (typeof count !== 'number' || count <= 0) return null;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count % 1_000_000 === 0 ? 0 : 1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
  return String(count);
}

/**
 * 上游模型同步面板:展示「从当前接口上游拉取到的模型」,允许勾选后导入到当前
 * provider 的模型列表。已存在的 model id 会标记为「已添加」并默认不勾选。
 */
export function UpstreamModelsPanel({
  result,
  existingModels,
  importing,
  onImport,
  onClose,
}: UpstreamModelsPanelProps) {
  const existingMap = useMemo(
    () => new Map(existingModels.map((model) => [normalizeModelIdKey(model.id), model])),
    [existingModels],
  );
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // 待同步集合:未添加的 + 已添加但缺上下文 / 能力的(后者只补缺失字段)。
  const pendingIds = useMemo(() => {
    const ids: string[] = [];
    for (const model of result.models) {
      const current = existingMap.get(normalizeModelIdKey(model.id));
      if (!current || needsBackfill(current, model.meta)) {
        ids.push(model.id);
      }
    }
    return ids;
  }, [result.models, existingMap]);

  const backfillCount = useMemo(
    () =>
      result.models.filter((model) => {
        const current = existingMap.get(normalizeModelIdKey(model.id));
        return current !== undefined && needsBackfill(current, model.meta);
      }).length,
    [result.models, existingMap],
  );

  // 每次拿到新结果时,默认勾选「待同步」的模型。
  useEffect(() => {
    setSelected(new Set(pendingIds));
  }, [pendingIds]);

  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return result.models;
    return result.models.filter(
      (model) => model.id.toLowerCase().includes(q) || model.label.toLowerCase().includes(q),
    );
  }, [result.models, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAllPending() {
    setSelected(new Set(pendingIds));
  }

  function clearAll() {
    setSelected(new Set());
  }

  const selectedModels = result.models.filter((model) => selected.has(model.id));
  const selectedNewCount = selectedModels.filter(
    (model) => !existingMap.has(normalizeModelIdKey(model.id)),
  ).length;

  return (
    <div style={panelStyle} data-testid="upstream-models-panel">
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.sm }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: tokens.color.text }}>
            上游可用模型
          </span>
          <span style={{ fontSize: 11, color: tokens.color.muted }}>
            {result.ok
              ? `共 ${result.models.length} 个 · ${pendingIds.length} 个待同步${
                  backfillCount > 0 ? `(其中 ${backfillCount} 个可补齐)` : ''
                }`
              : result.message}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacing.sm }}>
          {result.baseUrl ? (
            <span
              style={{
                fontSize: 10,
                color: tokens.color.muted,
                maxWidth: 260,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={result.baseUrl}
            >
              {result.baseUrl}
            </span>
          ) : null}
          <button type="button" onClick={onClose} style={ghostButtonStyle}>
            关闭
          </button>
        </div>
      </div>

      {!result.ok ? (
        <div
          style={{
            padding: `${tokens.spacing.md}px`,
            fontSize: 12,
            lineHeight: 1.5,
            color: statusColor(result.status),
          }}
        >
          {result.message}
        </div>
      ) : result.models.length === 0 ? (
        <div style={{ padding: `${tokens.spacing.md}px`, fontSize: 12, color: tokens.color.muted }}>
          上游未返回任何模型,请确认该接口是否暴露了 `/models` 端点。
        </div>
      ) : (
        <>
          <div style={toolbarStyle}>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索模型 id / 名称..."
              style={{
                flex: 1,
                minWidth: 140,
                background: 'var(--bg-overlay)',
                border: `1px solid ${color.borderDefault}`,
                borderRadius: radius.sm,
                color: 'var(--fg-default)',
                fontSize: 11,
                padding: '0.3rem 0.5rem',
                outline: 'none',
              }}
            />
            <button type="button" onClick={selectAllPending} style={ghostButtonStyle}>
              全选待同步
            </button>
            <button type="button" onClick={clearAll} style={ghostButtonStyle}>
              清空
            </button>
          </div>

          <div style={listStyle}>
            {filteredModels.length === 0 ? (
              <div
                style={{
                  padding: `${tokens.spacing.md}px`,
                  fontSize: 11,
                  color: tokens.color.muted,
                }}
              >
                没有匹配的模型。
              </div>
            ) : (
              filteredModels.map((model) => {
                const current = existingMap.get(normalizeModelIdKey(model.id));
                const already = current !== undefined;
                const backfill = already && needsBackfill(current, model.meta);
                const checked = selected.has(model.id);
                // 上下文优先展示本地已有值(已添加),否则展示待迁移值。
                const context = formatContext(current?.contextWindow ?? model.meta?.contextWindow);
                return (
                  <label key={model.id} style={{ ...rowStyle, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={importing}
                      onChange={() => toggle(model.id)}
                      aria-label={`选择 ${model.id}`}
                    />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12,
                        color: already && !backfill ? tokens.color.muted : 'var(--fg-default)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={model.label}
                    >
                      {model.label}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: tokens.color.muted,
                        fontFamily: 'ui-monospace, monospace',
                        maxWidth: 220,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={model.id}
                    >
                      {model.id}
                    </span>
                    {context ? (
                      <span style={badgeStyle('var(--aux)')} title="本地同名模型的上下文窗口">
                        {context}
                      </span>
                    ) : null}
                    {model.ownedBy ? (
                      <span style={badgeStyle(tokens.color.muted)}>{model.ownedBy}</span>
                    ) : null}
                    {backfill ? (
                      <span
                        style={badgeStyle('var(--contrast)')}
                        title="本地同名模型有上下文 / 能力,可补齐当前缺失字段"
                      >
                        可补齐
                      </span>
                    ) : already ? (
                      <span style={badgeStyle('var(--success)')}>已添加</span>
                    ) : null}
                  </label>
                );
              })
            )}
          </div>

          <div style={footerStyle}>
            <span style={{ fontSize: 11, color: tokens.color.muted }}>
              已选 {selectedModels.length} 个(未添加 {selectedNewCount} · 补齐{' '}
              {selectedModels.length - selectedNewCount})· 缺失的上下文 / 能力按本地同名模型迁移
            </span>
            <div style={{ display: 'flex', gap: tokens.spacing.sm }}>
              <button type="button" onClick={onClose} style={ghostButtonStyle} disabled={importing}>
                取消
              </button>
              <button
                type="button"
                disabled={importing || selectedModels.length === 0}
                onClick={() => onImport(selectedModels)}
                style={{
                  background:
                    importing || selectedModels.length === 0
                      ? color.borderDefault
                      : 'var(--accent)',
                  color: 'var(--fg-on-accent)',
                  border: 'none',
                  borderRadius: tokens.radius.sm,
                  padding: '0.3rem 0.9rem',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: importing || selectedModels.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: importing || selectedModels.length === 0 ? 0.6 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {importing ? '导入中...' : `导入选中 (${selectedModels.length})`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
