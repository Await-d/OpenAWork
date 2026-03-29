import type { OpenFile } from '../hooks/useFileEditor.js';
import { FileIcon } from './FileIcon.js';

export function EditorTabBar({
  files,
  activeFilePath,
  isDirty,
  isPreviewAvailable,
  onActivate,
  onClose,
  onPreview,
  previewFilePath,
}: {
  files: OpenFile[];
  activeFilePath: string | null;
  isDirty: (path: string) => boolean;
  isPreviewAvailable: (path: string) => boolean;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onPreview: (path: string) => void;
  previewFilePath: string | null;
}) {
  if (files.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        overflowX: 'auto',
        flexShrink: 0,
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        scrollbarWidth: 'none',
      }}
    >
      {files.map((file) => {
        const active = file.path === activeFilePath;
        const dirty = isDirty(file.path);
        const previewAvailable = isPreviewAvailable(file.path);
        const previewActive = previewFilePath === file.path;
        return (
          <div
            key={file.path}
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 34,
              flexShrink: 0,
              borderRight: '1px solid var(--border-subtle)',
              borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
              background: active ? 'var(--bg)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--text-3)',
            }}
          >
            <button
              type="button"
              onClick={() => onActivate(file.path)}
              title={file.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '0 8px',
                height: '100%',
                minWidth: 0,
                cursor: 'pointer',
                background: 'transparent',
                color: 'inherit',
                fontSize: 12,
                border: 'none',
                flexShrink: 0,
                flexGrow: 1,
              }}
            >
              <FileIcon path={file.path} size={13} />
              <span
                style={{
                  maxWidth: 120,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {file.name}
              </span>
              {dirty && (
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    flexShrink: 0,
                  }}
                />
              )}
            </button>
            {previewAvailable && (
              <button
                type="button"
                onClick={() => onPreview(file.path)}
                title="跳转预览"
                aria-label={`预览 ${file.name}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 18,
                  height: 18,
                  marginRight: 6,
                  alignSelf: 'center',
                  borderRadius: 4,
                  border: 'none',
                  background: previewActive
                    ? 'color-mix(in oklch, var(--accent) 16%, transparent)'
                    : 'transparent',
                  color: previewActive ? 'var(--accent)' : 'var(--text-3)',
                  cursor: 'pointer',
                  flexShrink: 0,
                  padding: 0,
                }}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => onClose(file.path)}
              title="关闭"
              aria-label={`关闭 ${file.name}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 16,
                height: 16,
                margin: '0 10px 0 0',
                alignSelf: 'center',
                borderRadius: 3,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-3)',
                cursor: 'pointer',
                flexShrink: 0,
                padding: 0,
              }}
            >
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
