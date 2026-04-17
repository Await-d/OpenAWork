import { useMemo, useState } from 'react';
import type { CSSProperties, SyntheticEvent } from 'react';
import {
  canConfigureThinkingForModel,
  describeReasoningEffort,
  getSupportedReasoningEffortsForModel,
} from './model-reasoning-support.js';
import { ModelManager } from './ModelManager.js';
import type { SupportedReasoningEffort } from './model-reasoning-support.js';
import { buildFilteredModelGroups } from './model-picker-search.js';

const PROVIDER_LOGO_URL: Record<string, string> = {
  anthropic: '/logo-anthropic.svg',
  claude: '/logo-claude.svg',
  openai: '/logo-openai.svg',
  gemini: '/logo-gemini.svg',
  googlegemini: '/logo-gemini.svg',
  ollama: '/logo-ollama.svg',
  openrouter: '/logo-openrouter.svg',
  deepseek: '/logo-deepseek.svg',
  moonshot: '/logo-moonshot.svg',
  qwen: '/logo-qwen.svg',
  mistralai: '/logo-mistralai.svg',
  mistral: '/logo-mistralai.svg',
};

function ProviderLogo({ type, size = 28 }: { type: string; size?: number }) {
  const key = type.toLowerCase();
  const url = PROVIDER_LOGO_URL[key];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
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
          alt={key}
          width={Math.round(size * 0.72)}
          height={Math.round(size * 0.72)}
          style={{ objectFit: 'contain', filter: 'var(--provider-logo-filter, none)' }}
          onError={(e: SyntheticEvent<HTMLImageElement>) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <span
          style={{
            fontSize: Math.round(size * 0.45),
            fontWeight: 700,
            color: 'var(--color-muted, #94a3b8)',
            textTransform: 'uppercase',
          }}
        >
          {key.slice(0, 2)}
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
  upstreamProtocol?: 'chat_completions' | 'responses';
  defaultModels: AIModelConfigRef[];
}

export interface ActiveSelectionRef {
  chat: { providerId: string; modelId: string };
  fast: { providerId: string; modelId: string };
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
  upstreamProtocol?: 'chat_completions' | 'responses';
}

export interface ProviderSettingsProps {
  providers: AIProviderRef[];
  active: ActiveSelectionRef;
  defaultThinking?: ThinkingDefaultsRef;
  hasUnsavedDefaultChanges?: boolean;
  isSavingDefaultChanges?: boolean;
  onSetActiveChat: (providerId: string, modelId: string) => void;
  onSetActiveFast?: (providerId: string, modelId: string) => void;
  onSaveDefaultChanges?: () => void;
  onSetThinkingMode?: (mode: keyof ThinkingDefaultsRef, value: ThinkingModeRef) => void;
  onToggleProvider?: (id: string) => void;
  onEditProvider: (id: string, data: ProviderEditData) => void;
  onAddProvider: (data: ProviderEditData) => void;
  onToggleModel?: (providerId: string, modelId: string) => void;
  onAddModel?: (providerId: string, model: AIModelConfigRef) => void;
  onRemoveModel?: (providerId: string, modelId: string) => void;
  onUpdateModel?: (providerId: string, modelId: string, updates: Partial<AIModelConfigRef>) => void;
  style?: CSSProperties;
}

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--color-muted, #94a3b8)',
  marginBottom: 4,
};

const inputStyle: CSSProperties = {
  background: 'var(--color-surface-raised, #0f172a)',
  border: '1px solid var(--color-border, #334155)',
  borderRadius: 6,
  color: 'var(--color-text, #e2e8f0)',
  fontSize: 12,
  padding: '0.35rem 0.6rem',
  width: '100%',
  boxSizing: 'border-box',
};

function maskApiKey(key: string | undefined): string {
  if (!key) return '—';
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••••••' + key.slice(-4);
}

function emptyForm(provider?: AIProviderRef): ProviderEditData {
  return {
    name: provider?.name ?? '',
    type: provider?.type ?? '',
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
      ? { bg: 'rgba(59, 130, 246, 0.10)', color: 'var(--color-text, #e2e8f0)' }
      : tone === 'violet'
        ? { bg: 'rgba(139, 92, 246, 0.12)', color: 'var(--color-text, #e2e8f0)' }
        : tone === 'emerald'
          ? { bg: 'rgba(16, 185, 129, 0.12)', color: 'var(--color-text, #e2e8f0)' }
          : { bg: 'var(--color-surface-raised, #0f172a)', color: 'var(--color-muted, #94a3b8)' };

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
        border: '1px solid var(--color-border, #334155)',
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

  function set(field: keyof ProviderEditData, value: string | boolean | undefined) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const formWrap: CSSProperties = {
    background: 'var(--color-surface-raised, #0f172a)',
    border: '1px solid var(--color-accent, #6366f1)',
    borderRadius: 8,
    padding: '1rem 1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  };

  const row: CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap' };
  const col: CSSProperties = { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 160 };

  return (
    <div style={formWrap}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--color-accent, #6366f1)',
          marginBottom: 4,
        }}
      >
        {isNew ? '新增提供商' : '编辑提供商'}
      </div>
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
            placeholder="Provider name"
          />
        </div>
        <div style={col}>
          <label htmlFor="pf-type" style={labelStyle}>
            类型
          </label>
          <input
            id="pf-type"
            style={{ ...inputStyle, opacity: isNew ? 1 : 0.6 }}
            value={form.type}
            onChange={(e) => set('type', e.target.value)}
            placeholder="openai / anthropic …"
            disabled={!isNew}
          />
        </div>
      </div>
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
            Base URL
          </label>
          <input
            id="pf-baseurl"
            style={inputStyle}
            value={form.baseUrl}
            onChange={(e) => set('baseUrl', e.target.value)}
            placeholder="https://api.example.com/v1"
          />
        </div>
        <div style={col}>
          <label htmlFor="pf-protocol" style={labelStyle}>
            Upstream Protocol
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
            <option value="">Auto-detect</option>
            <option value="chat_completions">Chat Completions (/v1/chat/completions)</option>
            <option value="responses">Responses (/v1/responses)</option>
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
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: '1px solid var(--color-border, #334155)',
            borderRadius: 6,
            color: 'var(--color-text, #e2e8f0)',
            padding: '0.3rem 0.8rem',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => onSubmit(form)}
          style={{
            background: 'var(--color-accent, #6366f1)',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
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
  hasUnsavedDefaultChanges,
  isSavingDefaultChanges,
  onSetActiveChat,
  onSetActiveFast,
  onSaveDefaultChanges,
  onSetThinkingMode,
  onToggleProvider,
  onEditProvider,
  onAddProvider,
  onToggleModel,
  onAddModel,
  onRemoveModel,
  onUpdateModel,
  style,
}: ProviderSettingsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [modelSearch, setModelSearch] = useState<{ chat: string; fast: string }>({
    chat: '',
    fast: '',
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

  function findSelectedModel(selected: { providerId: string; modelId: string }) {
    const provider = enabledProviders.find((item) => item.id === selected.providerId);
    const model = provider?.defaultModels.find((item) => item.id === selected.modelId);
    return { provider, model };
  }

  function renderThinkingControls(
    mode: keyof ThinkingDefaultsRef,
    selectedProviderType: string | undefined,
    selectedModel?: AIModelConfigRef,
  ) {
    if (!defaultThinking || !onSetThinkingMode) {
      return null;
    }

    const current = defaultThinking[mode];
    const supportsThinking = selectedModel?.supportsThinking === true;
    const canConfigureThinking = canConfigureThinkingForModel(
      selectedProviderType,
      selectedModel?.id,
    );
    const controlEnabled = supportsThinking && canConfigureThinking;
    const supportedEfforts = getSupportedReasoningEffortsForModel(
      selectedProviderType,
      selectedModel?.id,
    );

    return (
      <div
        style={{
          borderTop: '1px solid var(--color-border-subtle, var(--color-border, #334155))',
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
            <div style={{ fontSize: 11, fontWeight: 600 }}>默认思考</div>
            <div style={{ fontSize: 11, color: 'var(--color-muted, #94a3b8)', marginTop: 2 }}>
              新会话会继承这里的默认值；若模型本身固定带思考，请求时会自动安全降级。
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
          <div style={{ fontSize: 11, color: 'var(--color-muted, #94a3b8)', lineHeight: 1.45 }}>
            当前模型不支持思考配置，这里的默认值不会被实际请求使用。
          </div>
        ) : null}
        {supportsThinking && !canConfigureThinking ? (
          <div style={{ fontSize: 11, color: 'var(--color-muted, #94a3b8)', lineHeight: 1.45 }}>
            这个模型的思考能力由模型本身决定，当前网关不会单独下发开关或力度参数。
          </div>
        ) : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            disabled={!controlEnabled}
            onClick={() => onSetThinkingMode(mode, { enabled: false, effort: current.effort })}
            style={{
              border: '1px solid var(--color-border, #334155)',
              borderRadius: 999,
              padding: '0.35rem 0.7rem',
              fontSize: 11,
              fontWeight: 600,
              cursor: controlEnabled ? 'pointer' : 'not-allowed',
              opacity: controlEnabled ? 1 : 0.45,
              color: !current.enabled
                ? 'var(--color-accent, #6366f1)'
                : 'var(--color-text, #e2e8f0)',
              background: !current.enabled
                ? 'var(--color-accent-muted, rgba(99, 102, 241, 0.12))'
                : 'var(--color-surface-raised, #0f172a)',
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
                  border: '1px solid var(--color-border, #334155)',
                  borderRadius: 999,
                  padding: '0.35rem 0.7rem',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: controlEnabled ? 'pointer' : 'not-allowed',
                  opacity: controlEnabled ? 1 : 0.45,
                  color: activeLevel
                    ? 'var(--color-accent, #6366f1)'
                    : 'var(--color-text, #e2e8f0)',
                  background: activeLevel
                    ? 'var(--color-accent-muted, rgba(99, 102, 241, 0.12))'
                    : 'var(--color-surface-raised, #0f172a)',
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
    mode: 'chat' | 'fast',
    label: string,
    selected: { providerId: string; modelId: string },
    onChange: (providerId: string, modelId: string) => void,
  ) {
    const search = modelSearch[mode].trim();
    const { provider: selectedProvider, model: selectedModel } = findSelectedModel(selected);
    const visibleProvider = selectedProvider ?? enabledProviders[0];
    const showingSearchResults = search.length > 0;
    const searchGroups = showingSearchResults
      ? buildFilteredModelGroups(visibleProvider ? [visibleProvider] : [], search)
      : [];
    const visibleModels = showingSearchResults ? [] : (visibleProvider?.defaultModels ?? []);
    const contextLabel = formatContextWindow(selectedModel?.contextWindow);

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
        'id' | 'contextWindow' | 'supportsTools' | 'supportsVision' | 'supportsThinking'
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
                ? '1px solid var(--color-border-subtle, var(--color-border, #334155))'
                : 'none',
            padding: '0.58rem 0.15rem',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            textAlign: 'left',
            cursor: 'pointer',
            background: isActive
              ? 'var(--color-accent-muted, rgba(99, 102, 241, 0.12))'
              : 'transparent',
            color: 'var(--color-text, #e2e8f0)',
          }}
        >
          <span
            style={{
              width: 16,
              display: 'flex',
              justifyContent: 'center',
              color: isActive ? 'var(--color-accent, #6366f1)' : 'var(--color-muted, #94a3b8)',
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
                color: 'var(--color-muted, #94a3b8)',
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
              color: 'var(--color-muted, #94a3b8)',
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
              borderTop: '1px solid var(--color-border-subtle, var(--color-border, #334155))',
            }}
          >
            <div
              style={{
                width: 15,
                height: 15,
                borderRadius: 4,
                background: 'var(--color-surface, #1e293b)',
                border: '1px solid var(--color-border-subtle, var(--color-border, #334155))',
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
                  (event.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: 'var(--color-muted, #94a3b8)',
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
                color: 'var(--color-text, #e2e8f0)',
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
            {selectedModel?.supportsTools && <CapabilityPill label="工具" tone="accent" />}
            {selectedModel?.supportsThinking && <CapabilityPill label="思考" tone="violet" />}
            {contextLabel && <CapabilityPill label={contextLabel} />}
          </div>
        </div>

        {enabledProviders.length > 1 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {enabledProviders.map((provider) => {
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
                    border: '1px solid var(--color-border, #334155)',
                    borderRadius: 999,
                    background: isActiveProvider
                      ? 'var(--color-accent-muted, rgba(99, 102, 241, 0.12))'
                      : 'transparent',
                    color: isActiveProvider
                      ? 'var(--color-accent, #6366f1)'
                      : 'var(--color-text-secondary, var(--color-muted, #94a3b8))',
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
            border: '1px solid var(--color-border-subtle, var(--color-border, #334155))',
            background: 'var(--color-surface-raised, var(--color-surface, #1e293b))',
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
            style={{ color: 'var(--color-muted, #94a3b8)', flexShrink: 0 }}
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
              color: 'var(--color-text, #e2e8f0)',
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
            borderTop: '1px solid var(--color-border-subtle, var(--color-border, #334155))',
          }}
        >
          {showingSearchResults ? (
            renderSearchResultGroups()
          ) : visibleModels.length === 0 ? (
            <div
              style={{
                padding: '0.8rem 0',
                color: 'var(--color-muted, #94a3b8)',
                fontSize: 12,
              }}
            >
              当前提供商没有可用模型。
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

        {renderThinkingControls(mode, selectedProvider?.type, selectedModel)}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        fontFamily: 'system-ui, sans-serif',
        color: 'var(--color-text, #e2e8f0)',
        ...style,
      }}
    >
      <section>
        <div
          style={{
            marginBottom: 10,
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
              color: 'var(--color-text, #e2e8f0)',
            }}
          >
            默认模型
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--color-muted, #94a3b8)' }}>
              {hasUnsavedDefaultChanges ? '有未保存更改' : '已保存'}
            </span>
            <button
              type="button"
              onClick={onSaveDefaultChanges}
              disabled={
                !onSaveDefaultChanges || !hasUnsavedDefaultChanges || isSavingDefaultChanges
              }
              style={{
                border: '1px solid var(--color-border, #334155)',
                borderRadius: 8,
                background:
                  hasUnsavedDefaultChanges && !isSavingDefaultChanges
                    ? 'var(--color-accent, #6366f1)'
                    : 'var(--color-surface-raised, #0f172a)',
                color:
                  hasUnsavedDefaultChanges && !isSavingDefaultChanges
                    ? '#fff'
                    : 'var(--color-muted, #94a3b8)',
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
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 16,
          }}
        >
          {renderModelSelect('chat', '主对话', active.chat, onSetActiveChat)}
          {onSetActiveFast &&
            renderModelSelect('fast', '快速 / 内联', active.fast, onSetActiveFast)}
        </div>
      </section>

      <section
        style={{
          background: 'var(--color-surface, #1e293b)',
          border: '1px solid var(--color-border, #334155)',
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
            borderBottom: '1px solid var(--color-border, #334155)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>提供商</h2>
          <button
            type="button"
            onClick={() => {
              setAddingNew(true);
              setEditingId(null);
            }}
            style={{
              background: 'var(--color-accent, #6366f1)',
              color: '#fff',
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

        {providers.length === 0 && !addingNew ? (
          <div
            style={{
              padding: '1.25rem',
              textAlign: 'center',
              color: 'var(--color-muted, #94a3b8)',
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
                    gap: 12,
                    padding: '0.7rem 1rem',
                    borderBottom: '1px solid var(--color-border, #334155)',
                  }}
                >
                  <ProviderLogo type={provider.type} size={28} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>{provider.name}</div>
                    <div
                      style={{ fontSize: 12, color: 'var(--color-muted, #94a3b8)', marginTop: 2 }}
                    >
                      {provider.type} &nbsp;·&nbsp; {provider.defaultModels.length} 个模型
                    </div>
                  </div>

                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: 'var(--color-muted, #94a3b8)',
                      minWidth: 120,
                    }}
                  >
                    {maskApiKey(provider.apiKey)}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(provider.id);
                      setAddingNew(false);
                    }}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-border, #334155)',
                      borderRadius: 6,
                      color: 'var(--color-text, #e2e8f0)',
                      padding: '0.25rem 0.65rem',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    编辑
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleProvider?.(provider.id)}
                    style={{
                      background: provider.enabled ? 'var(--color-accent, #6366f1)' : '#334155',
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
                        background: '#fff',
                        transition: 'left 0.2s',
                      }}
                    />
                  </button>
                </div>

                {editingId === provider.id && (
                  <div
                    style={{
                      padding: '0.75rem 1.5rem',
                      borderBottom:
                        idx < providers.length - 1
                          ? '1px solid var(--color-border, #334155)'
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
