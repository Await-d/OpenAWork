import type { CSSProperties, ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { tokens, color } from '../tokens.js';
import { compareModelsByName } from './model-picker-search.js';

export interface AIModelConfigItem {
  id: string;
  label: string;
  enabled: boolean;
  autoCompactTargetRatio?: number;
  autoCompactThresholdRatio?: number;
  contextWindow?: number;
  inputPricePerMillion?: number;
  maxOutputTokens?: number;
  outputPricePerMillion?: number;
  supportsImageGeneration?: boolean;
  supportsImageGeneration4K?: boolean;
  supportsThinking?: boolean;
  supportsTools?: boolean;
  supportsVision?: boolean;
}

export interface AIProviderItem {
  id: string;
  name: string;
  defaultModels: AIModelConfigItem[];
}

export interface ProviderModelTestResult {
  ok: boolean;
  status: 'ok' | 'auth_error' | 'rate_limited' | 'timeout' | 'not_found' | 'error';
  message: string;
  latencyMs?: number;
}

export interface ModelManagerProps {
  provider: AIProviderItem;
  onToggleModel?: (providerId: string, modelId: string) => void;
  onAddModel?: (providerId: string, model: AIModelConfigItem) => void;
  onRemoveModel?: (providerId: string, modelId: string) => void;
  onUpdateModel?: (
    providerId: string,
    modelId: string,
    updates: Partial<AIModelConfigItem>,
  ) => void;
  /**
   * 连通性自检：对指定模型发起一次最小化上游调用，返回结构化结果。
   * 由消费方注入(走 web-client 的 `settings.testProvider`)。
   */
  onTestModel?: (providerId: string, modelId: string) => Promise<ProviderModelTestResult>;
  /**
   * 手动从 models.dev 同步内置模型目录。返回结构化结果用于按钮状态展示。
   * 由消费方注入（走 web-client 的 `settings.syncModelsCatalog`）。同步成功后
   * 通常还会触发一次 provider 列表重载，使新模型即时出现在表格里。
   */
  onSyncCatalog?: () => Promise<{
    ok: boolean;
    providerCount?: number;
    modelCount?: number;
    message?: string;
  }>;
  style?: CSSProperties;
}

const DEFAULT_AUTO_COMPACT_THRESHOLD_RATIO = 0.95;
const DEFAULT_AUTO_COMPACT_TARGET_RATIO = 0.6;

const cellStyle: CSSProperties = {
  padding: '0.6rem 0.75rem',
  fontSize: 12,
  color: 'var(--fg-default)',
  verticalAlign: 'middle',
};

const mutedStyle: CSSProperties = {
  ...cellStyle,
  color: 'var(--fg-muted)',
};

function formatContext(count: number | undefined): string {
  if (!count) return '—';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`;
  return String(count);
}

function formatPrice(price: number | undefined): string {
  if (price === undefined) return '—';
  return `$${price.toFixed(2)}`;
}

function formatRatio(value: number | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  return `${Math.round(value * 100)}%`;
}

function resolveThresholdRatio(value: number | undefined): number {
  return value ?? DEFAULT_AUTO_COMPACT_THRESHOLD_RATIO;
}

function resolveTargetRatio(value: number | undefined): number {
  return value ?? DEFAULT_AUTO_COMPACT_TARGET_RATIO;
}

function formatWindowEstimate(contextWindow: number | undefined, ratio: number): string | null {
  if (!contextWindow) {
    return null;
  }

  return formatContext(Math.round(contextWindow * ratio));
}

function buildAutoCompactSummary(model: AIModelConfigItem): string {
  const thresholdRatio = resolveThresholdRatio(model.autoCompactThresholdRatio);
  const targetRatio = resolveTargetRatio(model.autoCompactTargetRatio);
  const thresholdText = formatRatio(thresholdRatio, '');
  const targetText = formatRatio(targetRatio, '');
  const thresholdWindow = formatWindowEstimate(model.contextWindow, thresholdRatio);
  const targetWindow = formatWindowEstimate(model.contextWindow, targetRatio);

  if (thresholdWindow && targetWindow) {
    return `按当前 ${formatContext(model.contextWindow)} 上下文，约在 ${thresholdWindow} 时触发，压缩后回到约 ${targetWindow}。`;
  }

  return `预计使用达到 ${thresholdText} 时触发，压缩后回到约 ${targetText}。`;
}

function getAutoCompactWarning(model: AIModelConfigItem): string | null {
  const thresholdRatio = resolveThresholdRatio(model.autoCompactThresholdRatio);
  const targetRatio = resolveTargetRatio(model.autoCompactTargetRatio);

  if (targetRatio >= thresholdRatio) {
    return '目标比例应低于阈值，否则触发压缩后几乎没有回收空间。';
  }

  if (thresholdRatio - targetRatio < 0.1) {
    return '阈值与目标过近，压缩后释放的上下文空间可能偏少。';
  }

  return null;
}

function parseRatioInput(raw: string): number | undefined | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
    return null;
  }

  return parsed;
}

function CapabilityDot({ label }: { label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        padding: '0 6px',
        borderRadius: 999,
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        background: 'var(--bg-raised)',
        color: 'var(--fg-muted)',
        fontSize: 10,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

function InlineNotice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning';
}) {
  const palette =
    tone === 'warning'
      ? {
          background: 'rgba(245, 158, 11, 0.12)',
          border: 'rgba(245, 158, 11, 0.25)',
          color: 'var(--fg-default)',
        }
      : {
          background: 'rgba(59, 130, 246, 0.1)',
          border: 'rgba(59, 130, 246, 0.22)',
          color: 'var(--fg-default)',
        };

  return (
    <div
      style={{
        marginTop: 6,
        padding: '0.45rem 0.55rem',
        borderRadius: tokens.radius.sm,
        border: `1px solid ${palette.border}`,
        background: palette.background,
        color: palette.color,
        fontSize: 10,
        lineHeight: 1.45,
      }}
    >
      {children}
    </div>
  );
}

function ModelRatioInput({
  ariaLabel,
  fallbackLabel,
  onCommit,
  value,
}: {
  ariaLabel: string;
  fallbackLabel: string;
  onCommit?: (next: number | undefined) => void;
  value?: number;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));

  useEffect(() => {
    setDraft(value === undefined ? '' : String(value));
  }, [value]);

  const commit = () => {
    const parsed = parseRatioInput(draft);
    if (parsed === null) {
      setDraft(value === undefined ? '' : String(value));
      return;
    }

    const normalizedDraft = parsed === undefined ? '' : String(parsed);
    setDraft(normalizedDraft);
    if (parsed !== value) {
      onCommit?.(parsed);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    }

    if (event.key === 'Escape') {
      setDraft(value === undefined ? '' : String(value));
      event.currentTarget.blur();
    }
  };

  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minWidth: 92,
      }}
    >
      <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{fallbackLabel}</span>
      <input
        aria-label={ariaLabel}
        type="number"
        inputMode="decimal"
        min={0.01}
        max={0.99}
        step={0.01}
        placeholder={fallbackLabel === '阈值' ? '默认 0.95' : '默认 0.60'}
        value={draft}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          borderRadius: 6,
          color: 'var(--fg-default)',
          fontSize: 12,
          padding: '0.35rem 0.55rem',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
    </label>
  );
}

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={enabled ? '禁用模型' : '启用模型'}
      style={{
        background: enabled ? 'var(--accent)' : 'var(--border-default, hsla(215, 18%, 50%, 0.12))',
        border: 'none',
        borderRadius: 12,
        width: 40,
        height: 22,
        cursor: 'pointer',
        position: 'relative',
        flexShrink: 0,
        transition: 'background 0.2s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: enabled ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: color.fgOnAccent,
          transition: 'left 0.2s',
        }}
      />
    </button>
  );
}

export function ModelManager({
  provider,
  onToggleModel,
  onAddModel,
  onRemoveModel,
  onUpdateModel,
  onTestModel,
  onSyncCatalog,
  style,
}: ModelManagerProps) {
  const [newLabel, setNewLabel] = useState('');
  const [newId, setNewId] = useState('');
  // 每个模型独立的自检状态：testing(进行中) / 结果(成功或失败原因)。
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, ProviderModelTestResult>>({});
  // 模型目录同步状态：进行中 / 结果提示（成功统计或失败原因）。
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSyncCatalog() {
    if (!onSyncCatalog || syncing) return;
    setSyncing(true);
    setSyncNotice(null);
    try {
      const result = await onSyncCatalog();
      setSyncNotice(
        result.ok
          ? {
              ok: true,
              message: `已同步 ${result.providerCount ?? 0} 个提供商 · ${
                result.modelCount ?? 0
              } 个模型`,
            }
          : { ok: false, message: result.message ?? '同步失败' },
      );
    } catch (error) {
      setSyncNotice({
        ok: false,
        message: error instanceof Error ? error.message : '同步请求失败',
      });
    } finally {
      setSyncing(false);
    }
  }

  async function handleTestModel(modelId: string) {
    if (!onTestModel) return;
    setTesting((prev) => ({ ...prev, [modelId]: true }));
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[modelId];
      return next;
    });
    try {
      const result = await onTestModel(provider.id, modelId);
      setTestResults((prev) => ({ ...prev, [modelId]: result }));
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [modelId]: {
          ok: false,
          status: 'error',
          message: error instanceof Error ? error.message : '自检请求失败',
        },
      }));
    } finally {
      setTesting((prev) => ({ ...prev, [modelId]: false }));
    }
  }

  function handleAddModel() {
    const trimmedId = newId.trim();
    const trimmedLabel = newLabel.trim();
    if (!trimmedId || !trimmedLabel) return;
    onAddModel?.(provider.id, {
      id: trimmedId,
      label: trimmedLabel,
      enabled: true,
    });
    setNewId('');
    setNewLabel('');
  }

  const inputBase: CSSProperties = {
    background: 'var(--bg-overlay)',
    border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
    borderRadius: 6,
    color: 'var(--fg-default)',
    fontSize: 12,
    padding: '0.35rem 0.6rem',
    outline: 'none',
  };

  return (
    <div
      style={{
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        borderRadius: 12,
        overflow: 'hidden',
        fontFamily: 'system-ui, sans-serif',
        ...style,
      }}
    >
      <div
        style={{
          padding: '1rem 1.5rem',
          borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--fg-default)' }}>
            {provider.name} — 模型
          </h2>
          {onSyncCatalog ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {syncNotice ? (
                <span
                  style={{
                    fontSize: 10,
                    lineHeight: 1.4,
                    color: syncNotice.ok ? 'var(--success)' : 'var(--danger)',
                  }}
                  title={syncNotice.message}
                >
                  {syncNotice.ok ? '✓ ' : '✕ '}
                  {syncNotice.message}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void handleSyncCatalog()}
                disabled={syncing}
                title="从 models.dev 重新拉取内置模型目录（上下文长度、价格、能力等）并刷新列表"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--accent)',
                  borderRadius: 6,
                  color: 'var(--accent)',
                  padding: '0.25rem 0.75rem',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: syncing ? 'not-allowed' : 'pointer',
                  opacity: syncing ? 0.6 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {syncing ? '同步中…' : '同步模型目录'}
              </button>
            </div>
          ) : null}
        </div>
        <div
          style={{
            marginTop: tokens.spacing.sm,
            padding: `${tokens.spacing.sm}px ${tokens.spacing.md}px`,
            borderRadius: tokens.radius.md,
            border: `1px solid ${tokens.color.borderSubtle}`,
            background: tokens.color.surface2,
            display: 'grid',
            gap: tokens.spacing.xs,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: tokens.color.text,
            }}
          >
            自动压缩会按模型上下文预算判断，而不是按固定消息条数触发。
          </div>
          <div style={{ fontSize: 11, color: tokens.color.muted, lineHeight: 1.5 }}>
            阈值表示预计使用达到多少时开始压缩；目标表示压缩后希望回落到多少。留空会跟随后端默认值（阈值
            95%，目标 60%）。
          </div>
        </div>
      </div>

      {provider.defaultModels.length === 0 ? (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--fg-muted)',
            fontSize: 12,
          }}
        >
          暂无模型配置。
        </div>
      ) : (
        (() => {
          // 表格行按模型名称统一降序展示（与聊天选择器 / 设置下拉一致）。
          const sortedModels = [...provider.defaultModels].sort(compareModelsByName);
          return (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 940, borderCollapse: 'collapse' }}>
                <thead>
                  <tr
                    style={{
                      borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                    }}
                  >
                    {[
                      '模型',
                      '上下文',
                      '输出',
                      '输入 $/M',
                      '输出 $/M',
                      '自动压缩',
                      '4K',
                      '已启用',
                      '检测',
                      '',
                    ].map((h) => (
                      <th
                        key={h}
                        style={{
                          ...mutedStyle,
                          fontWeight: 500,
                          textAlign: 'left',
                          fontSize: 12,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedModels.map((model, idx) => (
                    <tr
                      key={model.id}
                      style={{
                        borderBottom:
                          idx < sortedModels.length - 1
                            ? '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))'
                            : 'none',
                        opacity: model.enabled ? 1 : 0.5,
                      }}
                    >
                      <td style={cellStyle}>
                        <div style={{ fontWeight: 500 }}>{model.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 1 }}>
                          {model.id}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                          {model.supportsImageGeneration ? <CapabilityDot label="生图" /> : null}
                          {model.supportsImageGeneration &&
                          model.supportsImageGeneration4K === true ? (
                            <CapabilityDot label="4K" />
                          ) : null}
                          {model.supportsTools ? <CapabilityDot label="工具" /> : null}
                          {model.supportsVision ? <CapabilityDot label="视觉" /> : null}
                          {model.supportsThinking ? <CapabilityDot label="思考" /> : null}
                        </div>
                      </td>
                      <td style={mutedStyle}>{formatContext(model.contextWindow)}</td>
                      <td style={mutedStyle}>{formatContext(model.maxOutputTokens)}</td>
                      <td style={mutedStyle}>{formatPrice(model.inputPricePerMillion)}</td>
                      <td style={mutedStyle}>{formatPrice(model.outputPricePerMillion)}</td>
                      <td style={cellStyle}>
                        {(() => {
                          const summary = buildAutoCompactSummary(model);
                          const warning = getAutoCompactWarning(model);

                          return (
                            <>
                              <div
                                style={{
                                  display: 'flex',
                                  gap: 8,
                                  flexWrap: 'wrap',
                                  alignItems: 'flex-end',
                                }}
                              >
                                <ModelRatioInput
                                  ariaLabel={`${model.label} 自动压缩阈值`}
                                  fallbackLabel="阈值"
                                  value={model.autoCompactThresholdRatio}
                                  onCommit={
                                    onUpdateModel
                                      ? (nextValue) => {
                                          onUpdateModel(provider.id, model.id, {
                                            autoCompactThresholdRatio: nextValue,
                                          });
                                        }
                                      : undefined
                                  }
                                />
                                <ModelRatioInput
                                  ariaLabel={`${model.label} 压缩目标比例`}
                                  fallbackLabel="目标"
                                  value={model.autoCompactTargetRatio}
                                  onCommit={
                                    onUpdateModel
                                      ? (nextValue) => {
                                          onUpdateModel(provider.id, model.id, {
                                            autoCompactTargetRatio: nextValue,
                                          });
                                        }
                                      : undefined
                                  }
                                />
                              </div>
                              <div
                                style={{
                                  marginTop: 6,
                                  fontSize: 10,
                                  color: 'var(--fg-muted)',
                                  lineHeight: 1.45,
                                }}
                              >
                                当前：阈值{' '}
                                {formatRatio(model.autoCompactThresholdRatio, '默认 95%')} · 目标{' '}
                                {formatRatio(model.autoCompactTargetRatio, '默认 60%')}
                              </div>
                              <InlineNotice tone="info">{summary}</InlineNotice>
                              {warning ? (
                                <InlineNotice tone="warning">{`提醒：${warning}`}</InlineNotice>
                              ) : null}
                            </>
                          );
                        })()}
                      </td>
                      <td style={cellStyle}>
                        {model.supportsImageGeneration ? (
                          <label
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: 11,
                              color: 'var(--fg-muted)',
                              cursor: onUpdateModel ? 'pointer' : 'default',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={model.supportsImageGeneration4K === true}
                              disabled={!onUpdateModel}
                              onChange={(event) =>
                                onUpdateModel?.(provider.id, model.id, {
                                  supportsImageGeneration4K: event.target.checked,
                                })
                              }
                            />
                            <span>支持 4K</span>
                          </label>
                        ) : null}
                      </td>
                      <td style={cellStyle}>
                        <Toggle
                          enabled={model.enabled}
                          onToggle={() => onToggleModel?.(provider.id, model.id)}
                        />
                      </td>
                      <td style={cellStyle}>
                        {(() => {
                          const isTesting = testing[model.id] === true;
                          const result = testResults[model.id];
                          const statusColor = result
                            ? result.ok
                              ? 'var(--success)'
                              : result.status === 'rate_limited'
                                ? 'var(--warning)'
                                : 'var(--danger)'
                            : 'var(--fg-muted)';
                          return (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                                minWidth: 132,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => void handleTestModel(model.id)}
                                disabled={!onTestModel || isTesting}
                                title="对该模型发起一次最小化上游调用，检查是否配置正确且可用"
                                style={{
                                  background: 'transparent',
                                  border: '1px solid var(--accent)',
                                  borderRadius: 6,
                                  color: 'var(--accent)',
                                  padding: '0.2rem 0.6rem',
                                  fontSize: 12,
                                  cursor: !onTestModel || isTesting ? 'not-allowed' : 'pointer',
                                  opacity: !onTestModel || isTesting ? 0.6 : 1,
                                  fontWeight: 500,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {isTesting ? '检测中…' : '检测连接'}
                              </button>
                              {result ? (
                                <span
                                  style={{
                                    fontSize: 10,
                                    lineHeight: 1.4,
                                    color: statusColor,
                                  }}
                                  title={result.message}
                                >
                                  {result.ok ? '✓ ' : '✕ '}
                                  {result.message.length > 28
                                    ? `${result.message.slice(0, 28)}…`
                                    : result.message}
                                </span>
                              ) : null}
                            </div>
                          );
                        })()}
                      </td>
                      <td style={cellStyle}>
                        <button
                          type="button"
                          onClick={() => onRemoveModel?.(provider.id, model.id)}
                          disabled={!onRemoveModel}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--fg-subtle)',
                            borderRadius: 6,
                            color: color.danger,
                            padding: '0.2rem 0.5rem',
                            fontSize: 12,
                            cursor: onRemoveModel ? 'pointer' : 'not-allowed',
                            opacity: onRemoveModel ? 1 : 0.5,
                          }}
                        >
                          移除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()
      )}

      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          placeholder="模型 ID"
          value={newId}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNewId(e.target.value)}
          style={{ ...inputBase, width: 140 }}
        />
        <input
          type="text"
          placeholder="显示名称"
          value={newLabel}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNewLabel(e.target.value)}
          style={{ ...inputBase, flex: 1, minWidth: 120 }}
        />
        <button
          type="button"
          onClick={handleAddModel}
          disabled={!onAddModel || !newId.trim() || !newLabel.trim()}
          style={{
            background:
              onAddModel && newId.trim() && newLabel.trim()
                ? 'var(--accent)'
                : 'var(--border-default, hsla(215, 18%, 50%, 0.12))',
            color: color.fgOnAccent,
            border: 'none',
            borderRadius: 6,
            padding: '0.35rem 0.9rem',
            fontSize: 12,
            cursor: onAddModel && newId.trim() && newLabel.trim() ? 'pointer' : 'not-allowed',
            fontWeight: 500,
          }}
        >
          + 添加自定义模型
        </button>
      </div>
    </div>
  );
}
