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
  contextWindowOverride?: number;
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
const DEFAULT_AUTOMATIC_PRESERVE_RECENT_TOKENS = 13_000;
const MIN_AUTOMATIC_PRESERVE_RECENT_TOKENS = 10_000;
const MAX_AUTOMATIC_PRESERVE_RECENT_TOKENS = 40_000;
const CONTEXT_WINDOW_PRESETS = [
  { value: '', label: '自动（模型上限）' },
  { value: '272000', label: '272K' },
  { value: '400000', label: '400K' },
  { value: '1000000', label: '1M' },
] as const;

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

function resolveEffectiveContextWindow(model: AIModelConfigItem): number | undefined {
  if (model.contextWindow === undefined || model.contextWindowOverride === undefined) {
    return model.contextWindowOverride ?? model.contextWindow;
  }
  return Math.min(model.contextWindow, model.contextWindowOverride);
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

function resolveTargetWindow(
  contextWindow: number | undefined,
  ratio: number | undefined,
): number | undefined {
  if (
    !contextWindow ||
    ratio === undefined ||
    !Number.isFinite(ratio) ||
    ratio <= 0 ||
    ratio >= 1
  ) {
    return contextWindow ? DEFAULT_AUTOMATIC_PRESERVE_RECENT_TOKENS : undefined;
  }
  return Math.max(
    MIN_AUTOMATIC_PRESERVE_RECENT_TOKENS,
    Math.min(MAX_AUTOMATIC_PRESERVE_RECENT_TOKENS, Math.floor(contextWindow * ratio)),
  );
}

function buildAutoCompactSummary(model: AIModelConfigItem): string {
  const thresholdRatio = resolveThresholdRatio(model.autoCompactThresholdRatio);
  const targetRatio = resolveTargetRatio(model.autoCompactTargetRatio);
  const contextWindow = resolveEffectiveContextWindow(model);
  const thresholdText = formatRatio(thresholdRatio, '');
  const targetWindowTokens = resolveTargetWindow(contextWindow, model.autoCompactTargetRatio);
  const targetText = targetWindowTokens
    ? formatContext(targetWindowTokens)
    : formatRatio(targetRatio, '');
  const thresholdWindow = formatWindowEstimate(contextWindow, thresholdRatio);
  const targetWindow = targetWindowTokens ? formatContext(targetWindowTokens) : null;

  if (thresholdWindow && targetWindow) {
    return `按当前 ${formatContext(contextWindow)} 上下文，约在 ${thresholdWindow} 时触发，压缩后回到约 ${targetWindow}。`;
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

function ContextWindowOverrideControl({
  model,
  onCommit,
}: {
  model: AIModelConfigItem;
  onCommit?: (value: number | undefined) => void;
}) {
  const override = model.contextWindowOverride;
  const presetValue = CONTEXT_WINDOW_PRESETS.some(
    ({ value }) => value !== '' && Number(value) === override,
  )
    ? String(override)
    : override === undefined
      ? ''
      : 'custom';
  const [customMode, setCustomMode] = useState(presetValue === 'custom');
  const [customDraft, setCustomDraft] = useState(override === undefined ? '' : String(override));

  useEffect(() => {
    setCustomMode(presetValue === 'custom');
    setCustomDraft(override === undefined ? '' : String(override));
  }, [override, presetValue]);

  return (
    <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
      <label style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
        快捷挡位
        <select
          aria-label={`${model.label} 上下文挡位`}
          value={customMode ? 'custom' : presetValue}
          disabled={!onCommit}
          onChange={(event) => {
            const value = event.target.value;
            if (value === 'custom') {
              setCustomMode(true);
              return;
            }
            setCustomMode(false);
            onCommit?.(value === '' ? undefined : Number(value));
          }}
          style={{
            display: 'block',
            marginTop: 4,
            width: '100%',
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
            borderRadius: 6,
            color: 'var(--fg-default)',
            fontSize: 11,
            padding: '0.3rem 0.4rem',
          }}
        >
          {CONTEXT_WINDOW_PRESETS.map((preset) => (
            <option key={preset.value || 'auto'} value={preset.value}>
              {preset.label}
            </option>
          ))}
          <option value="custom">自定义</option>
        </select>
      </label>
      {customMode ? (
        <input
          aria-label={`${model.label} 自定义上下文 token`}
          type="number"
          min={1024}
          step={1024}
          value={customDraft}
          onChange={(event) => setCustomDraft(event.target.value)}
          onBlur={() => {
            const value = Number(customDraft);
            if (Number.isFinite(value) && value >= 1024) {
              onCommit?.(Math.round(value));
            }
          }}
          placeholder="token 数"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
            borderRadius: 6,
            color: 'var(--fg-default)',
            fontSize: 11,
            padding: '0.3rem 0.4rem',
          }}
        />
      ) : null}
    </div>
  );
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
  // 自定义模型能力开关：自定义渠道/代理常需用户显式声明是否支持工具/视觉/思考。
  const [newSupportsTools, setNewSupportsTools] = useState(true);
  const [newSupportsVision, setNewSupportsVision] = useState(false);
  const [newSupportsThinking, setNewSupportsThinking] = useState(false);
  // 每个模型独立的自检状态：testing(进行中) / 结果(成功或失败原因)。
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, ProviderModelTestResult>>({});
  // 模型目录同步状态：进行中 / 结果提示（成功统计或失败原因）。
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<{ ok: boolean; message: string } | null>(null);
  // 模型搜索 + 折叠——模型数量多时仅渲染匹配项且默认折叠到前 N 个
  const [modelSearch, setModelSearch] = useState('');
  const [showAllModels, setShowAllModels] = useState(false);
  const COLLAPSE_THRESHOLD = 15;

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
      supportsTools: newSupportsTools,
      supportsVision: newSupportsVision,
      supportsThinking: newSupportsThinking,
    });
    setNewId('');
    setNewLabel('');
    setNewSupportsTools(true);
    setNewSupportsVision(false);
    setNewSupportsThinking(false);
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
            阈值表示预计使用达到多少时开始压缩；目标预算用于控制保留的近期上下文。留空会跟随后端默认值（阈值
            95%，近期上下文约 13K tokens）。
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
          // 搜索过滤
          const search = modelSearch.trim().toLowerCase();
          const filteredModels = search
            ? sortedModels.filter(
                (model) =>
                  model.label.toLowerCase().includes(search) ||
                  model.id.toLowerCase().includes(search),
              )
            : sortedModels;
          // 折叠逻辑：超过阈值时默认仅显示前 COLLAPSE_THRESHOLD 个
          const shouldCollapse =
            !showAllModels && !search && filteredModels.length > COLLAPSE_THRESHOLD;
          const visibleModels = shouldCollapse
            ? filteredModels.slice(0, COLLAPSE_THRESHOLD)
            : filteredModels;
          return (
            <>
              {/* 搜索栏——仅当模型总数超过阈值时显示 */}
              {sortedModels.length > COLLAPSE_THRESHOLD ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    height: 30,
                    margin: '0 1.5rem',
                    marginTop: 10,
                    borderRadius: 8,
                    border:
                      '1px solid var(--border-subtle, var(--border-default, hsla(215, 18%, 50%, 0.12)))',
                    background: 'var(--bg-raised)',
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
                    style={{ color: 'var(--fg-muted)', flexShrink: 0 }}
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  <input
                    value={modelSearch}
                    onChange={(event) => {
                      setModelSearch(event.target.value);
                      setShowAllModels(false);
                    }}
                    placeholder={`搜索 ${sortedModels.length} 个模型…`}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: 'var(--fg-default)',
                      fontSize: 11,
                    }}
                  />
                  {modelSearch ? (
                    <button
                      type="button"
                      onClick={() => setModelSearch('')}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--fg-muted)',
                        cursor: 'pointer',
                        fontSize: 11,
                        padding: 0,
                      }}
                    >
                      清除
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div style={{ overflowX: 'auto', marginTop: 10 }}>
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
                    {visibleModels.map((model, idx) => (
                      <tr
                        key={model.id}
                        style={{
                          borderBottom:
                            idx < visibleModels.length - 1
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
                            {onUpdateModel ? (
                              <>
                                <label
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 10,
                                    color: 'var(--fg-muted)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={model.supportsTools === true}
                                    onChange={(event) =>
                                      onUpdateModel(provider.id, model.id, {
                                        supportsTools: event.target.checked,
                                      })
                                    }
                                  />
                                  工具
                                </label>
                                <label
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 10,
                                    color: 'var(--fg-muted)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={model.supportsVision === true}
                                    onChange={(event) =>
                                      onUpdateModel(provider.id, model.id, {
                                        supportsVision: event.target.checked,
                                      })
                                    }
                                  />
                                  视觉
                                </label>
                                <label
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    fontSize: 10,
                                    color: 'var(--fg-muted)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={model.supportsThinking === true}
                                    onChange={(event) =>
                                      onUpdateModel(provider.id, model.id, {
                                        supportsThinking: event.target.checked,
                                      })
                                    }
                                  />
                                  思考
                                </label>
                              </>
                            ) : (
                              <>
                                {model.supportsTools ? <CapabilityDot label="工具" /> : null}
                                {model.supportsVision ? <CapabilityDot label="视觉" /> : null}
                                {model.supportsThinking ? <CapabilityDot label="思考" /> : null}
                              </>
                            )}
                          </div>
                        </td>
                        <td style={cellStyle}>
                          <div style={mutedStyle}>
                            {formatContext(resolveEffectiveContextWindow(model))}
                          </div>
                          {model.contextWindowOverride !== undefined ? (
                            <div style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>
                              模型上限 {formatContext(model.contextWindow)}
                            </div>
                          ) : null}
                          <ContextWindowOverrideControl
                            model={model}
                            onCommit={
                              onUpdateModel
                                ? (value) =>
                                    onUpdateModel(provider.id, model.id, {
                                      contextWindowOverride: value,
                                    })
                                : undefined
                            }
                          />
                        </td>
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
                {shouldCollapse ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      padding: '0.75rem 1.5rem',
                      borderTop: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                    }}
                  >
                    <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                      已显示前 {COLLAPSE_THRESHOLD} 个，还有{' '}
                      {filteredModels.length - COLLAPSE_THRESHOLD} 个模型被折叠
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAllModels(true)}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--accent)',
                        borderRadius: 6,
                        color: 'var(--accent)',
                        padding: '0.25rem 0.75rem',
                        fontSize: 11,
                        fontWeight: 500,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      展开全部
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          );
        })()
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.45 }}>
          添加模型：填写上游 model id
          与显示名。自定义渠道/中转请按实际上游能力勾选工具、视觉、思考。
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <input
            type="text"
            placeholder="模型 ID（如 gpt-4o / claude-sonnet-4-0）"
            value={newId}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNewId(e.target.value)}
            style={{ ...inputBase, width: 220 }}
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
            + 添加模型
          </button>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 14,
            alignItems: 'center',
            flexWrap: 'wrap',
            fontSize: 11,
            color: 'var(--fg-muted)',
          }}
        >
          <label
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={newSupportsTools}
              onChange={(e) => setNewSupportsTools(e.target.checked)}
            />
            工具调用
          </label>
          <label
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={newSupportsVision}
              onChange={(e) => setNewSupportsVision(e.target.checked)}
            />
            视觉
          </label>
          <label
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={newSupportsThinking}
              onChange={(e) => setNewSupportsThinking(e.target.checked)}
            />
            思考
          </label>
        </div>
      </div>
    </div>
  );
}
