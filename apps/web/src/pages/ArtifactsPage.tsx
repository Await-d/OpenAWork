import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/auth.js';
import { ArtifactList, ArtifactPreview } from '@openAwork/shared-ui';
import type { ArtifactItem } from '@openAwork/shared-ui';

export default function ArtifactsPage() {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const themeVars = {
    '--color-surface': 'var(--surface)',
    '--color-border': 'var(--border)',
    '--color-text': 'var(--text)',
    '--color-muted': 'var(--text-3)',
    '--color-accent': 'var(--accent)',
  } as React.CSSProperties;

  useEffect(() => {
    if (!token) return;
    fetch(`${gatewayUrl}/sessions`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(
        (d: {
          sessions: {
            id: string;
            title: string | null;
            state_status: string;
            created_at: string;
          }[];
        }) => {
          setArtifacts(
            (d.sessions ?? []).map((s) => ({
              id: s.id,
              name: s.title ?? s.id.slice(0, 8),
              type: 'text' as const,
              createdAt: new Date(s.created_at).getTime(),
              sessionId: s.id,
            })),
          );
        },
      )
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '加载产物失败'))
      .finally(() => setLoading(false));
  }, [token, gatewayUrl]);

  return (
    <div className="page-root">
      <div className="page-header">
        <span className="page-title">产物</span>
      </div>

      <div className="page-content" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="empty-state" style={{ gap: 10, fontSize: 12 }}>
            <div className="spinner" />
            加载中…
          </div>
        ) : error ? (
          <div className="empty-state">
            <div
              style={{
                borderRadius: 10,
                padding: '12px 16px',
                fontSize: 12,
                background: 'color-mix(in oklch, var(--danger) 10%, transparent)',
                border: '1px solid color-mix(in oklch, var(--danger) 30%, transparent)',
                color: 'var(--danger)',
              }}
            >
              {error}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <div
              style={{
                flex: '0 0 260px',
                overflowY: 'auto',
                borderRight: '1px solid var(--border-subtle)',
                ...themeVars,
              }}
            >
              <ArtifactList
                artifacts={artifacts}
                onSelect={setSelectedId}
                selectedId={selectedId ?? undefined}
              />
            </div>
            {selectedId ? (
              <div
                style={{
                  flex: 1,
                  padding: '20px',
                  background: 'var(--bg-2)',
                  overflowY: 'auto',
                  ...themeVars,
                }}
              >
                {(() => {
                  const artifact = artifacts.find((a) => a.id === selectedId);
                  if (!artifact) return <div className="empty-state">产物未找到</div>;
                  return (
                    <ArtifactPreview
                      artifact={artifact}
                      onDownload={() => {
                        const blob = new Blob([artifact.name], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = artifact.name;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      onShare={() => void navigator.clipboard?.writeText(artifact.id)}
                    />
                  );
                })()}
              </div>
            ) : (
              <div className="empty-state" style={{ background: 'var(--bg-2)' }}>
                选择产物查看详情
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
