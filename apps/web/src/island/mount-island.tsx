import { createRoot } from 'react-dom/client';
import { IslandApp } from './IslandApp.js';
import './island.css';

/**
 * 灵动岛窗口挂载入口。
 *
 * 主路径:由 `island-main.ts`(island.html 专属入口)直接调用;
 * 兜底路径:由 `main.tsx` 在「island WebView 落在 index.html」时分流动态导入。
 * 只有 island 窗口才支付这份组件与样式的加载成本;主窗口不受影响。
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

  kickRepaint();
}

/**
 * WebKitGTK 透明窗口的合成兜底。
 *
 * 桌面端 WebView(WebKitGTK)在透明窗口 + 样式表初次应用的组合下,偶发"整帧
 * 丢弃"(合成输出为空 → 浮窗完全透明);且之后若没有样式失效,WebView 不会
 * 重画,透明状态就持续下去。这里在首帧提交后再强制一次无害重绘,把丢帧
 * 窗口填掉。outline 用透明色且位于窗口外,不会产生任何可见像素。
 */
function kickRepaint(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.style.outline = '1px solid transparent';
      window.setTimeout(() => {
        document.body.style.outline = '';
      }, 50);
    });
  });
}
