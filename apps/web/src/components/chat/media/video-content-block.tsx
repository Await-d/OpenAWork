import { VideoPlayer } from '@openAwork/shared-ui';
import { MediaCardStatus } from './media-card-status.js';
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
    return <MediaCardStatus fileName={displayName} kind="pending" />;
  }

  if (error) {
    return <MediaCardStatus fileName={displayName} kind="error" detail={error} onRetry={retry} />;
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
