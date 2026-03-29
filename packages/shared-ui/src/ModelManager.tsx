import type { CSSProperties, ChangeEvent } from 'react';
import { useState } from 'react';

export interface AIModelConfigItem {
  id: string;
  label: string;
  enabled: boolean;
  contextWindow?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

export interface AIProviderItem {
  id: string;
  name: string;
  defaultModels: AIModelConfigItem[];
}

export interface ModelManagerProps {
  provider: AIProviderItem;
  onToggleModel: (providerId: string, modelId: string) => void;
  onAddModel: (providerId: string, model: AIModelConfigItem) => void;
  onRemoveModel: (providerId: string, modelId: string) => void;
  style?: CSSProperties;
}

const cellStyle: CSSProperties = {
  padding: '0.6rem 0.75rem',
  fontSize: 12,
  color: 'var(--color-text, #e2e8f0)',
  verticalAlign: 'middle',
};

const mutedStyle: CSSProperties = {
  ...cellStyle,
  color: 'var(--color-muted, #94a3b8)',
};

function formatContext(tokens: number | undefined): string {
  if (!tokens) return '—';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

function formatPrice(price: number | undefined): string {
  if (price === undefined) return '—';
  return `$${price.toFixed(2)}`;
}

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={enabled ? '禁用模型' : '启用模型'}
      style={{
        background: enabled ? 'var(--color-accent, #6366f1)' : '#334155',
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
          background: '#fff',
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
  style,
}: ModelManagerProps) {
  const [newLabel, setNewLabel] = useState('');
  const [newId, setNewId] = useState('');

  function handleAddModel() {
    const trimmedId = newId.trim();
    const trimmedLabel = newLabel.trim();
    if (!trimmedId || !trimmedLabel) return;
    onAddModel(provider.id, {
      id: trimmedId,
      label: trimmedLabel,
      enabled: true,
    });
    setNewId('');
    setNewLabel('');
  }

  const inputBase: CSSProperties = {
    background: 'var(--color-surface, #1e293b)',
    border: '1px solid var(--color-border, #334155)',
    borderRadius: 6,
    color: 'var(--color-text, #e2e8f0)',
    fontSize: 12,
    padding: '0.35rem 0.6rem',
    outline: 'none',
  };

  return (
    <div
      style={{
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 12,
        overflow: 'hidden',
        fontFamily: 'system-ui, sans-serif',
        ...style,
      }}
    >
      <div
        style={{
          padding: '1rem 1.5rem',
          borderBottom: '1px solid var(--color-border, #334155)',
        }}
      >
        <h2
          style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}
        >
          {provider.name} — 模型
        </h2>
      </div>

      {provider.defaultModels.length === 0 ? (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--color-muted, #94a3b8)',
            fontSize: 12,
          }}
        >
          暂无模型配置。
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border, #334155)' }}>
              {['模型', '上下文', '输入 $/M', '输出 $/M', '已启用', ''].map((h) => (
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
            {provider.defaultModels.map((model, idx) => (
              <tr
                key={model.id}
                style={{
                  borderBottom:
                    idx < provider.defaultModels.length - 1
                      ? '1px solid var(--color-border, #334155)'
                      : 'none',
                  opacity: model.enabled ? 1 : 0.5,
                }}
              >
                <td style={cellStyle}>
                  <div style={{ fontWeight: 500 }}>{model.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-muted, #94a3b8)', marginTop: 1 }}>
                    {model.id}
                  </div>
                </td>
                <td style={mutedStyle}>{formatContext(model.contextWindow)}</td>
                <td style={mutedStyle}>{formatPrice(model.inputPricePerMillion)}</td>
                <td style={mutedStyle}>{formatPrice(model.outputPricePerMillion)}</td>
                <td style={cellStyle}>
                  <Toggle
                    enabled={model.enabled}
                    onToggle={() => onToggleModel(provider.id, model.id)}
                  />
                </td>
                <td style={cellStyle}>
                  <button
                    type="button"
                    onClick={() => onRemoveModel(provider.id, model.id)}
                    style={{
                      background: 'transparent',
                      border: '1px solid #475569',
                      borderRadius: 6,
                      color: '#f87171',
                      padding: '0.2rem 0.5rem',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    移除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--color-border, #334155)',
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
          disabled={!newId.trim() || !newLabel.trim()}
          style={{
            background:
              newId.trim() && newLabel.trim() ? 'var(--color-accent, #6366f1)' : '#334155',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '0.35rem 0.9rem',
            fontSize: 12,
            cursor: newId.trim() && newLabel.trim() ? 'pointer' : 'not-allowed',
            fontWeight: 500,
          }}
        >
          + 添加自定义模型
        </button>
      </div>
    </div>
  );
}
