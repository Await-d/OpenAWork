import { color } from '../tokens.js';
import { useMemo, useState } from 'react';
import type { CSSProperties, SyntheticEvent } from 'react';
import {
  IMAGE_GENERATION_SIZE_PRESET_GROUPS,
  resolveImageGenerationSizePresetId,
  validateImageGenerationSize,
} from '@openAwork/shared';
import {
  canConfigureThinkingForModel,
  describeReasoningEffort,
  getSupportedReasoningEffortsForModel,
  inferSupportsThinking,
} from './model-reasoning-support.js';
import {
  resolveProviderVisual,
  lookupProviderEntry,
  getProviderUiList,
} from './provider-catalog-ui.js';
import type { ProviderUpstreamVariantUi } from './provider-catalog-ui.js';
import { ModelManager } from './ModelManager.js';
import type { ProviderModelTestResult } from './ModelManager.js';
import type { SupportedReasoningEffort } from './model-reasoning-support.js';
import { buildFilteredModelGroups, compareModelsByName } from './model-picker-search.js';

function ProviderLogo({ type, size = 28 }: { type: string; size?: number }) {
  const visual = resolveProviderVisual({ providerType: type });
  const url = visual.logoUrl;
  const glyph = visual.fallbackGlyph ?? type.slice(0, 2);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        overflow: 'hidden',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {url ? (
        <img
          src={url}
          alt={type}
          width={Math.round(size * 0.72)}
          height={Math.round(size * 0.72)}
          style={{ objectFit: 'contain', filter: 'var(--provider-logo-filter, none)' }}
          onError={(e: SyntheticEvent<HTMLImageElement>) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <span
          style={{
            fontSize: Math.round(size * 0.45),
            fontWeight: 700,
            color: 'var(--fg-muted)',
            textTransform: 'uppercase',
          }}
        >
          {glyph}
        </span>
      )}
    </div>
  );
}

export interface AIModelConfigRef {
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
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
}

export interface AIProviderRef {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  /** Override the auto-detected upstream protocol.
   *  - 'responses':       Use OpenAI Responses API (/v1/responses)
   *  - 'chat_completions': Use OpenAI Chat Completions API (/v1/chat/completions)
   *  - undefined:          Auto-detect based on provider type and base URL
   */
  upstreamProtocol?: 'chat_completions' | 'responses' | 'anthropic_messages';
  defaultModels: AIModelConfigRef[];
}

export interface ActiveSelectionRef {
  chat: { providerId: string; modelId: string };
  fast: { providerId: string; modelId: string };
  image?: { providerId: string; modelId: string };
  compaction?: { providerId: string; modelId: string };
}

export interface ImageGenerationDefaultsRef {
  size: string;
  quality: 'low' | 'medium' | 'high';
  outputFormat: 'png' | 'jpeg' | 'webp';
  background: 'auto' | 'opaque';
}

export type ReasoningEffortRef = SupportedReasoningEffort;

export interface ThinkingModeRef {
  enabled: boolean;
  effort: ReasoningEffortRef;
}

export interface ThinkingDefaultsRef {
  chat: ThinkingModeRef;
  fast: ThinkingModeRef;
}

export interface ProviderEditData {
  name: string;
  type: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  upstreamProtocol?: 'chat_completions' | 'responses' | 'anthropic_messages';
}

export interface ProviderSettingsProps {
  providers: AIProviderRef[];
  active: ActiveSelectionRef;
  defaultThinking?: ThinkingDefaultsRef;
  imageDefaults?: ImageGenerationDefaultsRef;
  hasUnsavedDefaultChanges?: boolean;
  isSavingDefaultChanges?: boolean;
  onSetActiveChat: (providerId: string, modelId: string) => void;
  onSetActiveFast?: (providerId: string, modelId: string) => void;
  onSetActiveImage?: (providerId: string, modelId: string) => void;
  onSaveDefaultChanges?: () => void;
  onSetThinkingMode?: (mode: keyof ThinkingDefaultsRef, value: ThinkingModeRef) => void;
  onSetImageDefaults?: (updates: Partial<ImageGenerationDefaultsRef>) => void;
  onToggleProvider?: (id: string) => void;
  onEditProvider: (id: string, data: ProviderEditData) => void;
  onAddProvider: (data: ProviderEditData) => void;
  onToggleModel?: (providerId: string, modelId: string) => void;
  onAddModel?: (providerId: string, model: AIModelConfigRef) => void;
  onRemoveModel?: (providerId: string, modelId: string) => void;
  onUpdateModel?: (providerId: string, modelId: string, updates: Partial<AIModelConfigRef>) => void;
  /** 连通性自检回调：对指定 provider+模型发起最小化上游调用并返回结果。 */
  onTestModel?: (providerId: string, modelId: string) => Promise<ProviderModelTestResult>;
  /** 手动从 models.dev 同步内置模型目录（透传给每个 provider 的 ModelManager）。 */
  onSyncCatalog?: () => Promise<{
    ok: boolean;
    providerCount?: number;
    modelCount?: number;
    message?: string;
  }>;
  /** 从 models.dev 发现尚未内置的平台。 */
  onDiscoverProviders?: () => Promise<{
    providers: Array<{
      id: string;
      name: string;
      api?: string;
      modelCount: number;
      sampleModels?: Array<{ id: string; name: string }>;
    }>;
  }>;
  /** 导入发现到的平台为 custom provider。 */
  onImportDiscoveredProvider?: (modelsDevProviderId: string) => Promise<void>;
  style?: CSSProperties;
}

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-muted)',
  marginBottom: 4,
};

const inputStyle: CSSProperties = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
  borderRadius: 6,
  color: 'var(--fg-default)',
  fontSize: 12,
  padding: '0.35rem 0.6rem',
  width: '100%',
  boxSizing: 'border-box',
};

function emptyForm(provider?: AIProviderRef): ProviderEditData {
  // 新增默认落到「自定义渠道」：用户可自行填上游与模型；编辑时保留原 type。
  const type = provider?.type ?? 'custom';
  return {
    name: provider?.name ?? (type === 'custom' ? '自定义渠道' : ''),
    type,
    enabled: provider?.enabled ?? true,
    apiKey: provider?.apiKey ?? '',
    baseUrl: provider?.baseUrl ?? '',
    upstreamProtocol: provider?.upstreamProtocol,
  };
}

function formatContextWindow(value: number | undefined): string | null {
  if (!value) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function CapabilityPill({
  label,
  tone = 'default',
}: {
  label: string;
  tone?: 'default' | 'accent' | 'violet' | 'emerald';
}) {
  const palette =
    tone === 'accent'
      ? { bg: 'rgba(59, 130, 246, 0.10)', color: 'var(--fg-default)' }
      : tone === 'violet'
        ? { bg: 'rgba(139, 92, 246, 0.12)', color: 'var(--fg-default)' }
        : tone === 'emerald'
          ? { bg: 'rgba(16, 185, 129, 0.12)', color: 'var(--fg-default)' }
          : { bg: 'var(--bg-raised)', color: 'var(--fg-muted)' };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        padding: '0 6px',
        borderRadius: 999,
        background: palette.bg,
        color: palette.color,
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        fontSize: 10,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

interface InlineFormProps {
  initial: ProviderEditData;
  isNew: boolean;
  onSubmit: (data: ProviderEditData) => void;
  onCancel: () => void;
}

function InlineProviderForm({ initial, isNew, onSubmit, onCancel }: InlineFormProps) {
  const [form, setForm] = useState<ProviderEditData>(initial);
  const [formError, setFormError] = useState<string | null>(null);

  function set(field: keyof ProviderEditData, value: string | boolean | undefined) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function requiresBaseUrl(type: string): boolean {
    return type === 'custom' || type === 'azure';
  }

  function isValidHttpUrl(value: string): boolean {
    try {
      const u = new URL(value);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function handleSubmit() {
    const base = form.baseUrl.trim();
    if (requiresBaseUrl(form.type)) {
      if (!base) {
        setFormError(
          form.type === 'azure'
            ? 'Azure OpenAI 必须填写资源 endpoint（例如 https://{resource}.openai.azure.com）'
            : '自定义渠道必须填写上游 Base URL',
        );
        return;
      }
      if (!isValidHttpUrl(base)) {
        setFormError('Base URL 必须是合法的 http(s) 地址');
        return;
      }
    }
    setFormError(null);
    onSubmit({
      ...form,
      name: form.name.trim(),
      baseUrl: base,
      apiKey: form.apiKey.trim(),
    });
  }

  // 当前所选平台类型在 catalog 里的条目(用于上游变体快捷填充与显示名)。
  const catalogEntry = useMemo(() => lookupProviderEntry(form.type), [form.type]);
  const upstreamVariants = catalogEntry?.upstreams ?? [];

  /** 选择一个上游变体：自动填好 baseUrl + 协议，避免手填错端点(如 MiMo 双上游)。 */
  function applyUpstreamVariant(variant: ProviderUpstreamVariantUi) {
    setForm((prev) => ({
      ...prev,
      baseUrl: variant.baseUrl,
      upstreamProtocol: variant.protocol,
    }));
  }

  const catalogOptions = useMemo(() => getProviderUiList(), []);

  const formWrap: CSSProperties = {
    background: 'var(--bg-raised)',
    border: '1px solid var(--accent)',
    borderRadius: 8,
    padding: '1rem 1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  };

  const row: CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap' };
  const col: CSSProperties = { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 160 };

  const guidance =
    form.type === 'custom'
      ? '自定义渠道：自行填写上游 Base URL、协议与 API Key，保存后在模型列表添加任意 model id（中转 / LM Studio / vLLM / OneAPI 等）。'
      : form.type === 'azure'
        ? '填写 Azure 资源 endpoint；模型 id 使用部署名（deployment name）。'
        : null;

  // 类型下拉：自定义渠道置顶，其余按 catalog 顺序。
  const typeOptions = useMemo(() => {
    const customEntry = catalogOptions.find((entry) => entry.type === 'custom');
    const rest = catalogOptions.filter((entry) => entry.type !== 'custom');
    return [
      customEntry ?? {
        type: 'custom',
        displayName: '自定义渠道',
      },
      ...rest,
    ];
  }, [catalogOptions]);

  return (
    <div style={formWrap}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--accent)',
          marginBottom: 4,
        }}
      >
        {isNew ? '新增渠道' : '编辑渠道'}
      </div>
      {guidance ? (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.45 }}>{guidance}</div>
      ) : null}
      <div style={row}>
        <div style={col}>
          <label htmlFor="pf-name" style={labelStyle}>
            名称
          </label>
          <input
            id="pf-name"
            style={inputStyle}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder={
              form.type === 'custom' ? '例如：公司中转 / LM Studio / 自建网关' : 'Provider name'
            }
          />
        </div>
        <div style={col}>
          <label htmlFor="pf-type" style={labelStyle}>
            类型
          </label>
          {isNew ? (
            // 新增时从 catalog 选择平台类型(也允许自定义)，选后自动带出默认名/上游。
            <select
              id="pf-type"
              style={inputStyle}
              value={form.type || 'custom'}
              onChange={(e) => {
                const nextType = e.target.value;
                const entry = lookupProviderEntry(nextType);
                const defaultUpstream =
                  entry?.upstreams?.find((u) => u.isDefault) ?? entry?.upstreams?.[0];
                setFormError(null);
                setForm((prev) => {
                  const prevWasDefaultName =
                    prev.name.trim().length === 0 ||
                    prev.name === prev.type ||
                    prev.name === '自定义渠道' ||
                    prev.name === (lookupProviderEntry(prev.type)?.displayName ?? '');
                  return {
                    ...prev,
                    type: nextType,
                    // 名称未改过时带出平台默认显示名，便于多实例区分时再手动改。
                    name: prevWasDefaultName
                      ? nextType === 'custom'
                        ? '自定义渠道'
                        : (entry?.displayName ?? nextType)
                      : prev.name,
                    ...(nextType === 'custom'
                      ? {
                          // 切到自定义时清空内置默认上游，避免误用其它平台 endpoint。
                          baseUrl: prev.type === 'custom' ? prev.baseUrl : '',
                          upstreamProtocol:
                            prev.type === 'custom' ? prev.upstreamProtocol : undefined,
                        }
                      : defaultUpstream
                        ? {
                            baseUrl: defaultUpstream.baseUrl,
                            upstreamProtocol: defaultUpstream.protocol,
                          }
                        : {}),
                  };
                });
              }}
            >
              {typeOptions.map((entry) => (
                <option key={entry.type} value={entry.type}>
                  {entry.type === 'custom'
                    ? `${entry.displayName}（自填上游 / 模型）`
                    : entry.displayName}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="pf-type"
              style={{ ...inputStyle, opacity: 0.6 }}
              value={
                form.type === 'custom'
                  ? '自定义渠道'
                  : (lookupProviderEntry(form.type)?.displayName ?? form.type)
              }
              placeholder="openai / anthropic …"
              disabled
            />
          )}
        </div>
      </div>
      {upstreamVariants.length > 1 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>上游入口（该平台提供多个，选择后自动填充地址与协议）</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {upstreamVariants.map((variant) => {
              const active =
                form.baseUrl === variant.baseUrl &&
                (form.upstreamProtocol ?? undefined) === (variant.protocol ?? undefined);
              return (
                <button
                  key={`${variant.label}-${variant.baseUrl}`}
                  type="button"
                  onClick={() => applyUpstreamVariant(variant)}
                  style={{
                    border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                    borderRadius: 999,
                    padding: '0.3rem 0.7rem',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    color: active ? 'var(--fg-strong)' : 'var(--fg-default)',
                    background: active ? 'white' : 'var(--bg-overlay)',
                    boxShadow: active ? 'var(--shadow-sm)' : 'none',
                  }}
                  title={variant.baseUrl}
                >
                  {variant.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div style={row}>
        <div style={col}>
          <label htmlFor="pf-apikey" style={labelStyle}>
            API Key
          </label>
          <input
            id="pf-apikey"
            style={inputStyle}
            value={form.apiKey}
            onChange={(e) => set('apiKey', e.target.value)}
            placeholder="sk-…"
            type="password"
            autoComplete="new-password"
          />
        </div>
        <div style={col}>
          <label htmlFor="pf-baseurl" style={labelStyle}>
            上游 Base URL{requiresBaseUrl(form.type) ? ' *' : ''}
          </label>
          <input
            id="pf-baseurl"
            style={inputStyle}
            value={form.baseUrl}
            onChange={(e) => {
              setFormError(null);
              set('baseUrl', e.target.value);
            }}
            placeholder={
              form.type === 'azure'
                ? 'https://{resource}.openai.azure.com'
                : form.type === 'custom'
                  ? 'https://your-gateway.example.com/v1'
                  : 'https://api.example.com/v1'
            }
          />
        </div>
        <div style={col}>
          <label htmlFor="pf-protocol" style={labelStyle}>
            上游协议
          </label>
          <select
            id="pf-protocol"
            style={inputStyle}
            value={form.upstreamProtocol ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              set('upstreamProtocol', v === '' ? undefined : v);
            }}
          >
            <option value="">自动检测</option>
            <option value="chat_completions">Chat Completions (/v1/chat/completions)</option>
            <option value="responses">Responses (/v1/responses)</option>
            <option value="anthropic_messages">Anthropic Messages (/v1/messages)</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          id="provider-form-enabled"
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => set('enabled', e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        <label
          htmlFor="provider-form-enabled"
          style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }}
        >
          启用
        </label>
      </div>
      {formError ? (
        <div style={{ color: 'var(--danger, #ef4444)', fontSize: 12 }}>{formError}</div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
            borderRadius: 6,
            color: 'var(--fg-default)',
            padding: '0.3rem 0.8rem',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          style={{
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 6,
            color: color.fgOnAccent,
            padding: '0.3rem 0.8rem',
            fontSize: 12,
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          保存
        </button>
      </div>
    </div>
  );
}

export function ProviderSettings({
  providers,
  active,
  defaultThinking,
  imageDefaults,
  hasUnsavedDefaultChanges,
  isSavingDefaultChanges,
  onSetActiveChat,
  onSetActiveFast,
  onSetActiveImage,
  onSaveDefaultChanges,
  onSetThinkingMode,
  onSetImageDefaults,
  onToggleProvider,
  onEditProvider,
  onAddProvider,
  onToggleModel,
  onAddModel,
  onRemoveModel,
  onUpdateModel,
  onTestModel,
  onSyncCatalog,
  onDiscoverProviders,
  onImportDiscoveredProvider,
  style,
}: ProviderSettingsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverItems, setDiscoverItems] = useState<
    Array<{ id: string; name: string; api?: string; modelCount: number }>
  >([]);
  const [discoverQuery, setDiscoverQuery] = useState('');
  const [importingId, setImportingId] = useState<string | null>(null);
  const [forceCustomImageSize, setForceCustomImageSize] = useState(false);

  async function openDiscover() {
    if (!onDiscoverProviders) return;
    setDiscoverOpen(true);
    setDiscoverLoading(true);
    setDiscoverError(null);
    setDiscoverQuery('');
    try {
      const res = await onDiscoverProviders();
      setDiscoverItems(res.providers ?? []);
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscoverLoading(false);
    }
  }

  async function importDiscovered(id: string) {
    if (!onImportDiscoveredProvider) return;
    setImportingId(id);
    setDiscoverError(null);
    try {
      await onImportDiscoveredProvider(id);
      setDiscoverOpen(false);
      setDiscoverQuery('');
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportingId(null);
    }
  }
  const [modelSearch, setModelSearch] = useState<{ chat: string; fast: string; image: string }>({
    chat: '',
    fast: '',
    image: '',
  });

  const enabledProviders = useMemo(
    () =>
      providers
        .filter((provider) => provider.enabled)
        .map((provider) => ({
          ...provider,
          defaultModels: provider.defaultModels.filter((model) => model.enabled),
        }))
        .filter((provider) => provider.defaultModels.length > 0),
    [providers],
  );

  function findSelectedModel(
    selected: { providerId: string; modelId: string },
    candidateProviders: AIProviderRef[] = enabledProviders,
  ) {
    const provider = candidateProviders.find((item) => item.id === selected.providerId);
    const model = provider?.defaultModels.find((item) => item.id === selected.modelId);
    return { provider, model };
  }

  function renderThinkingControls(
    mode: keyof ThinkingDefaultsRef,
    selectedProviderType: string | undefined,
    selectedModel?: AIModelConfigRef,
    title = '默认思考',
    description = '新会话会继承这里的默认值；若模型本身固定带思考，请求时会自动安全降级。',
  ) {
    if (!defaultThinking || !onSetThinkingMode) {
      return null;
    }

    const current = defaultThinking[mode];
    const supportsThinking = inferSupportsThinking(
      selectedProviderType,
      selectedModel?.id,
      selectedModel?.supportsThinking === true,
    );
    const canConfigureThinking = canConfigureThinkingForModel(
      selectedProviderType,
      selectedModel?.id,
      selectedModel?.supportsThinking === true,
    );
    const controlEnabled = supportsThinking && canConfigureThinking;
    const supportedEfforts = getSupportedReasoningEffortsForModel(
      selectedProviderType,
      selectedModel?.id,
    );

    return (
      <div
        style={{
          borderTop:
            '1px solid var(--border-subtle, var(--border-default, hsla(215, 18%, 50%, 0.12)))',
          paddingTop: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 600 }}>{title}</div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
              {description}
            </div>
          </div>
          {supportsThinking ? (
            <CapabilityPill
              label={canConfigureThinking ? '可切换思考' : '模型自带思考'}
              tone="violet"
            />
          ) : (
            <CapabilityPill label="当前模型不支持" />
          )}
        </div>
        {!supportsThinking ? (
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.45 }}>
            当前模型不支持思考配置，这里的默认值不会被实际请求使用。
          </div>
        ) : null}
        {supportsThinking && !canConfigureThinking ? (
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.45 }}>
            这个模型的思考能力由模型本身决定，当前网关不会单独下发开关或力度参数。
          </div>
        ) : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            disabled={!controlEnabled}
            onClick={() => onSetThinkingMode(mode, { enabled: false, effort: current.effort })}
            style={{
              border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
              borderRadius: 999,
              padding: '0.35rem 0.7rem',
              fontSize: 11,
              fontWeight: 600,
              cursor: controlEnabled ? 'pointer' : 'not-allowed',
              opacity: controlEnabled ? 1 : 0.45,
              color: !current.enabled ? 'var(--fg-strong)' : 'var(--fg-default)',
              background: !current.enabled ? 'white' : 'var(--bg-raised)',
              boxShadow: !current.enabled ? 'var(--shadow-sm)' : 'none',
            }}
          >
            关闭思考
          </button>
          {supportedEfforts.map((level) => {
            const activeLevel = current.enabled && current.effort === level;
            return (
              <button
                key={level}
                type="button"
                disabled={!controlEnabled}
                onClick={() => onSetThinkingMode(mode, { enabled: true, effort: level })}
                style={{
                  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                  borderRadius: 999,
                  padding: '0.35rem 0.7rem',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: controlEnabled ? 'pointer' : 'not-allowed',
                  opacity: controlEnabled ? 1 : 0.45,
                  color: activeLevel ? 'var(--fg-strong)' : 'var(--fg-default)',
                  background: activeLevel ? 'white' : 'var(--bg-raised)',
                  boxShadow: activeLevel ? 'var(--shadow-sm)' : 'none',
                  textTransform: 'uppercase',
                }}
                title={describeReasoningEffort(level)}
              >
                {level}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderModelSelect(
    mode: 'chat' | 'fast' | 'image',
    label: string,
    selected: { providerId: string; modelId: string },
    onChange: (providerId: string, modelId: string) => void,
  ) {
    const candidateProviders = enabledProviders
      .map((provider) => ({
        ...provider,
        defaultModels: provider.defaultModels.filter((model) =>
          mode === 'image' ? model.supportsImageGeneration === true : true,
        ),
      }))
      .filter((provider) => provider.defaultModels.length > 0);
    const search = modelSearch[mode].trim();
    const { provider: selectedProvider, model: selectedModel } = findSelectedModel(
      selected,
      candidateProviders,
    );
    const visibleProvider = selectedProvider ?? candidateProviders[0];
    const showingSearchResults = search.length > 0;
    const searchGroups = showingSearchResults
      ? buildFilteredModelGroups(visibleProvider ? [visibleProvider] : [], search)
      : [];
    const visibleModels = showingSearchResults
      ? []
      : [...(visibleProvider?.defaultModels ?? [])].sort(compareModelsByName);
    const contextLabel = formatContextWindow(selectedModel?.contextWindow);
    const thinkingMode: keyof ThinkingDefaultsRef | null = mode === 'image' ? null : mode;
    const thinkingTitle = mode === 'fast' ? 'Fast 默认思考' : '默认思考';
    const thinkingDescription =
      mode === 'fast'
        ? 'Fast 快速模型会用于标题、内联、辅助与子任务等轻量路径。'
        : '新会话会继承这里的默认值；若模型本身固定带思考，请求时会自动安全降级。';

    const applySelection = (providerId: string, modelId: string) => {
      onChange(providerId, modelId);
      setModelSearch((prev) => ({
        ...prev,
        [mode]: '',
      }));
    };

    const renderModelRow = (
      provider: Pick<AIProviderRef, 'id' | 'name' | 'type'>,
      model: Pick<
        AIModelConfigRef,
        | 'id'
        | 'contextWindow'
        | 'supportsTools'
        | 'supportsVision'
        | 'supportsImageGeneration'
        | 'supportsThinking'
      > & {
        label: string;
      },
      index: number,
      total: number,
    ) => {
      const isActive = provider.id === selected.providerId && model.id === selected.modelId;
      const modelContext = formatContextWindow(model.contextWindow);
      const capabilitySummary = [
        model.supportsVision ? '视觉' : null,
        model.supportsImageGeneration ? '生图' : null,
        model.supportsTools ? '工具' : null,
        model.supportsThinking ? '思考' : null,
        modelContext,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' · ');
      const modelSummary = model.label;
      const modelSummaryTitle =
        model.id === model.label ? model.label : `${model.label} · ${model.id}`;

      return (
        <button
          key={`${provider.id}-${model.id}`}
          type="button"
          onClick={() => applySelection(provider.id, model.id)}
          style={{
            width: '100%',
            border: 'none',
            borderBottom:
              index < total - 1
                ? '1px solid var(--border-subtle, var(--border-default, hsla(215, 18%, 50%, 0.12)))'
                : 'none',
            padding: '0.58rem 0.15rem',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            textAlign: 'left',
            cursor: 'pointer',
            background: isActive ? 'white' : 'transparent',
            boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
            color: 'var(--fg-default)',
          }}
        >
          <span
            style={{
              width: 16,
              display: 'flex',
              justifyContent: 'center',
              color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
              flexShrink: 0,
            }}
          >
            {isActive ? '●' : '○'}
          </span>
          <span
            style={{
              minWidth: 0,
              flex: 1,
              fontSize: 11.5,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={modelSummaryTitle}
          >
            {modelSummary}
          </span>
          {capabilitySummary ? (
            <span
              style={{
                flexShrink: 0,
                maxWidth: '42%',
                fontSize: 10.5,
                color: 'var(--fg-muted)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={capabilitySummary}
            >
              {capabilitySummary}
            </span>
          ) : null}
        </button>
      );
    };

    const renderSearchResultGroups = () => {
      if (searchGroups.length === 0) {
        return (
          <div
            style={{
              padding: '0.8rem 0',
              color: 'var(--fg-muted)',
              fontSize: 12,
            }}
          >
            没有匹配到模型，请换个关键词。
          </div>
        );
      }

      return searchGroups.map(({ provider, models }) => (
        <div key={`${mode}-${provider.id}`}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 0 3px',
              borderTop:
                '1px solid var(--border-subtle, var(--border-default, hsla(215, 18%, 50%, 0.12)))',
            }}
          >
            <div
              style={{
                width: 15,
                height: 15,
                borderRadius: 4,
                background: 'var(--bg-overlay)',
                border:
                  '1px solid var(--border-subtle, var(--border-default, hsla(215, 18%, 50%, 0.12)))',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <img
                src={`/logo-${provider.type}.svg`}
                alt={provider.name}
                width={11}
                height={11}
                style={{ objectFit: 'contain', filter: 'var(--provider-logo-filter, none)' }}
                onError={(event: SyntheticEvent<HTMLImageElement>) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            </div>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: 'var(--fg-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {provider.name}
            </span>
          </div>
          {models.map((model, index) =>
            renderModelRow(
              provider,
              {
                ...model,
                label: model.name,
              },
              index,
              models.length,
            ),
          )}
        </div>
      ));
    };

    return (
      <div
        style={{
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          borderRadius: 12,
          padding: '0.85rem 1rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                ...labelStyle,
                marginBottom: 3,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--fg-default)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={
                selectedProvider
                  ? `${selectedModel?.label ?? '请选择默认模型'} · ${selectedProvider.name} · ${selectedModel?.id ?? ''}`
                  : '将用于新会话的默认起点'
              }
            >
              {selectedProvider
                ? `${selectedModel?.label ?? '请选择默认模型'} · ${selectedProvider.name} · ${selectedModel?.id ?? ''}`
                : '将用于新会话的默认起点'}
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {selectedModel?.supportsVision && <CapabilityPill label="视觉" tone="emerald" />}
            {selectedModel?.supportsImageGeneration && (
              <CapabilityPill label="生图" tone="accent" />
            )}
            {selectedModel?.supportsTools && <CapabilityPill label="工具" tone="accent" />}
            {selectedModel?.supportsThinking && <CapabilityPill label="思考" tone="violet" />}
            {contextLabel && <CapabilityPill label={contextLabel} />}
          </div>
        </div>

        {candidateProviders.length > 1 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {candidateProviders.map((provider) => {
              const isActiveProvider = provider.id === visibleProvider?.id;
              return (
                <button
                  key={`${mode}-provider-${provider.id}`}
                  type="button"
                  onClick={() => {
                    const nextModel =
                      provider.defaultModels.find((model) => model.id === selected.modelId) ??
                      provider.defaultModels[0];
                    if (nextModel) {
                      onChange(provider.id, nextModel.id);
                    }
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                    borderRadius: 999,
                    background: isActiveProvider ? 'white' : 'transparent',
                    boxShadow: isActiveProvider ? 'var(--shadow-sm)' : 'none',
                    color: isActiveProvider ? 'var(--fg-strong)' : 'var(--fg-default)',
                    padding: '0.28rem 0.65rem',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <ProviderLogo type={provider.type} size={14} />
                  <span>{provider.name}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            height: 30,
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
            value={modelSearch[mode]}
            onChange={(event) =>
              setModelSearch((prev) => ({
                ...prev,
                [mode]: event.target.value,
              }))
            }
            placeholder="搜索当前平台模型…"
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
        </div>

        <div
          style={{
            maxHeight: 228,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
            paddingRight: 2,
            borderTop:
              '1px solid var(--border-subtle, var(--border-default, hsla(215, 18%, 50%, 0.12)))',
          }}
        >
          {showingSearchResults ? (
            renderSearchResultGroups()
          ) : visibleModels.length === 0 ? (
            <div
              style={{
                padding: '0.8rem 0',
                color: 'var(--fg-muted)',
                fontSize: 12,
              }}
            >
              {mode === 'image' ? '当前没有支持图片生成的模型。' : '当前提供商没有可用模型。'}
            </div>
          ) : (
            visibleModels.map((model, index) =>
              renderModelRow(
                visibleProvider ?? { id: '', name: '', type: '' },
                {
                  ...model,
                  label: model.label,
                },
                index,
                visibleModels.length,
              ),
            )
          )}
        </div>

        {thinkingMode
          ? renderThinkingControls(
              thinkingMode,
              selectedProvider?.type,
              selectedModel,
              thinkingTitle,
              thinkingDescription,
            )
          : null}
        {mode === 'image' ? renderImageDefaultsControls() : null}
      </div>
    );
  }

  function renderImageDefaultsControls() {
    if (!imageDefaults || !onSetImageDefaults) {
      return null;
    }

    const sizePresetId = resolveImageGenerationSizePresetId(imageDefaults.size);
    const sizeValidation = validateImageGenerationSize(imageDefaults.size);
    const isCustomSize = forceCustomImageSize || sizePresetId === 'custom';

    const chipBase: CSSProperties = {
      borderRadius: 999,
      border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
      padding: '3px 10px',
      fontSize: 11,
      fontWeight: 500,
      cursor: 'pointer',
      transition: 'background 120ms, color 120ms, border-color 120ms',
    };
    const chipInactive: CSSProperties = {
      ...chipBase,
      background: 'transparent',
      color: 'var(--fg-muted)',
    };
    const chipActive: CSSProperties = {
      ...chipBase,
      background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
      color: 'var(--accent)',
      borderColor:
        'color-mix(in oklch, var(--accent) 40%, var(--border-default, hsla(215, 18%, 50%, 0.12)))',
      fontWeight: 600,
    };

    const selectFieldStyle: CSSProperties = {
      appearance: 'none',
      WebkitAppearance: 'none',
      background: 'var(--bg-overlay)',
      border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
      borderRadius: 8,
      color: 'var(--fg-default)',
      fontSize: 12,
      padding: '6px 28px 6px 10px',
      width: '100%',
      boxSizing: 'border-box' as const,
      cursor: 'pointer',
      backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394a3b8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 10px center',
    };

    const fieldInputStyle: CSSProperties = {
      background: 'var(--bg-overlay)',
      border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
      borderRadius: 8,
      color: 'var(--fg-default)',
      fontSize: 12,
      padding: '6px 10px',
      width: '100%',
      boxSizing: 'border-box' as const,
    };

    return (
      <div
        style={{
          borderTop:
            '1px solid var(--border-subtle, var(--border-default, hsla(215, 18%, 50%, 0.12)))',
          paddingTop: 12,
          display: 'grid',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.03em' }}>图片默认参数</div>

        {/* Size presets */}
        <div style={{ display: 'grid', gap: 8 }}>
          {IMAGE_GENERATION_SIZE_PRESET_GROUPS.map((group) => (
            <div
              key={group.tier}
              style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--fg-muted)',
                  fontWeight: 600,
                  minWidth: 24,
                }}
                title={group.description}
              >
                {group.label}
              </span>
              {group.presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setForceCustomImageSize(false);
                    onSetImageDefaults({ size: preset.size });
                  }}
                  title={preset.description}
                  style={
                    sizePresetId === preset.id && !forceCustomImageSize ? chipActive : chipInactive
                  }
                >
                  {preset.label}
                </button>
              ))}
              {group.tier === '2k' && (
                <span style={{ fontSize: 9, color: 'var(--fg-muted)', fontStyle: 'italic' }}>
                  ~4MP
                </span>
              )}
              {group.tier === '4k' && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color: 'var(--danger)',
                    borderRadius: 4,
                    padding: '1px 5px',
                    background: 'color-mix(in oklch, var(--danger) 10%, transparent)',
                  }}
                >
                  ~8MP · 实验性
                </span>
              )}
            </div>
          ))}

          {/* Custom size */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => {
                if (!isCustomSize) {
                  setForceCustomImageSize(true);
                }
              }}
              style={isCustomSize ? chipActive : chipInactive}
            >
              自定义
            </button>
            {isCustomSize && (
              <input
                value={imageDefaults.size}
                onChange={(event) => onSetImageDefaults({ size: event.target.value })}
                placeholder="WxH, 如 2560x1440"
                style={{ ...fieldInputStyle, width: 140, padding: '4px 10px' }}
              />
            )}
            {isCustomSize && !sizeValidation.valid && (
              <span style={{ fontSize: 10, color: 'var(--danger)' }}>{sizeValidation.message}</span>
            )}
          </div>
        </div>

        {/* Quality / Format / Background */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>质量</span>
            <select
              value={imageDefaults.quality}
              onChange={(event) =>
                onSetImageDefaults({
                  quality: event.target.value as ImageGenerationDefaultsRef['quality'],
                })
              }
              style={selectFieldStyle}
            >
              <option value="low">速度优先</option>
              <option value="medium">平衡</option>
              <option value="high">细节优先</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>格式</span>
            <select
              value={imageDefaults.outputFormat}
              onChange={(event) =>
                onSetImageDefaults({
                  outputFormat: event.target.value as ImageGenerationDefaultsRef['outputFormat'],
                })
              }
              style={selectFieldStyle}
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>背景</span>
            <select
              value={imageDefaults.background}
              onChange={(event) =>
                onSetImageDefaults({
                  background: event.target.value as ImageGenerationDefaultsRef['background'],
                })
              }
              style={selectFieldStyle}
            >
              <option value="auto">自动</option>
              <option value="opaque">不透明</option>
            </select>
          </label>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        fontFamily: 'system-ui, sans-serif',
        color: 'var(--fg-default)',
        ...style,
      }}
    >
      <section>
        <div
          style={{
            marginBottom: 12,
            paddingBottom: 10,
            borderBottom:
              '1px solid var(--border-subtle, var(--border-default, hsla(215, 18%, 50%, 0.12)))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--fg-default)',
            }}
          >
            默认模型
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
              {hasUnsavedDefaultChanges ? '有未保存更改' : '已保存'}
            </span>
            <button
              type="button"
              onClick={onSaveDefaultChanges}
              disabled={
                !onSaveDefaultChanges || !hasUnsavedDefaultChanges || isSavingDefaultChanges
              }
              style={{
                border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                borderRadius: 8,
                background:
                  hasUnsavedDefaultChanges && !isSavingDefaultChanges
                    ? 'var(--accent)'
                    : 'var(--bg-raised)',
                color:
                  hasUnsavedDefaultChanges && !isSavingDefaultChanges
                    ? color.fgOnAccent
                    : 'var(--fg-muted)',
                padding: '0.34rem 0.75rem',
                fontSize: 11,
                fontWeight: 600,
                cursor:
                  !onSaveDefaultChanges || !hasUnsavedDefaultChanges || isSavingDefaultChanges
                    ? 'not-allowed'
                    : 'pointer',
                opacity:
                  !onSaveDefaultChanges || !hasUnsavedDefaultChanges || isSavingDefaultChanges
                    ? 0.72
                    : 1,
              }}
            >
              {isSavingDefaultChanges
                ? '保存中…'
                : hasUnsavedDefaultChanges
                  ? '保存默认值'
                  : '已保存'}
            </button>
          </div>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 12,
          }}
        >
          {renderModelSelect('chat', '主对话', active.chat, onSetActiveChat)}
          {onSetActiveFast &&
            renderModelSelect('fast', 'Fast 快速模型 / 内联', active.fast, onSetActiveFast)}
        </div>
        {onSetActiveImage && active.image ? (
          <div style={{ marginTop: 12 }}>
            {renderModelSelect('image', '图片生成', active.image, onSetActiveImage)}
          </div>
        ) : null}
      </section>

      <section
        style={{
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.8rem 1rem',
            borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>提供商</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {onDiscoverProviders ? (
              <button
                type="button"
                onClick={() => {
                  void openDiscover();
                }}
                style={{
                  background: 'transparent',
                  color: 'var(--fg-default)',
                  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                  borderRadius: 6,
                  padding: '0.32rem 0.8rem',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                发现更多平台
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setAddingNew(true);
                setEditingId(null);
              }}
              style={{
                background: 'var(--accent)',
                color: color.fgOnAccent,
                border: 'none',
                borderRadius: 6,
                padding: '0.32rem 0.8rem',
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              + 添加提供商
            </button>
          </div>
        </div>

        {discoverOpen ? (
          <div
            style={{
              margin: '0.75rem 1rem',
              padding: '0.85rem 1rem',
              borderRadius: 8,
              border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
              background: 'var(--bg-raised)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
                从 models.dev 发现更多平台
              </div>
              <button
                type="button"
                onClick={() => {
                  setDiscoverOpen(false);
                  setDiscoverError(null);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--fg-muted)',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                关闭
              </button>
            </div>
            <input
              style={inputStyle}
              value={discoverQuery}
              onChange={(e) => setDiscoverQuery(e.target.value)}
              placeholder="搜索平台名称或 id…"
            />
            {discoverLoading ? (
              <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>加载中…</div>
            ) : null}
            {discoverError ? (
              <div style={{ color: 'var(--danger, #ef4444)', fontSize: 12 }}>{discoverError}</div>
            ) : null}
            {!discoverLoading
              ? (() => {
                  const q = discoverQuery.trim().toLowerCase();
                  const filtered = discoverItems.filter((item) => {
                    if (!q) return true;
                    return item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q);
                  });
                  if (filtered.length === 0) {
                    return (
                      <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                        {discoverItems.length === 0
                          ? '暂无可导入平台（可能均已内置，或 models.dev 暂无数据）。'
                          : '没有匹配的平台，请调整搜索关键词。'}
                      </div>
                    );
                  }
                  return (
                    <ul
                      style={{
                        margin: 0,
                        padding: 0,
                        listStyle: 'none',
                        maxHeight: 240,
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      {filtered.map((item) => (
                        <li
                          key={item.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                            padding: '0.45rem 0.55rem',
                            borderRadius: 6,
                            border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{item.name}</div>
                            <div
                              style={{
                                fontSize: 11,
                                color: 'var(--fg-muted)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {item.id}
                              {item.api ? ` · ${item.api}` : ''}
                              {` · ${item.modelCount} 模型`}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={!onImportDiscoveredProvider || importingId === item.id}
                            onClick={() => {
                              void importDiscovered(item.id);
                            }}
                            style={{
                              background: 'var(--accent)',
                              color: color.fgOnAccent,
                              border: 'none',
                              borderRadius: 6,
                              padding: '0.28rem 0.7rem',
                              fontSize: 11,
                              cursor:
                                !onImportDiscoveredProvider || importingId === item.id
                                  ? 'not-allowed'
                                  : 'pointer',
                              fontWeight: 500,
                              opacity:
                                !onImportDiscoveredProvider || importingId === item.id ? 0.6 : 1,
                              flexShrink: 0,
                            }}
                          >
                            {importingId === item.id ? '导入中…' : '导入'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  );
                })()
              : null}
            <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
              导入后类型为 custom，请填写 API Key 后再使用。
            </div>
          </div>
        ) : null}

        {providers.length === 0 && !addingNew ? (
          <div
            style={{
              padding: '1.25rem',
              textAlign: 'center',
              color: 'var(--fg-muted)',
              fontSize: 12,
            }}
          >
            暂无提供商配置。
          </div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {providers.map((provider, idx) => (
              <li key={provider.id}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '0.6rem 1rem',
                    borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                  }}
                >
                  <ProviderLogo type={provider.type} size={28} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 12 }}>{provider.name}</span>
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--fg-muted)',
                          background: 'var(--bg-raised)',
                          borderRadius: 4,
                          padding: '1px 6px',
                          flexShrink: 0,
                        }}
                      >
                        {provider.defaultModels.length} 个模型
                      </span>
                      {provider.enabled ? null : (
                        <span
                          style={{
                            fontSize: 10,
                            color: 'var(--fg-subtle)',
                            fontStyle: 'italic',
                          }}
                        >
                          已禁用
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 1 }}>
                      {provider.type}
                      {provider.baseUrl ? (
                        <>
                          {' · '}
                          <span style={{ fontFamily: 'monospace', fontSize: 10 }}>
                            {provider.baseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(provider.id);
                        setAddingNew(false);
                      }}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                        borderRadius: 6,
                        color: 'var(--fg-default)',
                        padding: '0.25rem 0.65rem',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      编辑
                    </button>

                    <button
                      type="button"
                      onClick={() => onToggleProvider?.(provider.id)}
                      style={{
                        background: provider.enabled
                          ? 'var(--accent)'
                          : 'var(--border-default, hsla(215, 18%, 50%, 0.12))',
                        border: 'none',
                        borderRadius: 12,
                        width: 40,
                        height: 22,
                        cursor: 'pointer',
                        position: 'relative',
                        flexShrink: 0,
                        transition: 'background 0.2s',
                      }}
                      title={provider.enabled ? '禁用提供商' : '启用提供商'}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          top: 3,
                          left: provider.enabled ? 21 : 3,
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          background: color.fgOnAccent,
                          transition: 'left 0.2s',
                        }}
                      />
                    </button>
                  </div>
                </div>

                {editingId === provider.id && (
                  <div
                    style={{
                      padding: '0.75rem 1.5rem',
                      borderBottom:
                        idx < providers.length - 1
                          ? '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))'
                          : 'none',
                    }}
                  >
                    <InlineProviderForm
                      initial={emptyForm(provider)}
                      isNew={false}
                      onSubmit={(data) => {
                        onEditProvider(provider.id, data);
                        setEditingId(null);
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                    <div style={{ marginTop: 14 }}>
                      <ModelManager
                        provider={{
                          id: provider.id,
                          name: provider.name,
                          defaultModels: provider.defaultModels,
                        }}
                        onToggleModel={onToggleModel}
                        onAddModel={onAddModel}
                        onRemoveModel={onRemoveModel}
                        onUpdateModel={onUpdateModel}
                        {...(onTestModel ? { onTestModel } : {})}
                        {...(onSyncCatalog ? { onSyncCatalog } : {})}
                      />
                    </div>
                  </div>
                )}
              </li>
            ))}

            {addingNew && (
              <li style={{ padding: '0.75rem 1.5rem' }}>
                <InlineProviderForm
                  initial={emptyForm()}
                  isNew={true}
                  onSubmit={(data) => {
                    onAddProvider(data);
                    setAddingNew(false);
                  }}
                  onCancel={() => setAddingNew(false)}
                />
              </li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
