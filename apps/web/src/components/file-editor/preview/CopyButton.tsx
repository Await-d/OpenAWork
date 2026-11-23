import { useCallback, useEffect, useRef, useState } from 'react';
import { copyTextToClipboard } from '../../layout/file-tree/file-tree-actions.js';

/** 「已复制」提示停留时长，与消息侧代码块一致。 */
const COPY_FEEDBACK_MS = 1500;

/**
 * 预览表面的复制按钮。
 *
 * 为什么不直接用工具调用侧的 `CopyBtn`：它的 className 硬编码
 * `.tool-call-copy-btn`，规则只存在于 tool-call CSS（经 `chat-message.css`
 * 传递）。预览面可能渲染在产物页、团队侧栏等**没有加载聊天页样式表**的位置，
 * 直接用会退化成浏览器默认按钮。这里的按钮走预览自己的 `.oaw-preview-btn`
 * （`preview-surface.css`），与图表 / SVG 工具栏同源。
 *
 * 复制走公共封装：`navigator.clipboard` 在非安全上下文（http 内网访问）下不存在，
 * 直接调用会抛错；封装会在这种情况下回落 `execCommand('copy')`。彻底失败（如权限被拒）
 * 仍静默：复制是辅助功能，不该因此弹一个错误打断用户。
 */
export function CopyButton({
  text,
  label = '复制',
  className = 'oaw-preview-btn',
  testId,
}: {
  text: string;
  /** 未复制时显示的文案。 */
  label?: string;
  className?: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  // 卸载时清掉定时器：面板切换 / 虚拟化下 setState 会打到已卸载组件。
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const handleCopy = useCallback(() => {
    void copyTextToClipboard(text)
      .then(() => {
        setCopied(true);
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
      })
      .catch(() => undefined);
  }, [text]);

  return (
    <button
      type="button"
      className={className}
      data-copied={copied ? 'true' : undefined}
      data-testid={testId}
      onClick={handleCopy}
    >
      {copied ? '✓ 已复制' : label}
    </button>
  );
}
