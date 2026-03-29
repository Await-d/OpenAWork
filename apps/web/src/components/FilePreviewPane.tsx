import {
  buildPreviewDocument,
  getFilePreviewKind,
  getPreviewNote,
  getPreviewSandbox,
  getPreviewTitle,
} from '../utils/file-preview.js';

export function FilePreviewPane({ content, path }: { content: string; path: string }) {
  const previewKind = getFilePreviewKind(path);

  if (!previewKind) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          color: 'var(--text-3)',
          fontSize: 12,
          textAlign: 'center',
        }}
      >
        当前文件类型暂不支持预览。
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      <div
        data-testid="file-editor-preview-body"
        style={{
          flex: 1,
          minHeight: 0,
          padding: '10px 12px 12px',
          boxSizing: 'border-box',
          display: 'flex',
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              background: 'color-mix(in oklch, var(--surface) 92%, var(--bg) 8%)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span style={{ color: 'var(--text)', fontSize: 11, fontWeight: 700 }}>
                {getPreviewTitle(previewKind)}
              </span>
              <span style={{ color: 'var(--text-3)', fontSize: 11, lineHeight: 1.6 }}>
                {getPreviewNote(previewKind)}
              </span>
            </div>
            <span
              style={{
                flexShrink: 0,
                padding: '3px 8px',
                borderRadius: 999,
                background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
                color: 'var(--accent)',
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              Live Preview
            </span>
          </div>
          <iframe
            data-testid="file-editor-preview-frame"
            title={getPreviewTitle(previewKind)}
            sandbox={getPreviewSandbox(previewKind)}
            referrerPolicy="no-referrer"
            loading="lazy"
            srcDoc={buildPreviewDocument(previewKind, content)}
            style={{
              flex: 1,
              minHeight: 320,
              width: '100%',
              border: '1px solid var(--border-subtle)',
              borderRadius: 14,
              background: '#ffffff',
              display: 'block',
              boxShadow: '0 18px 36px color-mix(in oklch, var(--bg) 72%, transparent)',
            }}
          />
        </div>
      </div>
    </div>
  );
}
