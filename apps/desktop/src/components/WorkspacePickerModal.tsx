import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface WorkspacePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => Promise<void>;
  validatePath?: (path: string) => Promise<{ valid: boolean; error?: string }>;
  loading?: boolean;
}

export default function WorkspacePickerModal({
  isOpen,
  onClose,
  onSelect,
  validatePath,
  loading = false,
}: WorkspacePickerModalProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setError(null);
      setConfirming(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handlePickFolder() {
    setError(null);
    setConfirming(true);
    try {
      const picked = await invoke<string | null>('pick_folder');
      if (!picked) {
        setConfirming(false);
        return;
      }
      if (validatePath) {
        const result = await validatePath(picked);
        if (!result.valid) {
          setError(result.error ?? '路径无效');
          setConfirming(false);
          return;
        }
      }
      await onSelect(picked);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '24px 28px',
          width: 360,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>选择工作区目录</div>
        <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>
          选择要绑定到当前会话的本地文件夹，AI 将可以读取该目录的文件内容。
        </div>
        {error && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--error, #f87171)',
              padding: '8px 12px',
              background: 'var(--error-muted, rgba(248,113,113,0.1))',
              borderRadius: 8,
            }}
          >
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 16px',
              fontSize: 13,
              color: 'var(--text-3)',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handlePickFolder()}
            disabled={confirming || loading}
            style={{
              background: 'var(--accent)',
              color: 'var(--accent-text)',
              border: 'none',
              borderRadius: 8,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: confirming || loading ? 'not-allowed' : 'pointer',
              opacity: confirming || loading ? 0.6 : 1,
            }}
          >
            {confirming ? '处理中…' : '浏览文件夹'}
          </button>
        </div>
      </div>
    </div>
  );
}
