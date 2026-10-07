import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 悬浮延迟：开启延迟过滤掉「鼠标路过」，关闭延迟形成「桥」，
 * 让光标从触发元素移到弹层的途中弹层不会消失。
 */
const HOVER_OPEN_DELAY_MS = 250;
const HOVER_CLOSE_DELAY_MS = 120;

/**
 * 路径可点击 + 悬浮预览的共享交互逻辑。
 *
 * 抽出这个 hook 的原因：聊天里的路径出现在多个互不相干的渲染层（markdown 行内引用、
 * 工具输出预览、修改摘要卡片……），每处各写一份定时器就必然出现「某处忘了关闭」
 * 或「某处没有桥」的行为分叉。这里统一给出：
 *
 * - `triggerHandlers`：挂在触发元素上（鼠标进出 + focus/blur，键盘可达）；
 * - `panelHandlers`：挂在弹层上，与触发元素共用同一个关闭定时器；
 * - `showPreview`：是否该渲染弹层（`enabled` 为 false —— 例如没有
 *   FileEditorContext 的非聊天页 —— 时恒为 false）。
 *
 * `anchorRef` 直接以 `ref` 挂到 `<button>` 上即可（`ref={hover.anchorRef}`）；
 * 渲染弹层时用 `hover.anchorRef.current` 作为锚点。类型收窄到
 * `HTMLButtonElement` 是因为所有触发元素都是真正可聚焦的按钮——键盘用户必须
 * 能 Tab 到它。
 */
export function usePathHoverPreview({ enabled }: { enabled: boolean }) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    setOpen(false);
  }, [clearCloseTimer, clearOpenTimer]);

  const scheduleOpen = useCallback(() => {
    clearCloseTimer();
    clearOpenTimer();
    openTimerRef.current = setTimeout(() => {
      setOpen(true);
    }, HOVER_OPEN_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer]);

  const scheduleClose = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer]);

  // 卸载时清掉挂起的定时器，避免对已卸载组件 setState。
  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // enabled 变 false（例如切到非聊天页）时立刻收起已展开的弹层。
  useEffect(() => {
    if (!enabled) cancel();
  }, [cancel, enabled]);

  return {
    anchorRef,
    open: enabled && open,
    triggerHandlers: {
      onMouseEnter: scheduleOpen,
      onMouseLeave: scheduleClose,
      onFocus: scheduleOpen,
      onBlur: scheduleClose,
    },
    panelHandlers: {
      onMouseEnter: clearCloseTimer,
      onMouseLeave: scheduleClose,
    },
  };
}
