import { mountIslandApp } from './island/mount-island.js';

/**
 * 灵动岛窗口的入口脚本(由 `island.html` 加载)。
 *
 * 与主窗口入口 `main.tsx` 完全隔离:不引入全局工具样式与 Monaco 等重资源,
 * bundle 只包含 island 组件树 + island.css + 共享的 BrandLogo/类型。
 * Rust 侧 `create_island_window` 通过 `WebviewUrl::App("island.html")` 指到这里。
 */
mountIslandApp();
