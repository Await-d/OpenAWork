/**
 * Two distinct error cards for the generate_image tool surface:
 *
 *   - `GenerateImageFetchErrorCard` — the tool itself succeeded but
 *     `${gatewayUrl}/artifacts/:id` failed (404, 401, CORS, empty body…).
 *     Recoverable by retry; renders a warning-coloured card with the
 *     specific `HTTP …` message + a retry button.
 *
 *   - `GenerateImageToolErrorCard` — the tool call itself failed
 *     (status === 'failed' or isError). Renders a danger-coloured card
 *     with the raw error text echoed back.
 */

export function GenerateImageFetchErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      style={{
        borderRadius: 10,
        border: '1px solid color-mix(in oklch, var(--warning) 22%, var(--border-subtle))',
        background: 'color-mix(in oklch, var(--warning) 5%, var(--surface))',
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--warning)',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>⚠</span>
        图片加载失败
      </div>
      <div
        style={{
          fontSize: 11,
          lineHeight: 1.6,
          color: 'var(--text-3)',
          wordBreak: 'break-word',
          fontFamily: 'var(--font-mono, monospace)',
        }}
      >
        {message}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={onRetry}
          style={{
            height: 24,
            padding: '0 10px',
            borderRadius: 6,
            border: '1px solid var(--border-subtle)',
            background: 'var(--surface)',
            color: 'var(--text-2)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          重试
        </button>
      </div>
    </div>
  );
}

export function GenerateImageToolErrorCard({ rawOutput }: { rawOutput?: unknown }) {
  return (
    <div
      style={{
        borderRadius: 10,
        border: '1px solid color-mix(in oklch, var(--danger) 20%, var(--border-subtle))',
        background: 'color-mix(in oklch, var(--danger) 4%, var(--surface))',
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--danger)',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>✕</span>
        图片生成失败
      </div>
      {typeof rawOutput === 'string' && rawOutput.length > 0 && (
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.6,
            color: 'color-mix(in oklch, var(--danger) 70%, var(--text-3))',
            wordBreak: 'break-word',
          }}
        >
          {rawOutput}
        </div>
      )}
    </div>
  );
}
