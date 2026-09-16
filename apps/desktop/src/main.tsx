import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
// 仅 dev / Playwright e2e 入口：生产桌面端加载 apps/web/dist（样式自带完整
// 设计令牌），不执行本文件；dev 复用 web 组件时补上令牌 / 主题 / 动画表，
// global.css 保持在最后。
import '../../web/src/styles/layout-tokens.css';
import '../../web/src/index.css';
import '../../web/src/styles/loaders.css';
import '../../web/src/styles/ui-hovers.css';
import './styles/global.css';
import App from './App.js';

// 注意：生产桌面端 frontendDist 指向 apps/web/dist，本文件仅 dev/独立桌面
// 前端入口使用。PWA/Service Worker 清理逻辑在 apps/web/src/main.tsx。
const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
