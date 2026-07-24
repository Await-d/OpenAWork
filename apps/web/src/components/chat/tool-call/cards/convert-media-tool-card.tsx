import { resolveToolVisualStatus, type ToolCallCardProps } from '@openAwork/shared-ui';
import { useMemo } from 'react';
import { AudioContentBlock } from '../../media/audio-content-block.js';
import { VideoContentBlock } from '../../media/video-content-block.js';
import { ToolIcon } from '../display/tool-icon.js';
import { formatElapsed } from '../shared/format.js';

interface ConvertMediaResult {
  success?: boolean;
  artifactId?: string;
  fileName?: string;
  mimeType?: string;
  targetFormat?: string;
  originalMimeType?: string;
  sizeBytes?: number;
  duration?: number;
  width?: number;
  height?: number;
  summary?: string;
}

function parseConvertMediaOutput(output: unknown): ConvertMediaResult | null {
  if (typeof output !== 'string') return null;
  try {
    return JSON.parse(output) as ConvertMediaResult;
  } catch {
    return null;
  }
}

function isAudioMime(mime: string): boolean {
  return mime.startsWith('audio/');
}

function isVideoMime(mime: string): boolean {
  return mime.startsWith('video/');
}

export function ConvertMediaToolCard({
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

  const result = useMemo(() => parseConvertMediaOutput(output), [output]);
  const targetFormat = typeof input.targetFormat === 'string' ? input.targetFormat : '';

  const isAudio = result?.mimeType ? isAudioMime(result.mimeType) : false;
  const isVideo = result?.mimeType ? isVideoMime(result.mimeType) : false;

  return (
    <div
      className="tool-call-block"
      data-tool-status={visualState}
      style={{ overflow: 'hidden', paddingLeft: 0 }}
    >
      <div className="tool-call-block-header" style={{ cursor: 'default', minHeight: 32 }}>
        <ToolIcon toolName="convert_media" status={visualState} size={14} />
        <span className="tool-call-block-title" style={{ flex: '0 1 auto', maxWidth: '55%' }}>
          {visualState === 'running'
            ? '正在转换媒体…'
            : visualState === 'failed'
              ? '媒体转换失败'
              : `转换为 ${targetFormat.toUpperCase()}`}
        </span>
        {result && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', flexShrink: 0 }}>
            {result.mimeType && (
              <span style={paramPillStyle}>{result.mimeType.split('/')[1]?.toUpperCase()}</span>
            )}
            {result.sizeBytes !== undefined && result.sizeBytes > 0 && (
              <span style={paramPillStyle}>{formatBytes(result.sizeBytes)}</span>
            )}
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
              {typeof output === 'string' ? output : '转换失败'}
            </div>
          )}
          {!isError && result?.artifactId && isAudio && (
            <AudioContentBlock
              artifactId={result.artifactId}
              fileName={result.fileName}
              mimeType={result.mimeType}
              duration={result.duration}
            />
          )}
          {!isError && result?.artifactId && isVideo && (
            <VideoContentBlock
              artifactId={result.artifactId}
              fileName={result.fileName}
              mimeType={result.mimeType}
              duration={result.duration}
              width={result.width}
              height={result.height}
            />
          )}
          {result?.summary && (
            <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{result.summary}</div>
          )}
        </div>
      )}
    </div>
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
