import type React from 'react';
import type { MemoryLoadStatus, MemorySettings } from './memory-types.js';
import { IS } from '../shared/settings-section-styles.js';

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
  background: 'var(--bg-raised)',
  transition: 'left 200ms ease',
  boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
};

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
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 0',
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>{title}</div>
        <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginTop: 2 }}>{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        style={{
          ...TOGGLE_TRACK,
          background: checked ? 'var(--accent)' : 'var(--border-default)',
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

function parseSettingNumber(value: string, min: number, max: number): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function NumberSetting({
  label,
  hint,
  value,
  min,
  max,
  step,
  ariaLabel,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  ariaLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 160 }}>
      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--fg-default)' }}>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          const next = parseSettingNumber(event.target.value, min, max);
          if (next !== null) {
            onChange(next);
          }
        }}
        style={{ ...IS, width: '100%' }}
        aria-label={ariaLabel}
      />
      <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{hint}</span>
    </label>
  );
}

export function MemorySettingsPanel({
  settings,
  settingsStatus,
  updateSettings,
}: {
  settings: MemorySettings;
  settingsStatus: MemoryLoadStatus;
  updateSettings: (patch: Partial<MemorySettings>) => Promise<void>;
}) {
  if (settingsStatus === 'loading') {
    return <div style={{ fontSize: 11, color: 'var(--fg-muted)', padding: 8 }}>设置加载中…</div>;
  }

  if (settingsStatus === 'error') {
    return (
      <div style={{ fontSize: 11, color: 'var(--danger)', padding: 8 }}>
        设置加载失败，请稍后重试。
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <ToggleRow
          title="启用记忆系统"
          description="关闭后不会在 system prompt 注入记忆，也不会自动提取。"
          checked={settings.enabled}
          ariaLabel="切换记忆系统"
          onToggle={() => void updateSettings({ enabled: !settings.enabled })}
        />
        <div style={{ height: 1, background: 'var(--border-subtle)' }} />
        <ToggleRow
          title="自动提取"
          description="请求完成后只提取长期有用、可复用的候选记忆。"
          checked={settings.autoExtract}
          ariaLabel="切换自动提取"
          onToggle={() => void updateSettings({ autoExtract: !settings.autoExtract })}
        />
        <div style={{ height: 1, background: 'var(--border-subtle)' }} />
        <ToggleRow
          title="低置信候选需确认"
          description="低于自动写入阈值的候选只计入待确认，不直接入库。"
          checked={settings.reviewLowConfidence}
          ariaLabel="切换低置信候选审阅"
          onToggle={() =>
            void updateSettings({ reviewLowConfidence: !settings.reviewLowConfidence })
          }
        />
      </div>

      <div style={{ height: 1, background: 'var(--border-subtle)', margin: '12px 0' }} />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <NumberSetting
          label="最大注入预算"
          hint="100 – 10000 tokens"
          min={100}
          max={10000}
          value={settings.maxTokenBudget}
          ariaLabel="最大注入预算"
          onChange={(value) => void updateSettings({ maxTokenBudget: Math.round(value) })}
        />
        <NumberSetting
          label="注入最低置信度"
          hint="低于该值的记忆不会注入 prompt"
          min={0}
          max={1}
          step={0.05}
          value={settings.minConfidence}
          ariaLabel="注入最低置信度"
          onChange={(value) => void updateSettings({ minConfidence: value })}
        />
        <NumberSetting
          label="自动写入阈值"
          hint="低于该值的自动候选不会直接入库"
          min={0}
          max={1}
          step={0.05}
          value={settings.autoWriteMinConfidence}
          ariaLabel="自动写入阈值"
          onChange={(value) => void updateSettings({ autoWriteMinConfidence: value })}
        />
      </div>
    </div>
  );
}
