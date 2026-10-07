import { useCallback, useMemo, useState } from 'react';
import { toast } from '../../common/feedback/ToastNotification.js';
import { canOpenPathInSystem, openPathInSystem } from '../../../utils/tauri/open-in-system.js';
import { isTauriRuntime, readDesktopGatewayMode } from '../../../utils/gateway/desktop-gateway.js';

export interface OpenPathInSystem {
  /** 桌面端 + 本机网关才为 true；纯 Web、移动端、远程网关下均为 false。 */
  canOpen: boolean;
  /**
   * 不可用原因（可用时为空串）。菜单用它做禁用项的 hover 提示——入口始终
   * 可见，用户能看出「为什么点不动」，而不是以为功能缺失。
   */
  unavailableReason: string;
  /** 打开本地路径；失败时以 toast 提示，不向调用方抛错。 */
  openInSystem: (path: string) => void;
}

/**
 * 「在系统中打开」的宿主侧接线：能力探测 + 禁用原因 + 统一错误提示。
 *
 * 能力在页面生命周期内不会变（取决于运行时与网关模式），所以只探测一次；
 * 真正打开时才做路径校验，交给 `openPathInSystem`。
 *
 * 三个文件树宿主（工作区面板 / 团队侧栏）与工作区分组菜单各自渲染独立菜单，
 * 没有共同父级，统一在这里复用避免多份重复。
 */
export function useOpenPathInSystem(): OpenPathInSystem {
  const [canOpen] = useState(canOpenPathInSystem);

  // 两种不可用场景对用户的含义不同：浏览器里是「本机没有这个客户端能力」，
  // 远程网关下是「文件在服务器上，本机打不开」。
  const unavailableReason = useMemo(() => {
    if (canOpen) {
      return '';
    }
    if (!isTauriRuntime()) {
      return '当前环境不支持：仅桌面客户端可以把文件交给系统打开';
    }
    if (readDesktopGatewayMode() === 'remote') {
      return '当前连接的是远程网关：文件位于服务器，无法在本机打开';
    }
    return '当前环境不支持在系统中打开';
  }, [canOpen]);

  const openInSystem = useCallback((path: string) => {
    void openPathInSystem(path).catch((error: unknown) => {
      toast(error instanceof Error ? error.message : '用系统默认程序打开失败', 'error');
    });
  }, []);

  return { canOpen, unavailableReason, openInSystem };
}
