import { resolveToolVisualStatus, type ToolCallCardProps } from '@openAwork/shared-ui';
import { useMemo } from 'react';
import { AudioContentBlock } from '../../media/audio-content-block.js';
import { ToolIcon } from '../display/tool-icon.js';
import { formatElapsed } from '../shared/format.js';

interface GenerateAudioResult {
  success?: boolean;
  artifactId?: string;
  fileName?: string;
  mimeType?: string;
  voice?: string;
  rate?: number;
  volume?: number;
  duration?: number;
  sizeBytes?: number;
  textPreview?: string;
  summary?: string;
}

function parseGenerateAudioOutput(output: unknown): GenerateAudioResult | null {
  if (typeof output !== 'string') return null;
  try {
    return JSON.parse(output) as GenerateAudioResult;
  } catch {
    return null;
  }
}

export function GenerateAudioToolCard({
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

  const result = useMemo(() => parseGenerateAudioOutput(output), [output]);
  const text = typeof input.text === 'string' ? input.text : '';
  const textPreview = text.length > 50 ? `${text.slice(0, 50)}…` : text;
  const voice = typeof input.voice === 'string' ? input.voice : 'zh-CN-XiaoxiaoNeural';

  return (
    <div
      className="tool-call-block"
      data-tool-status={visualState}
      style={{ overflow: 'hidden', paddingLeft: 0 }}
    >
      <div className="tool-call-block-header" style={{ cursor: 'default', minHeight: 32 }}>
        <ToolIcon toolName="generate_audio" status={visualState} size={14} />
        <span
          className="tool-call-block-title"
          style={{ flex: '0 1 auto', maxWidth: '55%' }}
          title={text}
        >
          {visualState === 'running'
            ? '正在生成语音…'
            : visualState === 'failed'
              ? '语音生成失败'
              : `语音合成: ${textPreview}`}
        </span>
        {result && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginLeft: 'auto',
              flexShrink: 0,
            }}
          >
            <span style={paramPillStyle}>{voice}</span>
            {result.duration !== undefined && result.duration > 0 && (
              <span style={paramPillStyle}>{Math.round(result.duration)}s</span>
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
              {typeof output === 'string' ? output : '生成失败'}
            </div>
          )}
          {!isError && result?.artifactId && (
            <AudioContentBlock
              artifactId={result.artifactId}
              fileName={result.fileName}
              mimeType={result.mimeType}
              duration={result.duration}
              transcript={text}
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
