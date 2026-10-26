/* ── extract_media_info（媒体信息卡） ── */

import {
  type MediaInfoView,
  formatBitrate,
  formatBytes,
  formatDuration,
} from '../shared/media-info-view.js';

const MONO =
  'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace';

const TYPE_LABELS: Readonly<Record<string, string>> = {
  video: '视频',
  audio: '音频',
  image: '图片',
};

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{label}</span>
      <span
        style={{
          fontSize: 11.5,
          color: 'var(--fg-default)',
          fontFamily: MONO,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function MediaInfoPreview({ data }: { data: MediaInfoView }) {
  const cells: Array<[string, string]> = [];
  if (data.duration !== undefined) cells.push(['时长', formatDuration(data.duration)]);
  if (data.width !== undefined && data.height !== undefined) {
    cells.push(['分辨率', `${data.width}×${data.height}`]);
  }
  if (data.fps !== undefined) cells.push(['帧率', `${data.fps} fps`]);
  if (data.videoCodec) cells.push(['视频编码', data.videoCodec]);
  if (data.audioCodec) cells.push(['音频编码', data.audioCodec]);
  if (data.codec) cells.push(['编码', data.codec]);
  if (data.bitrate !== undefined) cells.push(['码率', formatBitrate(data.bitrate)]);
  if (data.sampleRate !== undefined) cells.push(['采样率', `${data.sampleRate} Hz`]);
  if (data.channels !== undefined) cells.push(['声道', String(data.channels)]);
  if (data.sizeBytes !== undefined) cells.push(['体积', formatBytes(data.sizeBytes)]);
  if (data.format) cells.push(['封装格式', data.format]);

  const typeLabel = data.type ? (TYPE_LABELS[data.type] ?? data.type) : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {(typeLabel || data.mimeType) && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          {typeLabel && (
            <span
              style={{
                flexShrink: 0,
                padding: '1px 6px',
                borderRadius: 999,
                fontSize: 10,
                color: 'var(--fg-muted)',
                background: 'var(--bg-overlay)',
                border: '1px solid var(--border-default)',
              }}
            >
              {typeLabel}
            </span>
          )}
          {data.mimeType && (
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--fg-subtle)' }}>
              {data.mimeType}
            </span>
          )}
        </div>
      )}

      {cells.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '6px 12px',
          }}
        >
          {cells.map(([label, value]) => (
            <InfoCell key={label} label={label} value={value} />
          ))}
        </div>
      )}

      {data.summary && (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', wordBreak: 'break-word' }}>
          {data.summary}
        </div>
      )}
    </div>
  );
}
