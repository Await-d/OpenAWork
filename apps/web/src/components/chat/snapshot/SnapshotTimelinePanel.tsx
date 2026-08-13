/**
 * SnapshotTimelinePanel
 * ─────────────────────
 *
 * 在 chat 右侧面板中展示当前 session 的 snapshot tree 时间线。
 * 每个节点代表一次 step/turn 的文件变更快照，用户可以：
 *
 *  1. 查看每个快照涉及的文件列表和 +/- 统计
 *  2. 点击 "预览" 查看恢复到该快照会产生的 diff
 *  3. 点击 "恢复" 将工作区恢复到该快照
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  SnapshotTreeEntry,
  SnapshotTreesClient,
  RestorePreviewFile,
} from '@openAwork/web-client';
import { createSnapshotTreesClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';

// ─── 类型 ──────────────────────────────────────────────────────────────

interface SnapshotTimelinePanelProps {
  sessionId: string;
  gatewayUrl: string;
}

type PanelView = 'timeline' | 'preview';

interface PreviewState {
  treeHash: string;
  files: RestorePreviewFile[];
  summary: { total: number; changed: number; additions: number; deletions: number };
}

// ─── 辅助 ──────────────────────────────────────────────────────────────

function formatScopeKind(kind: SnapshotTreeEntry['scopeKind']): string {
  switch (kind) {
    case 'baseline':
      return '基线';
    case 'step':
      return '步骤';
    case 'turn':
      return '轮次';
    case 'restore':
      return '恢复';
    case 'manual':
      return '手动';
    default:
      return kind;
  }
}

function formatTime(iso: string): string {
  try {
    const date = new Date(iso.includes('T') ? iso : `${iso}Z`);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ─── 组件 ──────────────────────────────────────────────────────────────

export function SnapshotTimelinePanel({ sessionId, gatewayUrl }: SnapshotTimelinePanelProps) {
  const accessToken = useAuthStore((state) => state.accessToken);
  const [trees, setTrees] = useState<SnapshotTreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<PanelView>('timeline');
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Stable client instance
  const client = useMemo<SnapshotTreesClient>(
    () => createSnapshotTreesClient(gatewayUrl),
    [gatewayUrl],
  );

  // Track mounted state to avoid setState after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 加载时间线
  const loadTimeline = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const result = await client.list(accessToken, sessionId);
      if (mountedRef.current) setTrees(result.trees);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : '加载快照时间线失败');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [accessToken, sessionId, client]);

  useEffect(() => {
    void loadTimeline();
  }, [loadTimeline]);

  // 预览恢复
  const handlePreview = useCallback(
    async (treeHash: string) => {
      if (!accessToken) return;
      setLoading(true);
      try {
        const result = await client.restoreToTree(accessToken, sessionId, {
          treeHash,
          mode: 'preview',
        });
        if (!mountedRef.current) return;
        if (result.mode === 'preview') {
          setPreview({
            treeHash,
            files: result.files,
            summary: result.summary,
          });
          setView('preview');
        }
      } catch (err) {
        if (mountedRef.current) setError(err instanceof Error ? err.message : '预览失败');
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [accessToken, sessionId, client],
  );

  // 执行恢复
  const handleRestore = useCallback(
    async (treeHash: string) => {
      if (!accessToken) return;
      setRestoring(true);
      try {
        await client.restoreToTree(accessToken, sessionId, {
          treeHash,
          mode: 'apply',
        });
        if (!mountedRef.current) return;
        setView('timeline');
        setPreview(null);
        await loadTimeline();
      } catch (err) {
        if (mountedRef.current) setError(err instanceof Error ? err.message : '恢复失败');
      } finally {
        if (mountedRef.current) setRestoring(false);
      }
    },
    [accessToken, sessionId, client, loadTimeline],
  );

  // ── 预览视图 ──────────────────────────────────────────────────────
  if (view === 'preview' && preview) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-default)',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setView('timeline');
              setPreview(null);
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              cursor: 'pointer',
              fontSize: 12,
              padding: '4px 8px',
            }}
          >
            ← 返回时间线
          </button>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
            {preview.summary.changed}/{preview.summary.total} 文件变更
          </span>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 8 }}>
            恢复到 <code style={{ fontSize: 11 }}>{preview.treeHash.slice(0, 8)}</code> 的预览：
            <span style={{ marginLeft: 8 }}>
              +{preview.summary.additions} / -{preview.summary.deletions}
            </span>
          </div>

          {preview.files.map((file) => (
            <div
              key={file.filePath}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 0',
                fontSize: 12,
                opacity: file.changed ? 1 : 0.5,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: file.changed ? 'var(--fg-default)' : 'var(--fg-muted)',
                  minWidth: 28,
                }}
              >
                {file.status === 'added' ? '新增' : file.status === 'deleted' ? '删除' : '修改'}
              </span>
              <span
                style={{
                  flex: 1,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 11,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={file.filePath}
              >
                {file.filePath}
              </span>
              {file.changed && (
                <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                  +{file.additions ?? 0} / -{file.deletions ?? 0}
                </span>
              )}
            </div>
          ))}
        </div>

        <div
          style={{
            padding: '8px 12px',
            borderTop: '1px solid var(--border-default)',
            display: 'flex',
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={() => void handleRestore(preview.treeHash)}
            disabled={restoring || preview.summary.changed === 0}
            style={{
              flex: 1,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              background: 'var(--accent)',
              color: 'var(--accent-fg)',
              border: 'none',
              borderRadius: 4,
              cursor: restoring ? 'wait' : 'pointer',
              opacity: restoring || preview.summary.changed === 0 ? 0.5 : 1,
            }}
          >
            {restoring ? '恢复中...' : `恢复 ${preview.summary.changed} 个文件`}
          </button>
        </div>
      </div>
    );
  }

  // ── 时间线视图 ────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-default)' }}>
          快照时间线
        </span>
        <button
          type="button"
          onClick={() => void loadTimeline()}
          disabled={loading}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--fg-muted)',
            cursor: 'pointer',
            fontSize: 11,
            padding: '2px 6px',
          }}
        >
          {loading ? '加载中...' : '刷新'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--danger)' }}>{error}</div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {trees.length === 0 && !loading && (
          <div
            style={{
              padding: '16px 12px',
              fontSize: 12,
              color: 'var(--fg-muted)',
              textAlign: 'center',
            }}
          >
            暂无快照记录。对话产生文件变更后将自动生成快照。
          </div>
        )}

        {loading && trees.length === 0 && (
          <div style={{ padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  height: 36,
                  borderRadius: 8,
                  background: 'var(--bg-subtle)',
                  opacity: 0.5,
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
            ))}
          </div>
        )}

        {trees.map((tree, index) => (
          <div
            key={tree.treeHash}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '6px 12px',
              borderBottom: index < trees.length - 1 ? '1px solid var(--border-subtle)' : undefined,
            }}
          >
            {/* 时间线节点指示器 */}
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                marginTop: 4,
                flexShrink: 0,
                background:
                  tree.scopeKind === 'restore'
                    ? 'var(--warning)'
                    : tree.scopeKind === 'turn'
                      ? 'var(--accent)'
                      : 'var(--fg-muted)',
              }}
            />

            {/* 内容 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-default)' }}>
                  {formatScopeKind(tree.scopeKind)}
                </span>
                <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                  {formatTime(tree.createdAt)}
                </span>
                {tree.toolName && (
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--fg-muted)',
                      background: 'var(--bg-subtle)',
                      padding: '1px 4px',
                      borderRadius: 3,
                    }}
                  >
                    {tree.toolName}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
                {tree.filesChanged} 文件 · +{tree.additions} / -{tree.deletions}
              </div>
            </div>

            {/* 操作按钮 */}
            <button
              type="button"
              onClick={() => void handlePreview(tree.treeHash)}
              disabled={loading}
              className="ui-hover-surface"
              style={{
                background: 'none',
                border: '1px solid var(--border-default)',
                borderRadius: 4,
                color: 'var(--fg-muted)',
                cursor: loading ? 'wait' : 'pointer',
                fontSize: 10,
                padding: '2px 6px',
                flexShrink: 0,
              }}
            >
              恢复
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
