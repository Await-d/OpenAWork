# apps/desktop — 知识库

## 概述

Tauri v2 桌面端封装。通过相对 TS 导入直接复用 Web 页面（非构建产物依赖）。将 `agent-gateway` 作为捆绑的 Node Sidecar 进程运行。

## 目录结构

```
src/                          # React/TS 前端（Tauri WebView）
├── App.tsx                   # 路由（Web 页面子集）+ NotificationListener
├── main.tsx                  # Vite 入口
├── styles/global.css
├── components/layout/
│   ├── Layout.tsx            # 桌面专属布局（NavRail + TitleBar）
│   ├── NavRail.tsx
│   ├── SessionListPanel.tsx
│   └── TitleBar.tsx          # 自定义标题栏（无边框窗口）
├── onboarding/OnboardingWizard.tsx   # 桌面引导（网关 URL 配置）
├── notification/notification-manager.ts
└── updater/
    ├── auto-update.ts
    ├── UpdateErrorDialog.tsx
    └── UpdateProgressDialog.tsx
src-tauri/                    # Rust + Tauri 配置
├── src/
│   ├── main.rs               # 入口——禁止删除控制台窗口抑制注释
│   └── lib.rs                # Tauri 初始化、Sidecar 启动、命令注册
├── capabilities/             # Tauri 权限能力配置
├── scripts/
│   └── bundle-sidecar.sh     # 将 services/agent-gateway 构建产物复制到 sidecars/
├── sidecars/agent-gateway/   # 自动生成——禁止提交。由 bundle-sidecar.sh 生成
├── tauri.conf.json           # 打包配置、Sidecar 资源
└── icons/
e2e/                          # Playwright 桌面端 E2E 测试
```

## 查找指引

| 任务               | 位置                                           |
| ------------------ | ---------------------------------------------- |
| Tauri 命令（Rust） | `src-tauri/src/lib.rs`                         |
| 桌面布局           | `src/components/layout/`                       |
| Sidecar 打包脚本   | `src-tauri/scripts/bundle-sidecar.sh`          |
| Tauri 配置         | `src-tauri/tauri.conf.json`                    |
| 自动更新           | `src/updater/auto-update.ts`                   |
| 通知管理           | `src/notification/notification-manager.ts`     |
| 复用的 Web 页面    | `../../web/src/pages/`（直接相对导入）         |
| 复用的认证状态     | `../../web/src/stores/auth.ts`（直接相对导入） |

## 架构说明

- **直接导入 Web 代码**：`App.tsx` 从 `../../web/src/pages/` 导入 `ChatPage`、`SessionsPage` 等，从 `../../web/src/stores/auth.ts` 导入 `useAuthStore`——非 npm 包依赖，而是直接 TS 相对导入。
- **Sidecar 流程**：`pnpm build:binary`（agent-gateway）→ `bundle-sidecar.sh` 复制二进制 → Tauri 打包为资源 → `lib.rs` 在应用启动时生成子进程。
- **桌面认证**：使用 `OnboardingWizard` 配置网关 URL 和凭据，而非 `LoginPage`。
- **通知**：Tauri 事件（`notification-action`）通过 `NotificationListener` 组件触发导航。
- **`useHasHydrated()`**：与 Web 端相同模式（有意保留——桌面和 Web 均需 Zustand persist 水合守卫）。

## 发布构建顺序

```bash
# 1. 编译 agent-gateway 二进制
pnpm --filter @openAwork/agent-gateway build:binary

# 2. 暂存 Sidecar
bash apps/desktop/src-tauri/scripts/bundle-sidecar.sh

# 3. 构建桌面端
pnpm --filter @openAwork/desktop build
```

## 禁止事项

- 禁止编辑 `src-tauri/sidecars/` 下的文件——由脚本自动生成。
- 禁止删除 `main.rs:1` 中的 `// Prevents additional console window on Windows in release, DO NOT REMOVE!!`。
- 禁止使用 `pnpm build`（仅 tsc）生成 Sidecar 二进制——必须使用 `build:binary`（bun compile）。
- 新增桌面页面前，先确认是否可通过相对导入复用 Web 版本。
