import { AudioPlayer, VideoPlayer } from '@openAwork/shared-ui';
import { MediaFileCard } from './media-file-card.js';
import { resolveFileBadge } from './media-file-badge.js';
import { MediaCardStatus } from './media-card-status.js';
import { useSessionArtifactBlob } from './use-session-artifact-blob.js';
import './media-reference-card.css';

/**
 * 消息内「文件引用」的统一入口：按扩展名决定渲染成播放器还是文件卡片。
 *
 * 为什么需要它：上游把**非图片附件一律压平成文本行**（`prepare-standard-chat-send-input.ts:48-69`
 * 只把 `type === 'image'` 变成结构化 part），因此音频 / 视频附件在消息里也只有
 * `fileName` + `artifactId`，与 PDF 走同一条路径。此前它们被统一渲染成文件卡片（能下载、
 * 不能播放），本组件把它们升级为内联播放器。
 *
 * 取流必须走**会话级端点**（`useSessionArtifactBlob` → `downloadFromSession`）：上传附件是
 * 磁盘型产物，而 `GET /artifacts/:id` 查的是 SQLite 内容型表，**两者不可互换**。用错端点会
 * 稳定 404 并静默降级 —— 详见该 hook 的注释。
 *
 * 降级策略（宁可少给能力，也不给坏交互）：
 * - 扩展名不是音视频 → 直接文件卡片，且**不发起取流请求**（hook 收到 undefined 直接返回）
 * - 取流失败、或缺 `sessionId` → 回落文件卡片（下载仍可用）
 * - 取流中 → 轻量占位，避免「先闪一下文件卡片、再跳成播放器」的观感
 *
 * 已知边界：磁盘型附件端点只回二进制，**没有** metadata，因此不再传 duration / poster /
 * width / height —— 这些改由播放器自己从媒体元素读取（`loadedmetadata` / `durationchange`）。
 */
export interface MediaReferenceCardProps {
  readonly fileName: string;
  readonly artifactId: string;
  /** 会话 id；缺省时取不到磁盘型附件内容，直接走文件卡片降级。 */
  readonly sessionId?: string | undefined;
}

export function MediaReferenceCard({ fileName, artifactId, sessionId }: MediaReferenceCardProps) {
  const badge = resolveFileBadge(fileName);
  const isVideo = badge.tone === 'video';
  const isAudio = badge.tone === 'audio';
  const playable = isVideo || isAudio;
  // 非音视频不请求取流：hook 收到 undefined 会立刻返回，不发请求。
  const artifact = useSessionArtifactBlob(sessionId, playable ? artifactId : undefined);

  if (playable && artifact.loading) {
    return <MediaCardStatus fileName={fileName} kind="pending" />;
  }

  if (playable && artifact.error) {
    // 取流失败后**不再静默降级为文件卡片**：下载走的是同一个端点，大概率同样失败，
    // 给一个必然失败的下载按钮是假承诺。改为如实报错 + 重试。
    return (
      <MediaCardStatus
        fileName={fileName}
        kind="error"
        detail={artifact.error}
        onRetry={artifact.retry}
      />
    );
  }

  if (playable && artifact.objectUrl) {
    return (
      <div className="media-reference-card" data-kind={isVideo ? 'video' : 'audio'}>
        {isVideo ? (
          <VideoPlayer src={artifact.objectUrl} fileName={fileName} />
        ) : (
          <AudioPlayer src={artifact.objectUrl} fileName={fileName} />
        )}
      </div>
    );
  }

  /* 非音视频、取流失败、或内容为空：一律回落为文件卡片（下载始终可用）。 */
  return <MediaFileCard fileName={fileName} artifactId={artifactId} sessionId={sessionId} />;
}
