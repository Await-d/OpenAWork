import { tokens } from '@openAwork/shared-ui';
import { useSearchParams } from 'react-router';
import { useAuthStore } from '../stores/auth.js';
import { ArtifactRecordList } from './artifacts/artifact-record-list.js';
import { ArtifactSessionRail } from './artifacts/artifact-session-rail.js';
import { ArtifactWorkbench } from './artifacts/artifact-workbench.js';
import { useArtifactsWorkspace } from './artifacts/use-artifacts-workspace.js';

export default function ArtifactsPage() {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const [searchParams] = useSearchParams();
  const preferredSessionId = searchParams.get('sessionId');
  const {
    createArtifact,
    error,
    loadingArtifacts,
    loadingSessions,
    revertingVersionId,
    revertArtifact,
    saveArtifact,
    saving,
    selectedArtifact,
    selectedArtifactId,
    selectedSession,
    selectedSessionId,
    sessionArtifacts,
    sessions,
    setSelectedArtifactId,
    setSelectedSessionId,
    versions,
  } = useArtifactsWorkspace({ gatewayUrl, preferredSessionId, token });

  return (
    <div className="page-root">
      <div className="page-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="page-title">产物工作区</span>
          <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
            直接浏览会话内的内容型 artifact，支持保存版本、回滚与实时预览。
          </span>
        </div>
      </div>

      <div
        className="page-content"
        style={{ padding: 0, overflow: 'hidden', background: 'var(--bg)' }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: tokens.spacing.lg,
            padding: tokens.spacing.lg,
            alignItems: 'flex-start',
            overflowY: 'auto',
            height: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ flex: '1 1 240px', minWidth: 240, maxWidth: 320 }}>
            <ArtifactSessionRail
              loading={loadingSessions}
              selectedSessionId={selectedSessionId}
              sessions={sessions}
              onSelect={setSelectedSessionId}
            />
          </div>
          <div style={{ flex: '1 1 280px', minWidth: 280, maxWidth: 360 }}>
            <ArtifactRecordList
              artifacts={sessionArtifacts}
              loading={loadingArtifacts}
              selectedArtifactId={selectedArtifactId}
              onCreateHtml={() =>
                void createArtifact({
                  title: `artifact-${Date.now()}.html`,
                  type: 'html',
                  content:
                    '<!doctype html><html><body><main><h1>Hello Artifact</h1></main></body></html>',
                })
              }
              onCreateMarkdown={() =>
                void createArtifact({
                  title: `artifact-${Date.now()}.md`,
                  type: 'markdown',
                  content: '# 新建产物\n\n- 在这里开始编辑内容。',
                })
              }
              onSelect={setSelectedArtifactId}
            />
          </div>
          <div
            style={{
              flex: '2 1 560px',
              minWidth: 320,
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.spacing.md,
            }}
          >
            {selectedSession && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: tokens.spacing.md,
                  flexWrap: 'wrap',
                  padding: '10px 14px',
                  borderRadius: tokens.radius.lg,
                  border: `1px solid ${tokens.color.borderSubtle}`,
                  background: 'color-mix(in oklch, var(--surface) 76%, transparent)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <strong style={{ color: 'var(--text)', fontSize: 13 }}>
                    当前会话：{selectedSession.title ?? '未命名会话'}
                  </strong>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {selectedSession.id.slice(0, 8)}… · {sessionArtifacts.length} 个内容型 artifact
                  </span>
                </div>
              </div>
            )}
            {error && (
              <output
                aria-live="polite"
                style={{
                  display: 'block',
                  borderRadius: tokens.radius.lg,
                  padding: '12px 14px',
                  fontSize: 12,
                  background: 'color-mix(in oklch, var(--danger) 12%, transparent)',
                  border: '1px solid color-mix(in oklch, var(--danger) 30%, transparent)',
                  color: 'var(--danger)',
                }}
              >
                {error}
              </output>
            )}
            <ArtifactWorkbench
              artifact={selectedArtifact}
              revertingVersionId={revertingVersionId}
              saving={saving}
              versions={versions}
              onRevert={(versionId) => void revertArtifact(versionId)}
              onSave={(draft) => void saveArtifact(draft)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
