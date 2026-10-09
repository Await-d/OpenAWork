import { createRoot } from 'react-dom/client';
import { IslandApp } from './IslandApp.js';
import './island.css';

/**
 * 灵动岛窗口挂载入口。
 *
 * 由 `apps/web/src/main.tsx` 在入口分流后**动态导入**,因此只有 island 窗口
 * 才支付这份组件与样式的加载成本;主窗口不受影响。
 */
export function mountIslandApp(): void {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element not found');
  }

  const html = document.documentElement;
  html.classList.add('island-html');
  // 灵动岛固定深色玻璃:浮在任意壁纸之上,浅色主题会丢失对比度。
  html.setAttribute('data-mode', 'dark');
  html.style.colorScheme = 'dark';
  document.body.classList.add('island-body');

  createRoot(rootElement).render(<IslandApp />);
}
