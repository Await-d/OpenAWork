import { useState } from 'react';
import { createArtifactsClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { exportFile } from '../../../utils/export-file.js';
import { MediaCardStatus } from './media-card-status.js';
import { resolveFileBadge } from './media-file-badge.js';
import { PdfPreview } from './pdf-preview.js';
import { useSessionArtifactBlob } from './use-session-artifact-blob.js';
import './media-file-card.css';

/**
 * 消息内文件卡片。
 *
 * 数据来源是消息正文里的引用行 `- <fileName> (artifact:<id>)`（由接入层解析后传入），
 * 因此这里**只依赖 `fileName` 与 `artifactId` 两个字段**，不依赖解析模块的类型 ——
 * 解析实现换路线时卡片无需改动。
 *
 * 已知边界：文本行里没有大小与 MIME，所以卡片不显示文件大小（宁可不显示，也不额外发请求）。
 * 音频 / 视频附件同样走这条文本路径，但**音视频已由 `MediaReferenceCard` 升级为内联播放器**，
 * 只有「类型不可判定」「取流中」「取流失败」三种情况才回落到本卡片（见其降级链注释）。
 */

/** 下载按钮的三种状态。 */
type DownloadState = 'idle' | 'loading' | 'error';

/**
 * 拉取会话级附件并交给统一导出器落地。
 *
 * **端点选择是这里唯一的要害**：上传的附件是磁盘型产物，必须走 `downloadFromSession`
 * （`GET /sessions/:id/artifacts/:artifactId/content`）。若误用 `get()`
 * （`GET /artifacts/:id`，查 SQLite 内容型表）会稳定 404 —— 那正是修复前的行为，
 * 详见 `use-session-artifact-blob.ts` 的注释与 `media-file-card.test.tsx` 的端点契约测试。
 *
 * 磁盘型端点直接回二进制，因此不再需要解 base64 / 拼 data URL。
 *
 * 下载一律走 `exportFile({ blob, filename })`，而不是自己造 anchor：
 * 桌面端（Tauri）因此会弹**原生保存对话框**，与仓库其余导出行为一致；
 * 浏览器端仍走 object URL + anchor。用户在原生对话框点取消时 `exportFile`
 * 返回 `{ kind: 'cancelled' }`，这**不是错误**，调用方需据此回到 idle。
 *
 * 异步与异常处理一律留在模块级：React Compiler 1.0.0 不支持组件体内 `try/catch` 的
 * `finally` 子句（同一处置见 `use-media-artifact.ts:11-32` 的注释），故组件侧只用
 * Promise 链收口状态。
 */
async function downloadArtifactAsFile(
  gatewayUrl: string,
  token: string | null,
  sessionId: string | undefined,
  artifactId: string,
  fileName: string,
): Promise<void> {
  if (!token) throw new Error('未登录，无法下载');
  if (!sessionId) throw new Error('缺少会话信息，无法下载');
  const blob = await createArtifactsClient(gatewayUrl).downloadFromSession(
    token,
    sessionId,
    artifactId,
  );
  // cancelled 不抛错：调用方的 .then 会把状态收回 idle，不显示「下载失败」。
  await exportFile({ blob, filename: fileName });
}

export interface MediaFileCardProps {
  readonly fileName: string;
  readonly artifactId: string;
  /**
   * 会话 id —— 磁盘型附件按会话寻址，缺它就取不到内容。允许缺省只是为了「纯渲染」
   * 场景仍能显示卡片；此时点下载会得到明确错误，而不是发一个注定 404 的请求。
   */
  readonly sessionId?: string | undefined;
}

export function MediaFileCard({ fileName, artifactId, sessionId }: MediaFileCardProps) {
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const token = useAuthStore((state) => state.accessToken);
  const [downloadState, setDownloadState] = useState<DownloadState>('idle');
  const [previewRequested, setPreviewRequested] = useState(false);
  const badge = resolveFileBadge(fileName);
  // 本期只有 PDF 有内联预览能力（pdfjs）；其它类型仍走「下载后用本机程序打开」。
  const canPreview = badge.tone === 'pdf' && Boolean(sessionId);
  // 关键：**点了预览才开始取流**。PDF 可能几十 MB，不能在消息渲染时就无条件拉。
  const preview = useSessionArtifactBlob(
    sessionId,
    previewRequested && canPreview ? artifactId : undefined,
  );

  // 不手写 useCallback：apps/web/AGENTS.md 规定新代码默认不写 memo（交给 React Compiler）。
  const handleDownload = () => {
    setDownloadState('loading');
    void downloadArtifactAsFile(gatewayUrl, token, sessionId, artifactId, fileName)
      .then(() => {
        setDownloadState('idle');
      })
      .catch(() => {
        setDownloadState('error');
      });
  };

  return (
    <div className="media-file-card-group">
      <div className="media-file-card" data-tone={badge.tone}>
        <span className="media-file-card__glyph" aria-hidden="true">
          {badge.label}
        </span>
        <span className="media-file-card__meta">
          <span className="media-file-card__name" title={fileName}>
            {fileName}
          </span>
          <span className="media-file-card__sub">{badge.description}</span>
        </span>
        {canPreview ? (
          <button
            type="button"
            className="media-file-card__action media-file-card__action--wide"
            onClick={() => setPreviewRequested((requested) => !requested)}
            aria-expanded={previewRequested}
            // 可见文本只有「预览」两个字，光靠它会丢失对象；补 aria-label 让读屏听到文件名。
            aria-label={previewRequested ? `收起 ${fileName} 预览` : `预览 ${fileName}`}
            title={previewRequested ? `收起 ${fileName} 预览` : `预览 ${fileName}`}
          >
            {previewRequested ? '收起' : '预览'}
          </button>
        ) : null}
        <button
          type="button"
          className="media-file-card__action"
          onClick={handleDownload}
          disabled={downloadState === 'loading'}
          title={`下载 ${fileName}`}
          aria-label={`下载 ${fileName}`}
        >
          {downloadState === 'loading' ? '…' : '↓'}
        </button>
        {downloadState === 'error' ? (
          <span className="media-file-card__error" role="status">
            下载失败，请重试
          </span>
        ) : null}
      </div>

      {previewRequested && canPreview ? (
        <div className="media-file-card-group__preview">
          {preview.loading ? (
            <MediaCardStatus fileName={fileName} kind="pending" />
          ) : preview.error ? (
            <MediaCardStatus
              fileName={fileName}
              kind="error"
              detail={preview.error}
              onRetry={preview.retry}
            />
          ) : preview.objectUrl ? (
            <PdfPreview src={preview.objectUrl} fileName={fileName} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
