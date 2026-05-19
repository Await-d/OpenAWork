/**
 * `<WebsearchSection>` — Connection-tab card for the multi-provider
 * web search rollout policy (P2-WEBSEARCH workflow 260509). Lets the
 * user pick one or more providers, set the rollout mode and an
 * optional timeout, then PUT the result via
 * `useSettingsWebsearch`.
 *
 * The visual language deliberately mirrors `<UpstreamRetrySection>`
 * (pill toggle group + apply button) so the Connection tab keeps a
 * single style across closely-related sections.
 */

import React from 'react';
import { BP, SS, ST } from '../shared/settings-section-styles.js';
import type {
  WebsearchPolicy,
  WebsearchProvider,
  WebsearchProviderEntry,
  WebsearchRolloutMode,
} from './use-settings-websearch.js';

interface WebsearchSectionProps {
  isSaving: boolean;
  policy: WebsearchPolicy;
  savedPolicy: WebsearchPolicy;
  setPolicy: React.Dispatch<React.SetStateAction<WebsearchPolicy>>;
  onSave: () => void;
}

const PROVIDER_OPTIONS: ReadonlyArray<{ id: WebsearchProvider; label: string; needsKey: boolean }> =
  [
    { id: 'duckduckgo', label: 'DuckDuckGo', needsKey: false },
    { id: 'tavily', label: 'Tavily', needsKey: true },
    { id: 'exa', label: 'Exa', needsKey: true },
    { id: 'serper', label: 'Serper', needsKey: true },
    { id: 'searxng', label: 'SearXNG', needsKey: false },
    { id: 'bocha', label: '博查', needsKey: true },
    { id: 'zhipu', label: '智谱', needsKey: true },
    { id: 'google', label: 'Google CSE', needsKey: true },
    { id: 'bing', label: 'Bing', needsKey: true },
  ];

const ROLLOUT_MODES: ReadonlyArray<{ id: WebsearchRolloutMode; label: string; hint: string }> = [
  {
    id: 'sequential',
    label: '顺序回退',
    hint: '逐个尝试 provider，前一个失败再试下一个（默认）',
  },
  {
    id: 'first-success',
    label: '首个成功',
    hint: '并行调用全部 provider，谁先返回就用谁',
  },
  {
    id: 'merge',
    label: '合并去重',
    hint: '并行调用并按 URL 去重，按权重合并标题/摘要',
  },
];

const PILL_BUTTON: React.CSSProperties = {
  minWidth: 56,
  borderRadius: 999,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-default)',
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 150ms ease',
};

const INPUT_STYLE: React.CSSProperties = {
  flex: '1 1 160px',
  minWidth: 120,
  padding: '6px 8px',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  fontSize: 12,
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
};

function shallowEqualPolicy(a: WebsearchPolicy, b: WebsearchPolicy): boolean {
  if (a.rolloutMode !== b.rolloutMode) return false;
  if ((a.timeoutMs ?? null) !== (b.timeoutMs ?? null)) return false;
  if (a.providers.length !== b.providers.length) return false;
  for (let i = 0; i < a.providers.length; i++) {
    const pa = a.providers[i]!;
    const pb = b.providers[i]!;
    if (
      pa.provider !== pb.provider ||
      (pa.apiKey ?? '') !== (pb.apiKey ?? '') ||
      (pa.baseUrl ?? '') !== (pb.baseUrl ?? '') ||
      (pa.weight ?? null) !== (pb.weight ?? null)
    ) {
      return false;
    }
  }
  return true;
}

export function WebsearchSection({
  isSaving,
  policy,
  savedPolicy,
  setPolicy,
  onSave,
}: WebsearchSectionProps) {
  const isDirty = !shallowEqualPolicy(policy, savedPolicy);

  function updateProviderAt(index: number, patch: Partial<WebsearchProviderEntry>): void {
    setPolicy((prev) => {
      const nextProviders = prev.providers.map((entry, i) =>
        i === index ? { ...entry, ...patch } : entry,
      );
      return { ...prev, providers: nextProviders };
    });
  }

  function addProvider(provider: WebsearchProvider): void {
    setPolicy((prev) => {
      // Cap the configured list at the gateway-side schema's maximum
      // (8 entries). We deliberately do not silently drop further
      // additions — the button is just disabled instead.
      if (prev.providers.length >= 8) return prev;
      return {
        ...prev,
        providers: [...prev.providers, { provider }],
      };
    });
  }

  function removeProviderAt(index: number): void {
    setPolicy((prev) => ({
      ...prev,
      providers: prev.providers.filter((_, i) => i !== index),
    }));
  }

  function moveProviderAt(index: number, delta: number): void {
    setPolicy((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.providers.length) return prev;
      const next = [...prev.providers];
      const [picked] = next.splice(index, 1);
      next.splice(target, 0, picked!);
      return { ...prev, providers: next };
    });
  }

  return (
    <section style={SS}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 220, flex: '1 1 260px' }}>
          <h3 style={ST}>Web 搜索 Provider</h3>
          <p
            style={{
              margin: '4px 0 0',
              color: 'var(--fg-default)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            为 LLM 工具 <code>websearch</code> 配置 provider 列表。未配置时仍按默认 DuckDuckGo
            单次调用；多 provider 配合并行 rollout 模式可获得更稳的覆盖。
          </p>
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 999,
            background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
            color: 'var(--accent)',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          已保存
          <span style={{ color: 'var(--fg-strong)', fontWeight: 700 }}>
            {savedPolicy.providers.length} 个 / {savedPolicy.rolloutMode}
          </span>
        </div>
      </div>

      {/* Rollout mode picker */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-default)' }}>Rollout 模式</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {ROLLOUT_MODES.map((mode) => {
            const selected = mode.id === policy.rolloutMode;
            return (
              <button
                key={mode.id}
                type="button"
                aria-pressed={selected}
                title={mode.hint}
                onClick={() => setPolicy((prev) => ({ ...prev, rolloutMode: mode.id }))}
                style={{
                  ...PILL_BUTTON,
                  background: selected
                    ? 'color-mix(in srgb, var(--accent) 16%, var(--bg-overlay))'
                    : PILL_BUTTON.background,
                  borderColor: selected ? 'var(--accent)' : 'var(--border-default)',
                  color: selected ? 'var(--accent)' : PILL_BUTTON.color,
                }}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          {ROLLOUT_MODES.find((m) => m.id === policy.rolloutMode)?.hint ?? ''}
        </span>
      </div>

      {/* Configured provider list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-default)' }}>
          已配置 provider（{policy.providers.length} / 8）
        </div>
        {policy.providers.length === 0 && (
          <div
            style={{
              padding: '10px 12px',
              border: '1px dashed var(--border-default)',
              borderRadius: 6,
              color: 'var(--fg-muted)',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            未配置时，<code>websearch</code> 会回退到内置默认（DuckDuckGo 免 key）。
          </div>
        )}
        {policy.providers.map((entry, index) => {
          const meta = PROVIDER_OPTIONS.find((opt) => opt.id === entry.provider);
          return (
            <div
              key={`${entry.provider}-${index}`}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                flexWrap: 'wrap',
                padding: 8,
                border: '1px solid var(--border-subtle)',
                borderRadius: 6,
                background: 'var(--bg-overlay)',
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--fg-strong)',
                  minWidth: 96,
                }}
              >
                {meta?.label ?? entry.provider}
              </span>
              <input
                type="password"
                placeholder={meta?.needsKey ? 'API key（必填）' : 'API key（可选）'}
                value={entry.apiKey ?? ''}
                onChange={(e) => updateProviderAt(index, { apiKey: e.target.value })}
                style={INPUT_STYLE}
                autoComplete="off"
              />
              <input
                type="text"
                placeholder="Base URL（可选）"
                value={entry.baseUrl ?? ''}
                onChange={(e) => updateProviderAt(index, { baseUrl: e.target.value })}
                style={INPUT_STYLE}
              />
              <input
                type="number"
                placeholder="权重"
                value={entry.weight ?? ''}
                min={0}
                max={100}
                onChange={(e) =>
                  updateProviderAt(index, {
                    weight: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
                style={{ ...INPUT_STYLE, flex: '0 0 80px', minWidth: 64 }}
              />
              <div style={{ display: 'inline-flex', gap: 4 }}>
                <button
                  type="button"
                  onClick={() => moveProviderAt(index, -1)}
                  disabled={index === 0}
                  title="上移"
                  style={{
                    ...PILL_BUTTON,
                    minWidth: 32,
                    padding: '4px 8px',
                    opacity: index === 0 ? 0.4 : 1,
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveProviderAt(index, 1)}
                  disabled={index === policy.providers.length - 1}
                  title="下移"
                  style={{
                    ...PILL_BUTTON,
                    minWidth: 32,
                    padding: '4px 8px',
                    opacity: index === policy.providers.length - 1 ? 0.4 : 1,
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeProviderAt(index)}
                  title="移除"
                  style={{
                    ...PILL_BUTTON,
                    minWidth: 32,
                    padding: '4px 8px',
                    color: 'var(--danger))',
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}

        {/* Add buttons */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PROVIDER_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => addProvider(opt.id)}
              disabled={policy.providers.length >= 8}
              style={{
                ...PILL_BUTTON,
                opacity: policy.providers.length >= 8 ? 0.5 : 1,
                cursor: policy.providers.length >= 8 ? 'not-allowed' : 'pointer',
              }}
            >
              + {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Optional merge timeout */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--fg-default)' }}>
          合并模式超时 (ms)，仅 <code>merge</code> 生效；范围 1000–120000：
        </label>
        <input
          type="number"
          min={1000}
          max={120000}
          step={500}
          placeholder="不限"
          value={policy.timeoutMs ?? ''}
          onChange={(e) =>
            setPolicy((prev) => ({
              ...prev,
              timeoutMs: e.target.value === '' ? undefined : Number(e.target.value),
            }))
          }
          style={{ ...INPUT_STYLE, flex: '0 0 120px' }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: 'var(--fg-muted)', fontSize: 12, lineHeight: 1.5 }}>
          LLM 在调用 websearch 时显式指定 provider 仍会被尊重；多 provider rollout 仅在 LLM
          未指定时生效。
        </span>
        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty || isSaving}
          style={{
            ...BP,
            opacity: !isDirty || isSaving ? 0.6 : 1,
            cursor: !isDirty || isSaving ? 'not-allowed' : 'pointer',
          }}
        >
          {isSaving ? '保存中…' : isDirty ? '应用策略' : '已应用'}
        </button>
      </div>
    </section>
  );
}
