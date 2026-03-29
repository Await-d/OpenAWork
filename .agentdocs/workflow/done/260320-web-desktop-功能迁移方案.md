# .agentdocs/workflow/260320-web-desktop-功能迁移方案.md

## 概述

基于 2026-03-20 对 `apps/web` 与 `apps/desktop` 的代码对比分析，整理两端功能差异与迁移建议。

> 状态说明：🟡 待开始 | 🔵 进行中 | ✅ 完成 | — 不迁移

---

## Part 1：Desktop → Web 需补齐（6项）

### 高优先级

- [x] DW-01 ✅：apps/web/src/components/OnboardingModal.tsx 新建，App.tsx 集成首次访问检测
- [x] DW-02 ✅：apps/web/src/utils/session-transfer.ts 导出/导入，SessionsPage 按钮集成
- [x] DW-03 ✅：apps/web/src/stores/auth.ts 补充 refreshToken + 自动续期
- [x] DW-04 ✅：apps/web/src 所有 fetch 改为 ${gatewayUrl}/... 前缀

### 中优先级

- [x] DW-05 ✅：Web 端已有 `ToastContainer` + `toast()` 全局函数（`components/ToastNotification.tsx`），App.tsx 已挂载
- [x] DW-06 ✅：Web 端已有 `UpdateBanner`（`components/UpdateBanner.tsx`）— service worker 新版检测 + 版本号展示，App.tsx 已挂载

---

### 已完成（高优先级）

- [x] WD-01 ✅：apps/desktop/src/pages/ArtifactsPage.tsx 新建，App.tsx 注册 /artifacts 路由
- [x] WD-02 ✅：apps/desktop/src/pages/SettingsPage.tsx 补充 MCP Servers + 模型选择
- [x] DA-01 ✅：apps/desktop/src/App.tsx 挂载 /onboarding + OnboardingWizard + 首次启动检测
- [x] DA-03 ✅：apps/desktop/src/App.tsx 添加 NotificationListener（listen notification-action → navigate）
- [x] WD-03 ✅：apps/desktop/src/hooks/useGatewayClient.ts 补充 SSE fallback
- [x] WD-04 ✅：apps/desktop/src/pages/SessionsPage.tsx 真实页面，/sessions 路由已挂载

---

## Part 2：Web → Desktop 需补齐（4项）

### 高优先级

- [x] WD-01 ✅：Desktop `ArtifactsPage.tsx` 已存在，`App.tsx` 已注册 `/artifacts` 路由
- [x] WD-02 ✅：Desktop `SettingsPage.tsx` 已有 MCP Servers 管理 + 模型选择 UI（含 `saveProviderConfig` 持久化）

### 中优先级

- [x] WD-03 ✅：Desktop `useGatewayClient.ts` 已有 WebSocket + SSE fallback（ws.onerror → trySSE()）
- [x] WD-04 ✅：Desktop `SessionsPage.tsx` 已是真实实现（fetch sessions + createSession + navigate）

---

## Part 3：两端「实现但未接入 UI」的 Desktop 功能

> 这些功能代码已存在，但在 desktop 端没有路由/UI 入口，需确认是否激活。

- [x] DA-01 ✅：`App.tsx` 已挂载 OnboardingWizard（首次启动检测 + `onboarded` state）
- [x] DA-02 ✅：`SettingsPage.tsx` 已引用 `UpdateProgressDialog`（Check for Updates 按钮）
- [x] DA-03 ✅：`App.tsx` 已有 `NotificationListener`（`listen('notification-action')` → navigate）
- [x] DA-04 ✅：新建 `store/secure-storage.ts`（AES-GCM 加密）；`SettingsPage.tsx` 接入 `loadProviderConfig`/`saveProviderConfig`

---

## Part 4：不建议迁移（有原因）

| 功能 | 原因 |
|---|---|
| SSH 直连（useSSHConnection） | 浏览器无法直接 TCP SSH，Web 应通过 Gateway 作为代理，不直接迁前端 |
| secure-storage 的 Tauri store 实现 | Web 无此 API，应改用 httpOnly cookie 或 WebCrypto+IndexedDB，属于认证架构调整而非代码迁移 |
| data-tauri-drag-region | 仅 Tauri 桌面端有意义，Web 无需 |

---

## 里程碑

- M1（高优先级）：DW-01~04 + WD-01~02 完成，两端功能基本对齐
- M2（中优先级）：DW-05~06 + WD-03~04 完成，体验进一步对齐
- M3（接入激活）：DA-01~04 desktop 端接入 UI 入口

---

## 备注

- 迁移建议优先复用 `packages/shared-ui` 中已有组件（PairingPanel/QRCodeDisplay 等）
- DW-04（API 请求统一化）需要修改 web hooks/pages 中的 fetch 调用，可能影响面较广，建议单独做一轮回归测试
- DA-04（secure-storage 接入）需要先确定密钥管理策略再动代码
