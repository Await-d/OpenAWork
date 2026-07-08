import { useState } from 'react';
import { type SoulRoleLayer } from '@openAwork/web-client';
import { useInstructionStackPreviewRead } from './use-team-phase-a-settings-read-model.js';
import {
  ERROR_STYLE,
  PANEL_INSET_STYLE,
  PRIMARY_BUTTON_STYLE,
  ROLE_LAYER_LABEL,
  ROLE_LAYER_ORDER,
  SECONDARY_BUTTON_STYLE,
  TINY_LABEL_STYLE,
  type TeamPhaseAClient,
} from './team-runtime-settings-panel-shared.js';

interface InstructionStackPreviewSectionProps {
  client: TeamPhaseAClient;
  teamWorkspaceId: string | null;
  token: string;
}

export function InstructionStackPreviewSection({
  token,
  client,
  teamWorkspaceId,
}: InstructionStackPreviewSectionProps) {
  const [previewLayer, setPreviewLayer] = useState<SoulRoleLayer>('executor');
  const { busy, error, preview, previewInstructionStack } = useInstructionStackPreviewRead({
    client,
    token,
  });

  return (
    <div style={PANEL_INSET_STYLE}>
      <strong style={{ fontSize: 13 }}>7 层指令栈预览</strong>
      <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
        用于核对当前 user_memory / SOUL / 宪法 等会注入哪些内容到 system prompt。
      </span>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={TINY_LABEL_STYLE}>角色：</span>
        {ROLE_LAYER_ORDER.map((layer) => (
          <button
            key={layer}
            type="button"
            style={{
              ...SECONDARY_BUTTON_STYLE,
              background:
                layer === previewLayer
                  ? 'color-mix(in srgb, var(--accent) 18%, var(--bg-overlay))'
                  : SECONDARY_BUTTON_STYLE.background,
            }}
            onClick={() => setPreviewLayer(layer)}
          >
            {ROLE_LAYER_LABEL[layer]}
          </button>
        ))}
        <button
          type="button"
          style={PRIMARY_BUTTON_STYLE}
          disabled={busy}
          onClick={() =>
            previewInstructionStack({
              teamWorkspaceId: teamWorkspaceId ?? undefined,
              roleLayer: previewLayer,
            })
          }
        >
          {busy ? '生成中…' : '生成预览'}
        </button>
      </div>

      {error ? <span style={ERROR_STYLE}>{error}</span> : null}

      {preview ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 6,
            }}
          >
            {Object.entries(preview.layers).map(([layer, present]) => (
              <span
                key={layer}
                style={{
                  ...PANEL_INSET_STYLE,
                  padding: '6px 10px',
                  fontSize: 11,
                  color: present ? 'var(--fg-strong)' : 'var(--fg-muted)',
                  borderColor: present
                    ? 'color-mix(in srgb, var(--success) 35%, transparent)'
                    : 'color-mix(in srgb, var(--border-default) 60%, transparent)',
                }}
              >
                {layer}：{present ? '已注入' : '未提供'}
              </span>
            ))}
          </div>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
            估算 tokens：{preview.estimatedTokens.toLocaleString()}
            {preview.oversize ? ' · ⚠ 超过软上限 24K' : ''}
          </span>
          <pre
            style={{
              ...PANEL_INSET_STYLE,
              maxHeight: 320,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
              fontSize: 11,
              lineHeight: 1.4,
              color: 'var(--fg-default)',
            }}
          >
            {preview.stableBlock}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
