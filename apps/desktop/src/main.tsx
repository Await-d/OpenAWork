import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './styles/global.css';
import App from './App.js';

// 清理旧版遗留的 Service Worker（桌面端不需要 PWA 离线缓存）。
// 之前构建复用了 web 端的 VitePWA 产物，导致 SW 在 Tauri WebView 中跨版本持久化，
// 拦截导航请求返回旧 precache，造成"新版旧版来回跳"的问题。
// 此处作为安全网，确保即使有残留 SW 也会被立即注销。
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) {
      void r.unregister();
    }
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
