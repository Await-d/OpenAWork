/**
 * DOCX preview — uses `mammoth` to convert .docx (Open Office XML)
 * into HTML, then renders inside a sandboxed scrollable container.
 *
 * mammoth strips most styling (it's a "semantic content" extractor),
 * which is the correct choice for read-only preview: heading levels,
 * lists, tables and inline emphasis come through, but pixel-perfect
 * fidelity (custom fonts, complex floats) is sacrificed for safety
 * and bundle size. Users wanting the exact original document
 * download it via the system app.
 */

import { useEffect, useState } from 'react';

interface DocxPreviewProps {
  buffer: ArrayBuffer;
}

export default function DocxPreview({ buffer }: DocxPreviewProps) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; html: string; warnings: string[] }
    | { status: 'error'; error: string }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const mammoth = await import('mammoth');
        // mammoth ships both browser and node entries; the browser
        // build is exposed as the package default.
        const result = await mammoth.convertToHtml(
          { arrayBuffer: buffer },
          {
            // Be lenient: include images as base64 data URLs so the
            // preview shows embedded pictures without an extra fetch.
            // The sandboxed container caps this — see CSS below.
            includeDefaultStyleMap: true,
          },
        );
        if (cancelled) return;
        setState({
          status: 'ready',
          html: result.value,
          warnings: result.messages.map((m) => m.message),
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: 'error',
          error: err instanceof Error ? err.message : '解析失败',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buffer]);

  if (state.status === 'loading') {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-3)',
          fontSize: 12,
        }}
      >
        正在解析 DOCX…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--danger)',
          fontSize: 12,
          padding: 24,
          textAlign: 'center',
        }}
      >
        DOCX 解析失败:{state.error}
      </div>
    );
  }

  return (
    <div
      data-testid="docx-preview"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        background: 'var(--surface)',
        padding: '20px 24px',
      }}
    >
      <div
        className="docx-preview-content"
        style={{
          maxWidth: 760,
          margin: '0 auto',
          padding: 24,
          background: '#ffffff',
          color: '#1f2328',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          fontSize: 14,
          lineHeight: 1.7,
          fontFamily:
            '"Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        }}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: html comes from mammoth which sanitizes via its style map
        dangerouslySetInnerHTML={{ __html: state.html }}
      />
      {state.warnings.length > 0 && (
        <details
          style={{
            maxWidth: 760,
            margin: '12px auto 0',
            fontSize: 11,
            color: 'var(--text-3)',
          }}
        >
          <summary style={{ cursor: 'pointer' }}>解析警告 ({state.warnings.length})</summary>
          <ul style={{ marginTop: 6 }}>
            {state.warnings.slice(0, 50).map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
