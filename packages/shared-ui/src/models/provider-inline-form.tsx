import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

import { color } from '../tokens.js';
import type { ProviderEditData } from './ProviderSettings.js';
import { getProviderUiList, lookupProviderEntry } from './provider-catalog-ui.js';
import type { ProviderUpstreamVariantUi } from './provider-catalog-ui.js';

export const labelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-muted)',
  marginBottom: 4,
};

export const inputStyle: CSSProperties = {
  background: 'var(--bg-raised)',
  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
  borderRadius: 6,
  color: 'var(--fg-default)',
  fontSize: 12,
  padding: '0.35rem 0.6rem',
  width: '100%',
  boxSizing: 'border-box',
};

interface InlineFormProps {
  initial: ProviderEditData;
  isNew: boolean;
  onSubmit: (data: ProviderEditData) => void;
  onCancel: () => void;
}

export function InlineProviderForm({ initial, isNew, onSubmit, onCancel }: InlineFormProps) {
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
      ...(form.type === 'openai' && form.openaiFastMode === true ? { openaiFastMode: true } : {}),
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
                    background: active ? 'var(--bg-raised)' : 'var(--bg-overlay)',
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
      {form.type === 'openai' ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <input
            id="provider-form-openai-fast-mode"
            type="checkbox"
            checked={form.openaiFastMode === true}
            onChange={(e) => set('openaiFastMode', e.target.checked)}
            style={{ cursor: 'pointer', marginTop: 4 }}
          />
          <label
            htmlFor="provider-form-openai-fast-mode"
            style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }}
          >
            OpenAI Fast 模式（service_tier=priority）
          </label>
        </div>
      ) : null}
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
