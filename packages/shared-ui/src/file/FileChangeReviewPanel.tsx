import { useMemo, useState } from 'react';
import { FileStatusPanel, type FileChange } from './FileStatusPanel.js';
import { UnifiedCodeDiff } from '../tools/UnifiedCodeDiff.js';

interface FileChangeReviewPanelProps {
  changes: FileChange[];
  loadDiff: (filePath: string) => Promise<string>;
  onAccept: (filePath: string) => void;
  onRevert: (filePath: string) => Promise<void>;
}

export function FileChangeReviewPanel({
  changes,
  loadDiff,
  onAccept,
  onRevert,
}: FileChangeReviewPanelProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(changes[0]?.path ?? null);
  const [diffText, setDiffText] = useState('');
  const [loadingDiff, setLoadingDiff] = useState(false);
  const selectedChange = useMemo(
    () => changes.find((change) => change.path === selectedPath) ?? changes[0] ?? null,
    [changes, selectedPath],
  );

  async function handleSelect(path: string) {
    setSelectedPath(path);
    setLoadingDiff(true);
    try {
      setDiffText(await loadDiff(path));
    } finally {
      setLoadingDiff(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '1rem 1.25rem',
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-default)',
        borderRadius: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-strong)' }}>文件改动审阅</span>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            查看差异并决定接受或还原单个变更
          </span>
        </div>
      </div>

      <FileStatusPanel changes={changes} onFileClick={(path) => void handleSelect(path)} />

      {selectedChange && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--fg-strong)' }}>
              {selectedChange.path}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => onAccept(selectedChange.path)}
                style={actionButtonStyle('var(--success)', '透明')}
              >
                接受
              </button>
              <button
                type="button"
                onClick={() => void onRevert(selectedChange.path)}
                style={actionButtonStyle('var(--danger)', '透明')}
              >
                还原
              </button>
            </div>
          </div>
          {loadingDiff ? (
            <pre
              style={{
                margin: 0,
                padding: '0.75rem',
                minHeight: 140,
                maxHeight: 320,
                overflow: 'auto',
                background: 'var(--bg-overlay)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                fontSize: 12,
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                color: 'var(--fg-strong)',
              }}
            >
              正在加载 diff…
            </pre>
          ) : diffText ? (
            <UnifiedCodeDiff diffText={diffText} filePath={selectedChange.path} maxHeight={360} />
          ) : (
            <pre
              style={{
                margin: 0,
                padding: '0.75rem',
                minHeight: 140,
                maxHeight: 320,
                overflow: 'auto',
                background: 'var(--bg-overlay)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                fontSize: 12,
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                color: 'var(--fg-strong)',
              }}
            >
              暂无 diff。
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function actionButtonStyle(color: string, background: string) {
  return {
    background,
    border: `1px solid color-mix(in oklch, ${color} 35%, transparent)`,
    borderRadius: 7,
    padding: '4px 10px',
    fontSize: 12,
    color,
    cursor: 'pointer',
  } as const;
}
