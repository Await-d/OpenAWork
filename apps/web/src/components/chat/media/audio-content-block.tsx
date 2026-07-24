import { AudioPlayer } from '@openAwork/shared-ui';
import { useMediaArtifact } from './use-media-artifact.js';

/**
 * 消息中的音频内容块渲染。
 *
 * 接收 InputAudioContent 的数据，如果是 artifactId 则异步加载，
 * 如果是 audioUrl 则直接使用。
 */
export function AudioContentBlock({
  artifactId,
  audioUrl,
  fileName,
  mimeType,
  duration,
  transcript,
}: {
  artifactId?: string;
  audioUrl?: string;
  fileName?: string;
  mimeType?: string;
  duration?: number;
  transcript?: string;
}) {
  const { mediaSrc, loading, error, fileName: loadedFileName, retry } = useMediaArtifact(artifactId);

  const src = audioUrl ?? mediaSrc;
  const displayName = fileName ?? loadedFileName;

  if (loading) {
    return (
      <div style={{ padding: '12px 16px', color: 'var(--fg-muted)', fontSize: 12 }}>
        加载音频中…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
        <span style={{ color: 'var(--fg-complement)', fontSize: 12 }}>
          音频加载失败: {error}
        </span>
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
    <AudioPlayer
      src={src}
      fileName={displayName}
      mimeType={mimeType}
      duration={duration}
      transcript={transcript}
    />
  );
}
