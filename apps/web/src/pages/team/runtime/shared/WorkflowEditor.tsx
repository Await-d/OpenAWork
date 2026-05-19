/**
 * 260516-team-phase-e · T-06 / T-07 / T-08
 *
 * 模板编辑器 + Workflow 包选择器 + Adapter 配置面板。
 * Phase E MVP：JSON 编辑器 + 预览 + 选择器下拉。
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useAuthStore } from '../../../../stores/auth.js';

const PANEL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 16,
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 86%, var(--bg))',
};

const BUTTON_PRIMARY: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 30,
  padding: '0 14px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 16%, var(--surface))',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 700,
};

interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  source: string;
  tags: string[];
  steps: Array<{ id: string; roleLayer: string; label: string }>;
}

// ─── T-07: Workflow 包选择器 ────────────────────────────────────────────────

export interface WorkflowSelectorProps {
  onSelect: (workflowId: string) => void;
  selectedId: string | null;
}

export function WorkflowSelector({ onSelect, selectedId }: WorkflowSelectorProps) {
  const { accessToken, gatewayUrl } = useAuthStore();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const loadWorkflows = useCallback(async () => {
    if (!accessToken || !gatewayUrl) return;
    setLoading(true);
    try {
      const { createTeamPhaseAClient } = await import('@openAwork/web-client');
      // 使用通用 fetch 通过 web-client 的 authHeader
      const { authHeader } = await import('@openAwork/web-client');
      const res = await fetch(`${gatewayUrl}/team/workflows`, {
        headers: authHeader(accessToken),
      });
      if (res.ok) {
        const data = (await res.json()) as { workflows: WorkflowSummary[] };
        setWorkflows(data.workflows);
      }
    } catch (_err) {
      console.warn(
        '[WorkflowSelector] 加载失败:',
        _err instanceof Error ? _err.message : String(_err),
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, gatewayUrl]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  return (
    <div style={PANEL_STYLE}>
      <header style={{ display: 'grid', gap: 4 }}>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Workflow 选择
        </span>
        <strong style={{ fontSize: 14 }}>选择工作流模板</strong>
      </header>

      {loading ? (
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>加载中…</span>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {workflows.map((wf) => {
            const isSelected = wf.id === selectedId;
            return (
              <button
                key={wf.id}
                type="button"
                onClick={() => onSelect(wf.id)}
                style={{
                  display: 'grid',
                  gap: 4,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: isSelected
                    ? '1px solid color-mix(in srgb, var(--accent) 50%, transparent)'
                    : '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
                  background: isSelected
                    ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))'
                    : 'color-mix(in srgb, var(--bg-2) 80%, var(--bg))',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <strong style={{ fontSize: 13 }}>{wf.name}</strong>
                  <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{wf.source}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{wf.description}</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {wf.steps.map((s) => (
                    <span
                      key={s.id}
                      style={{
                        fontSize: 10,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
                        border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
                      }}
                    >
                      {s.label}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── T-06: 模板编辑器 ──────────────────────────────────────────────────────

export interface WorkflowEditorProps {
  workflowId: string | null;
}

export function WorkflowEditor({ workflowId }: WorkflowEditorProps) {
  const { accessToken, gatewayUrl } = useAuthStore();
  const [json, setJson] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!workflowId || !accessToken || !gatewayUrl) return;
    void (async () => {
      try {
        const { authHeader } = await import('@openAwork/web-client');
        const res = await fetch(`${gatewayUrl}/team/workflows`, {
          headers: authHeader(accessToken),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            workflows: Array<{ id: string } & Record<string, unknown>>;
          };
          const found = data.workflows.find((w) => w.id === workflowId);
          if (found) setJson(JSON.stringify(found, null, 2));
        }
      } catch (_err) {
        console.warn(
          '[WorkflowEditor] 加载失败:',
          _err instanceof Error ? _err.message : String(_err),
        );
      }
    })();
  }, [workflowId, accessToken, gatewayUrl]);

  const handleSave = async () => {
    if (!accessToken || !gatewayUrl) return;
    setError(null);
    setSaved(false);
    try {
      const workflow = JSON.parse(json) as unknown;
      const { jsonAuthHeaders } = await import('@openAwork/web-client');
      const res = await fetch(`${gatewayUrl}/team/workflows`, {
        method: 'POST',
        headers: jsonAuthHeaders(accessToken),
        body: JSON.stringify({ workflow }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string; issues?: unknown };
        setError(data.error ?? '保存失败');
        return;
      }
      setSaved(true);
    } catch (_err) {
      setError(_err instanceof Error ? _err.message : '保存失败');
    }
  };

  return (
    <div style={PANEL_STYLE}>
      <header style={{ display: 'grid', gap: 4 }}>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Workflow 编辑器
        </span>
        <strong style={{ fontSize: 14 }}>
          {workflowId ? `编辑：${workflowId}` : '新建 Workflow'}
        </strong>
      </header>

      <textarea
        aria-label="Workflow JSON 编辑器"
        value={json}
        onChange={(e) => setJson(e.target.value)}
        style={{
          width: '100%',
          minHeight: 300,
          padding: 10,
          borderRadius: 8,
          border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
          background: 'color-mix(in srgb, var(--bg-2) 80%, var(--bg))',
          fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
          fontSize: 11,
          lineHeight: 1.5,
          color: 'var(--text)',
          resize: 'vertical',
        }}
        spellCheck={false}
      />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" style={BUTTON_PRIMARY} onClick={() => void handleSave()}>
          保存
        </button>
        {saved ? (
          <span style={{ fontSize: 12, color: 'var(--success, var(--success, var(--success, #3dd49a)))' }}>已保存</span>
        ) : null}
        {error ? (
          <span style={{ fontSize: 12, color: 'var(--danger, #d4574e)' }}>{error}</span>
        ) : null}
      </div>
    </div>
  );
}

// ─── T-08: Adapter 配置面板 ─────────────────────────────────────────────────

const ROLE_LAYERS = ['reception', 'pm1', 'pm2', 'executor', 'reviewer'] as const;

export function AdapterConfigPanel() {
  return (
    <div style={PANEL_STYLE}>
      <header style={{ display: 'grid', gap: 4 }}>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Role Adapter 配置
        </span>
        <strong style={{ fontSize: 14 }}>角色适配器</strong>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          每个角色层的 adapter 决定使用哪个 agent 实现、哪个 LLM provider、以及额外的 prompt 注入。
        </span>
      </header>

      <div style={{ display: 'grid', gap: 8 }}>
        {ROLE_LAYERS.map((layer) => (
          <div
            key={layer}
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
              background: 'color-mix(in srgb, var(--bg-2) 80%, var(--bg))',
            }}
          >
            <strong style={{ fontSize: 12, minWidth: 80 }}>{layer}</strong>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
              内置 adapter（Phase E MVP 不支持自定义，后续版本开放）
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
