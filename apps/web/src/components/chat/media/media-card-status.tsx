import { resolveFileBadge } from './media-file-badge.js';
import './media-card-status.css';

/**
 * 媒体卡片的「取流中 / 取流失败」统一呈现。
 *
 * 收敛动机：此前同一条消息里的媒体在两条路径上有两套观感 ——
 * - 结构化 part 走 `VideoContentBlock` / `AudioContentBlock`：内联样式、固定 480px 宽、
 *   `16/9` 占位框、「加载视频中…」、失败时给一个内联描边的「重试」小按钮
 * - 文本引用走 `MediaReferenceCard`：卡片壳 + 「加载中…」
 *
 * 两者对用户是同一件事，样式却不同源，任何一处调整都会漏掉另一处。现在统一到这里，
 * 三种媒体（视频 / 音频 / 文件引用）与两套加载态共用同一份呈现。
 */
export interface MediaCardStatusProps {
  /** 文件名；缺省时退化为通用文案（结构化媒体 part 不一定带名字）。 */
  readonly fileName?: string | undefined;
  readonly kind: 'pending' | 'error';
  /** 错误详情，拼在「加载失败」之后；缺省只显示「加载失败」。 */
  readonly detail?: string | null;
  readonly onRetry?: (() => void) | undefined;
}

export function MediaCardStatus({ fileName, kind, detail, onRetry }: MediaCardStatusProps) {
  const displayName = fileName ?? '媒体文件';
  const badge = resolveFileBadge(displayName);
  const isError = kind === 'error';
  const hint = isError ? (detail ? `加载失败：${detail}` : '加载失败') : '加载中…';

  return (
    <div
      className="media-card-status"
      data-kind={kind}
      role="status"
      // 加载中不打断读屏播报；失败时把详情读出来。
      aria-live={isError ? 'polite' : 'off'}
    >
      <span className="media-card-status__glyph" aria-hidden="true">
        {badge.label}
      </span>
      <span className="media-card-status__meta">
        <span className="media-card-status__name" title={displayName}>
          {displayName}
        </span>
        <span className="media-card-status__hint">{hint}</span>
      </span>
      {isError && onRetry ? (
        <button type="button" className="media-card-status__retry" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}
