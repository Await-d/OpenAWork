import { useState } from 'react';
import type { CSSProperties } from 'react';

export interface ModelPriceEntry {
  id: string;
  displayName: string;
  provider: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

export interface ModelPriceConfigProps {
  models: ModelPriceEntry[];
  onUpdate?: (modelId: string, inputPrice: number, outputPrice: number) => void;
  style?: CSSProperties;
}

function PriceCell({ value, onSave }: { value: number | undefined; onSave: (v: number) => void }) {
  const safeValue = value ?? 0;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(safeValue));
  if (editing) {
    return (
      <input
        type="number"
        value={draft}
        ref={(el) => el?.focus()}
        min={0}
        step={0.01}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = parseFloat(draft);
          if (!isNaN(n)) onSave(n);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const n = parseFloat(draft);
            if (!isNaN(n)) onSave(n);
            setEditing(false);
          } else if (e.key === 'Escape') {
            setDraft(String(safeValue));
            setEditing(false);
          }
        }}
        style={{
          width: 80,
          background: 'var(--color-bg, #0f172a)',
          border: '1px solid #6366f1',
          borderRadius: 4,
          color: 'var(--color-text, #f1f5f9)',
          fontSize: 12,
          padding: '2px 6px',
        }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(String(safeValue));
        setEditing(true);
      }}
      style={{
        background: 'none',
        border: '1px solid transparent',
        borderRadius: 4,
        color: 'var(--color-text, #f1f5f9)',
        fontSize: 12,
        padding: '2px 6px',
        cursor: 'pointer',
        textAlign: 'right',
      }}
    >
      ${safeValue.toFixed(2)}
    </button>
  );
}

export function ModelPriceConfig({ models, onUpdate, style }: ModelPriceConfigProps) {
  const [local, setLocal] = useState<Record<string, { in: number; out: number }>>(() => {
    const m: Record<string, { in: number; out: number }> = {};
    for (const mod of models)
      m[mod.id] = { in: mod.inputPricePerMillion, out: mod.outputPricePerMillion };
    return m;
  });

  const save = (id: string, field: 'in' | 'out', val: number) => {
    setLocal((prev) => {
      const next = { ...prev, [id]: { ...(prev[id] ?? { in: 0, out: 0 }), [field]: val } };
      const row = next[id];
      if (row) onUpdate?.(id, row.in, row.out);
      return next;
    });
  };

  return (
    <div
      style={{
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 10,
        overflow: 'hidden',
        ...style,
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border, #334155)' }}>
            {['模型', '提供商', '输入 $/M', '输出 $/M'].map((h) => (
              <th
                key={h}
                style={{
                  padding: '0.5rem 0.75rem',
                  textAlign: 'left',
                  fontWeight: 700,
                  fontSize: 11,
                  color: 'var(--color-muted, #94a3b8)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {models.map((m, i) => {
            const row = local[m.id] ?? { in: m.inputPricePerMillion, out: m.outputPricePerMillion };
            return (
              <tr
                key={m.id || i}
                style={{
                  borderBottom:
                    i < models.length - 1 ? '1px solid var(--color-border, #334155)' : 'none',
                }}
              >
                <td
                  style={{
                    padding: '0.4rem 0.75rem',
                    color: 'var(--color-text, #f1f5f9)',
                    fontWeight: 500,
                  }}
                >
                  {m.displayName}
                </td>
                <td style={{ padding: '0.4rem 0.75rem', color: 'var(--color-muted, #94a3b8)' }}>
                  {m.provider}
                </td>
                <td style={{ padding: '0.4rem 0.75rem' }}>
                  <PriceCell value={row.in} onSave={(v) => save(m.id, 'in', v)} />
                </td>
                <td style={{ padding: '0.4rem 0.75rem' }}>
                  <PriceCell value={row.out} onSave={(v) => save(m.id, 'out', v)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
