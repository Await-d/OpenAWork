import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './styles/global.css';
import App from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

// 清理旧版遗留的 Service Worker 及其 precache 缓存。
// 之前构建复用了 web 端的 VitePWA 产物，SW 在 Tauri WebView 中跨版本持久化，
// 拦截导航请求返回旧 precache，造成"新版旧版来回跳"的问题。
// 注意：仅 unregister 不够——SW 创建的 CacheStorage 仍会残留，必须一并清除。
async function cleanupStaleServiceWorker(): Promise<void> {
  try {
    // 注销所有已注册的 Service Worker
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    // 清除 SW precache 及所有缓存（workbox-* / api-cache 等）
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // 静默处理：清理失败不应阻止应用启动
  }
}

// 阻塞渲染直到清理完成，确保 React 不会从旧缓存加载资源
void cleanupStaleServiceWorker().finally(() => {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
});
