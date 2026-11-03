import { AudioPlayer } from '@openAwork/shared-ui';
import { MediaCardStatus } from './media-card-status.js';
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
  const {
    mediaSrc,
    loading,
    error,
    fileName: loadedFileName,
    retry,
  } = useMediaArtifact(artifactId);

  const src = audioUrl ?? mediaSrc;
  const displayName = fileName ?? loadedFileName;

  if (loading) {
    return <MediaCardStatus fileName={displayName} kind="pending" />;
  }

  if (error) {
    return <MediaCardStatus fileName={displayName} kind="error" detail={error} onRetry={retry} />;
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
