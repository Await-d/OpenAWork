import { VideoPlayer } from '@openAwork/shared-ui';
import { useMediaArtifact } from './use-media-artifact.js';

/**
 * 消息中的视频内容块渲染。
 *
 * 接收 InputVideoContent 的数据，如果是 artifactId 则异步加载，
 * 如果是 videoUrl 则直接使用。
 */
export function VideoContentBlock({
  artifactId,
  videoUrl,
  fileName,
  mimeType,
  duration,
  thumbnailUrl,
  width,
  height,
}: {
  artifactId?: string;
  videoUrl?: string;
  fileName?: string;
  mimeType?: string;
  duration?: number;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
}) {
  const {
    mediaSrc,
    loading,
    error,
    fileName: loadedFileName,
    retry,
  } = useMediaArtifact(artifactId);

  const src = videoUrl ?? mediaSrc;
  const displayName = fileName ?? loadedFileName;
  const poster = thumbnailUrl;

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 480,
          maxWidth: '100%',
          aspectRatio: '16 / 9',
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-overlay)',
          color: 'var(--fg-muted)',
          fontSize: 12,
        }}
      >
        加载视频中…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
        <span style={{ color: 'var(--fg-complement)', fontSize: 12 }}>视频加载失败: {error}</span>
        <button
          type="button"
          onClick={retry}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid var(--border-default)',
            background: 'var(--bg-base)',
            color: 'var(--fg-muted)',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          重试
        </button>
      </div>
    );
  }

  if (!src) {
    return null;
  }

  return (
    <VideoPlayer
      src={src}
      fileName={displayName}
      mimeType={mimeType}
      poster={poster}
      duration={duration}
      width={width}
      height={height}
    />
  );
}
