/**
 * `<WebsearchSection>` — Plugins-tab card for the multi-provider
 * web search rollout policy. Lets the user pick one or more providers,
 * set the rollout mode and an optional timeout, then PUT the result
 * via `useSettingsWebsearch`.
 *
 * The visual language deliberately mirrors `<UpstreamRetrySection>`
 * (pill toggle group + apply button) for cross-section consistency.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { BP, SS } from '../shared/settings-section-styles.js';
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

// ── 样式常量 ──────────────────────────────────────────────────

const SECTION_HEADER: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const SECTION_ICON_WRAP: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 6,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const SECTION_TITLE_TEXT: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--fg-strong)',
};

/** 子区块分组容器 —— 用于 rollout / provider 列表 / 超时等逻辑分组 */
const SUBGROUP: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

/** 子区块之间的分隔线 */
const DIVIDER: CSSProperties = {
  height: 1,
  background: 'var(--border-subtle)',
  margin: '2px 0',
  flexShrink: 0,
};

const SUBGROUP_LABEL: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--fg-default)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const PILL_BUTTON: CSSProperties = {
  minWidth: 52,
  borderRadius: 999,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-default)',
  padding: '5px 10px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 150ms ease',
};

const INPUT_STYLE: CSSProperties = {
  flex: '1 1 140px',
  minWidth: 100,
  padding: '6px 8px',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  fontSize: 11,
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  outline: 'none',
};

const PROVIDER_ROW: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: '8px 10px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  background: 'var(--bg-overlay)',
  transition: 'border-color 150ms ease',
};

const PROVIDER_NAME: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--fg-strong)',
  width: 100,
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const PROVIDER_INDEX: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  borderRadius: 4,
  background: 'var(--accent-muted)',
  color: 'var(--accent)',
  fontSize: 10,
  fontWeight: 700,
  flexShrink: 0,
};

const PROVIDER_INPUTS: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  flex: 1,
  minWidth: 0,
};

const PROVIDER_ACTIONS: CSSProperties = {
  display: 'inline-flex',
  gap: 4,
  flexShrink: 0,
};

const EMPTY_STATE: CSSProperties = {
  padding: '8px 12px',
  border: '1px dashed var(--border-emphasis)',
  borderRadius: 8,
  color: 'var(--fg-muted)',
  fontSize: 11,
  lineHeight: 1.4,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const SAVED_BADGE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  borderRadius: 999,
  background: 'var(--accent-muted)',
  color: 'var(--accent)',
  fontSize: 10,
  fontWeight: 600,
  border: '1px solid var(--accent-border)',
  flexShrink: 0,
};

const ROLLOUT_HINT: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  lineHeight: 1.4,
  display: 'flex',
  alignItems: 'flex-start',
  gap: 4,
};

const ADD_BTN_GROUP: CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
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
    <section style={{ ...SS, marginBottom: 0, padding: '12px 16px', gap: '10px' }}>
      {/* ── 标题行 ── */}
      <div style={SECTION_HEADER}>
        <span
          style={{
            ...SECTION_ICON_WRAP,
            background: 'var(--accent-muted)',
            border: '1px solid var(--accent-border)',
            color: 'var(--accent)',
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </span>
        <span style={SECTION_TITLE_TEXT}>Web 搜索 Provider</span>
        <span style={SAVED_BADGE}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <path d="M22 4L12 14.01l-3-3" />
          </svg>
          {savedPolicy.providers.length} 个 / {savedPolicy.rolloutMode}
        </span>
      </div>
      {/* 描述文字 */}
      <p
        style={{
          margin: 0,
          color: 'var(--fg-muted)',
          fontSize: 11,
          lineHeight: 1.5,
        }}
      >
        为原生 <code>websearch</code> 配置 provider 回退链路。未配置时按默认 DuckDuckGo 单次调用。
      </p>

      {/* ── 分隔线 ── */}
      <div style={DIVIDER} />

      {/* ── Rollout 模式 ── */}
      <div style={SUBGROUP}>
        <div style={SUBGROUP_LABEL}>
          <span>Rollout 模式</span>
        </div>
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
                  background: selected ? 'var(--accent-muted)' : 'var(--bg-overlay)',
                  borderColor: selected ? 'var(--accent)' : 'var(--border-default)',
                  color: selected ? 'var(--accent)' : 'var(--fg-default)',
                  boxShadow: selected ? '0 0 0 3px var(--accent-subtle)' : 'none',
                  padding: '6px 14px',
                }}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
        <span style={ROLLOUT_HINT}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, marginTop: 1, opacity: 0.7 }}
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          {ROLLOUT_MODES.find((m) => m.id === policy.rolloutMode)?.hint ?? ''}
        </span>
      </div>

      {/* ── 分隔线 ── */}
      <div style={DIVIDER} />

      {/* ── Provider 列表 ── */}
      <div style={SUBGROUP}>
        <div style={SUBGROUP_LABEL}>
          <span>已配置 provider</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: policy.providers.length >= 8 ? 'var(--contrast)' : 'var(--fg-muted)',
            }}
          >
            {policy.providers.length} / 8
          </span>
        </div>

        {policy.providers.length === 0 && (
          <div style={EMPTY_STATE}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0, opacity: 0.6 }}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <span>
              未配置时，原生 <code>websearch</code> 会回退到内置默认（DuckDuckGo 免 key）。
            </span>
          </div>
        )}

        {policy.providers.map((entry, index) => {
          const meta = PROVIDER_OPTIONS.find((opt) => opt.id === entry.provider);
          return (
            <div
              key={`${entry.provider}-${index}`}
              style={PROVIDER_ROW}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-emphasis)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
              }}
            >
              <span style={PROVIDER_NAME}>
                <span style={PROVIDER_INDEX}>{index + 1}</span>
                {meta?.label ?? entry.provider}
              </span>
              <div style={PROVIDER_INPUTS}>
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
                  style={{ ...INPUT_STYLE, flex: '0 0 64px', minWidth: 64 }}
                />
              </div>
              <div style={PROVIDER_ACTIONS}>
                <button
                  type="button"
                  onClick={() => moveProviderAt(index, -1)}
                  disabled={index === 0}
                  title="上移"
                  style={{
                    ...PILL_BUTTON,
                    minWidth: 28,
                    padding: '4px 7px',
                    opacity: index === 0 ? 0.4 : 1,
                    cursor: index === 0 ? 'not-allowed' : 'pointer',
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
                    minWidth: 28,
                    padding: '4px 7px',
                    opacity: index === policy.providers.length - 1 ? 0.4 : 1,
                    cursor: index === policy.providers.length - 1 ? 'not-allowed' : 'pointer',
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
                    minWidth: 28,
                    padding: '4px 7px',
                    color: 'var(--complement)',
                    borderColor: 'var(--border-default)',
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}

        {/* 添加 provider 按钮 */}
        <div style={ADD_BTN_GROUP}>
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
                padding: '5px 10px',
              }}
            >
              + {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 分隔线 ── */}
      <div style={DIVIDER} />

      {/* ── 合并超时 + 底部操作栏 ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <label
          style={{
            fontSize: 11,
            color: 'var(--fg-default)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
          }}
        >
          <code>merge</code> 超时
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
            style={{ ...INPUT_STYLE, flex: '0 0 80px', minWidth: 80, width: 80 }}
          />
          <span style={{ color: 'var(--fg-muted)', fontSize: 10 }}>ms</span>
        </label>

        <span style={{ flex: 1, color: 'var(--fg-subtle)', fontSize: 10, lineHeight: 1.4 }}>
          LLM 显式指定 provider 时始终优先
        </span>

        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty || isSaving}
          style={{
            ...BP,
            padding: '6px 16px',
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
