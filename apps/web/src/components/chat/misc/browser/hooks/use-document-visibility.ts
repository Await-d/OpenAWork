/**
 * 浏览器标签页 / 窗口的可见性（`document.visibilityState`）。
 *
 * 预览「不可见」其实有两层：
 * 1. 宿主把容器 `display: none`（切走工作区 tab / 收起面板）——宿主自己知道，靠
 *    `hidden` prop 表达；
 * 2. **整个标签页 / 窗口不可见**（切到别的标签、最小化）——宿主毫不知情，但网关
 *    照样推帧，客户端照样解码重绘，等于后台白烧一个核。
 *
 * 本 hook 把第 2 层变成 React 状态，供消费者与 `hidden` 一并决策。
 */

import { useEffect, useState } from 'react';

function isDocumentVisible(): boolean {
  // 非浏览器环境（无 visibilityState）按可见处理：只跳过「因为不可见而停流」这一种暂停。
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function useDocumentVisibility(): boolean {
  const [visible, setVisible] = useState(isDocumentVisible);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = (): void => setVisible(isDocumentVisible());
    document.addEventListener('visibilitychange', onChange);
    // 监听期间可能与初始值不一致（挂载后到监听前切换过），补一次读数。
    onChange();
    return () => {
      document.removeEventListener('visibilitychange', onChange);
    };
  }, []);

  return visible;
}
