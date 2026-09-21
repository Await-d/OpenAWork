import { resolveToolVisualStatus, type ToolCallCardProps } from '@openAwork/shared-ui';
import { useEffect, useMemo, useState } from 'react';
import { ImageLightbox, type ImageLightboxItem } from '../../image/image-lightbox.js';
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
  // 缩略图各自解析 artifact → src，这里按产物 id（而不是帧下标）汇总给图集查看器复用：
  // output/frames 重排或刷新时不会把旧帧的 src 错配到新帧，避免重复拉取。
  const [frameSrcByArtifactId, setFrameSrcByArtifactId] = useState<Record<string, string>>({});

  const handleFrameSrcResolved = (artifactId: string, src: string) => {
    setFrameSrcByArtifactId((previous) =>
      previous[artifactId] === src ? previous : { ...previous, [artifactId]: src },
    );
  };

  const frameArtifactIds = useMemo(
    () => (result?.frames ?? []).flatMap((frame) => (frame.artifactId ? [frame.artifactId] : [])),
    [result],
  );

  useEffect(() => {
    // frames 变化后清掉已不存在的产物条目；当前帧的 src 由各自缩略图重新上报。
    setFrameSrcByArtifactId((previous) => {
      const liveIds = new Set(frameArtifactIds);
      const staleIds = Object.keys(previous).filter((artifactId) => !liveIds.has(artifactId));
      if (staleIds.length === 0) return previous;
      const next = { ...previous };
      for (const artifactId of staleIds) {
        delete next[artifactId];
      }
      return next;
    });
  }, [frameArtifactIds]);

  const resolvedFrames: ResolvedFrameEntry[] = frames.flatMap((frame, frameIndex) => {
    const src = frame.artifactId ? frameSrcByArtifactId[frame.artifactId] : undefined;
    if (!src) return [];
    const label = frame.fileName ?? `帧 ${frameIndex + 1}`;
    return [
      {
        frameIndex,
        src,
        label,
        ...(frame.fileName ? { fileName: frame.fileName } : {}),
      },
    ];
  });

  useEffect(() => {
    // frames 变化导致当前帧不再可解析时收起查看器，避免留下不可见 / 错位的打开态。
    if (lightboxIndex === null) return;
    if (resolvedFrames.some((entry) => entry.frameIndex === lightboxIndex)) return;
    setLightboxIndex(null);
  }, [lightboxIndex, resolvedFrames]);

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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginLeft: 'auto',
              flexShrink: 0,
            }}
          >
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
                  ready={Boolean(frame.artifactId && frameSrcByArtifactId[frame.artifactId])}
                  onClick={() => setLightboxIndex(i)}
                  onSrcResolved={handleFrameSrcResolved}
                />
              ))}
            </div>
          )}
          {result?.summary && (
            <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{result.summary}</div>
          )}

          {/* Lightbox */}
          {lightboxIndex !== null && (
            <FrameLightbox
              entries={resolvedFrames}
              index={lightboxIndex}
              onIndexChange={setLightboxIndex}
              onClose={() => setLightboxIndex(null)}
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
  ready,
  onClick,
  onSrcResolved,
}: {
  frame: ExtractedFrameItem;
  index: number;
  ready: boolean;
  onClick: () => void;
  onSrcResolved: (artifactId: string, src: string) => void;
}) {
  const { mediaSrc, loading, error } = useMediaArtifact(frame.artifactId);
  const artifactId = frame.artifactId;

  useEffect(() => {
    if (!artifactId || !mediaSrc) return;
    onSrcResolved(artifactId, mediaSrc);
  }, [artifactId, mediaSrc, onSrcResolved]);

  return (
    <div
      aria-disabled={ready ? undefined : true}
      data-frame-index={index}
      onClick={ready ? onClick : undefined}
      style={{
        position: 'relative',
        width: 120,
        height: 80,
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid var(--border-subtle)',
        cursor: ready ? 'pointer' : 'progress',
        background: 'var(--bg-overlay)',
      }}
    >
      {loading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            color: 'var(--fg-muted)',
            fontSize: 10,
          }}
        >
          加载…
        </div>
      )}
      {!loading && !error && mediaSrc && (
        <img
          src={mediaSrc}
          alt={`帧 ${index + 1}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
      {!loading && !error && !mediaSrc && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            color: 'var(--fg-muted)',
            fontSize: 10,
          }}
        >
          准备中…
        </div>
      )}
      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            color: 'var(--fg-complement)',
            fontSize: 10,
          }}
        >
          失败
        </div>
      )}
      {frame.timestamp !== undefined && (
        <div
          style={{
            position: 'absolute',
            bottom: 2,
            right: 4,
            padding: '1px 4px',
            borderRadius: 3,
            background: 'rgba(0,0,0,0.6)',
            color: 'white',
            fontSize: 9,
          }}
        >
          {Math.round(frame.timestamp)}s
        </div>
      )}
    </div>
  );
}

interface ResolvedFrameEntry {
  frameIndex: number;
  src: string;
  label: string;
  fileName?: string;
}

function FrameLightbox({
  entries,
  index,
  onIndexChange,
  onClose,
}: {
  entries: readonly ResolvedFrameEntry[];
  index: number;
  onIndexChange: (frameIndex: number) => void;
  onClose: () => void;
}) {
  const activePosition = entries.findIndex((entry) => entry.frameIndex === index);
  if (activePosition < 0) return null;

  const items: ImageLightboxItem[] = entries.map((entry) => ({
    src: entry.src,
    alt: entry.label,
    caption: entry.label,
    ...(entry.fileName ? { fileName: entry.fileName } : {}),
  }));

  return (
    <ImageLightbox
      open
      items={items}
      index={activePosition}
      onIndexChange={(next) => {
        const nextFrame = entries[next];
        if (nextFrame) onIndexChange(nextFrame.frameIndex);
      }}
      onClose={onClose}
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
