import { resolveToolVisualStatus, type ToolCallCardProps } from '@openAwork/shared-ui';
import { useMemo, useState } from 'react';
import { ImageLightbox } from '../../image/image-lightbox.js';
import { ToolIcon } from '../display/tool-icon.js';
import { useMediaArtifact } from '../../media/use-media-artifact.js';
import { formatElapsed } from '../shared/format.js';

interface ExtractedFrameItem {
  artifactId?: string;
  fileName?: string;
  timestamp?: number;
  mimeType?: string;
  sizeBytes?: number;
}

interface ExtractVideoFrameResult {
  success?: boolean;
  frames?: ExtractedFrameItem[];
  count?: number;
  summary?: string;
}

function parseExtractVideoFrameOutput(output: unknown): ExtractVideoFrameResult | null {
  if (typeof output !== 'string') return null;
  try {
    return JSON.parse(output) as ExtractVideoFrameResult;
  } catch {
    return null;
  }
}

export function ExtractVideoFrameToolCard({
  input,
  output,
  status,
  isError,
  durationMs,
}: {
  input: Record<string, unknown>;
  output?: unknown;
  status?: ToolCallCardProps['status'];
  isError?: boolean;
  durationMs?: number;
}) {
  const visualState = resolveToolVisualStatus({
    defaultStatus: 'running',
    isError,
    output,
    status,
  });

  const result = useMemo(() => parseExtractVideoFrameOutput(output), [output]);
  const frames = result?.frames ?? [];
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <div
      className="tool-call-block"
      data-tool-status={visualState}
      style={{ overflow: 'hidden', paddingLeft: 0 }}
    >
      <div className="tool-call-block-header" style={{ cursor: 'default', minHeight: 32 }}>
        <ToolIcon toolName="extract_video_frame" status={visualState} size={14} />
        <span className="tool-call-block-title" style={{ flex: '0 1 auto', maxWidth: '55%' }}>
          {visualState === 'running'
            ? '正在提取视频帧…'
            : visualState === 'failed'
              ? '帧提取失败'
              : `提取 ${result?.count ?? frames.length} 帧画面`}
        </span>
        {result && frames.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', flexShrink: 0 }}>
            <span style={paramPillStyle}>{frames.length} 帧</span>
          </div>
        )}
        {visualState !== 'running' && durationMs != null && durationMs > 0 && (
          <span className="tool-call-block-elapsed">{formatElapsed(durationMs)}</span>
        )}
      </div>

      {visualState !== 'running' && (
        <div style={{ padding: '6px 12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {isError && (
            <div style={{ color: 'var(--fg-complement)', fontSize: 12 }}>
              {typeof output === 'string' ? output : '提取失败'}
            </div>
          )}
          {!isError && frames.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {frames.map((frame, i) => (
                <FrameThumbnail
                  key={i}
                  frame={frame}
                  index={i}
                  onClick={() => setLightboxIndex(i)}
                />
              ))}
            </div>
          )}
          {result?.summary && (
            <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{result.summary}</div>
          )}

          {/* Lightbox */}
          {lightboxIndex !== null && frames[lightboxIndex]?.artifactId && (
            <FrameLightbox
              artifactId={frames[lightboxIndex].artifactId!}
              open={lightboxIndex !== null}
              onClose={() => setLightboxIndex(null)}
              fileName={frames[lightboxIndex]?.fileName}
            />
          )}
        </div>
      )}
    </div>
  );
}

function FrameThumbnail({
  frame,
  index,
  onClick,
}: {
  frame: ExtractedFrameItem;
  index: number;
  onClick: () => void;
}) {
  const { mediaSrc, loading, error } = useMediaArtifact(frame.artifactId);

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        width: 120,
        height: 80,
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid var(--border-subtle)',
        cursor: 'pointer',
        background: 'var(--bg-overlay)',
      }}
    >
      {loading && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '100%', height: '100%', color: 'var(--fg-muted)', fontSize: 10,
        }}>
          加载…
        </div>
      )}
      {!loading && !error && mediaSrc && (
        <img src={mediaSrc} alt={`帧 ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '100%', height: '100%', color: 'var(--fg-complement)', fontSize: 10,
        }}>
          失败
        </div>
      )}
      {frame.timestamp !== undefined && (
        <div style={{
          position: 'absolute', bottom: 2, right: 4,
          padding: '1px 4px', borderRadius: 3,
          background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: 9,
        }}>
          {Math.round(frame.timestamp)}s
        </div>
      )}
    </div>
  );
}

function FrameLightbox({
  artifactId,
  open,
  onClose,
  fileName,
}: {
  artifactId: string;
  open: boolean;
  onClose: () => void;
  fileName?: string;
}) {
  const { mediaSrc } = useMediaArtifact(artifactId);

  if (!mediaSrc) return null;

  return (
    <ImageLightbox
      src={mediaSrc}
      open={open}
      onClose={onClose}
      alt={fileName ?? '视频帧'}
      {...(fileName ? { fileName } : {})}
    />
  );
}

const paramPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 18,
  padding: '0 6px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 600,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  background: 'color-mix(in oklch, var(--fg-muted) 8%, transparent)',
  color: 'var(--fg-muted)',
};
