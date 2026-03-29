import React, { useEffect, useState } from 'react';

interface HistoryEditDialogProps {
  initialText: string;
  onClose: () => void;
  onContinueCurrent: (text: string) => void;
  onCreateBranch: (text: string) => void;
  open: boolean;
}

function containsCodeMarkers(text: string): boolean {
  return /```|<file\s+name=|diff --git|^\s*(import|export|function|const|let|class)\s+/m.test(text);
}

export default function HistoryEditDialog({
  initialText,
  onClose,
  onContinueCurrent,
  onCreateBranch,
  open,
}: HistoryEditDialogProps) {
  const [draft, setDraft] = useState(initialText);

  useEffect(() => {
    if (!open) return;
    setDraft(initialText);
  }, [initialText, open]);

  const hasCodeMarkers = containsCodeMarkers(draft);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="历史消息编辑方式"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.58)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 70,
        padding: 20,
      }}
    >
      <div
        style={{
          width: 'min(560px, 100%)',
          borderRadius: 18,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          boxShadow: 'var(--shadow-xl)',
          padding: '20px 20px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>编辑历史消息</div>
          <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6, color: 'var(--text-2)' }}>
            这是历史消息。你可以继续在当前会话末尾追加一条新消息，或者从该消息创建一个新的子会话继续。
          </div>
        </div>

        {hasCodeMarkers && (
          <div
            style={{
              borderRadius: 12,
              border: '1px solid color-mix(in oklch, var(--warning, #f59e0b) 35%, var(--border))',
              background: 'color-mix(in oklch, var(--warning, #f59e0b) 12%, transparent)',
              padding: '10px 12px',
              fontSize: 12,
              lineHeight: 1.6,
              color: 'var(--text)',
            }}
          >
            检测到这条历史消息带有代码标识。为了避免后续上下文污染，建议从这里新建会话继续。
          </div>
        )}

        <textarea
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          data-testid="history-edit-dialog-textarea"
          style={{
            width: '100%',
            minHeight: 180,
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-2)',
            padding: '10px 12px',
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--text)',
            resize: 'vertical',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              height: 34,
              padding: '0 14px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-2)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onContinueCurrent(draft)}
            style={{
              height: 34,
              padding: '0 14px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            继续当前会话
          </button>
          <button
            type="button"
            onClick={() => onCreateBranch(draft)}
            style={{
              height: 34,
              padding: '0 14px',
              borderRadius: 10,
              border: '1px solid var(--accent)',
              background: 'var(--accent)',
              color: 'var(--accent-text)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            从这里新建会话
          </button>
        </div>
      </div>
    </div>
  );
}
