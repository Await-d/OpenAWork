import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
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
