# apps/desktop — 知识库

## 概述

Tauri v2 桌面端封装。通过相对 TS 导入直接复用 Web 页面（非构建产物依赖）。将网关作为捆绑的 Sidecar 进程运行——该二进制由 `bun build --compile` 产出，文件名为 `openawork-gateway`。

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
│   └── bundle-sidecar.mjs    # 编译网关并暂存为 binaries/openawork-gateway-<triple>
├── binaries/                 # 自动生成——禁止提交。sidecar 产物与 .bundle-stamp
├── tauri.conf.json           # 打包配置、Sidecar 资源
└── icons/
e2e/                          # Playwright 桌面端 E2E 测试
```

## 查找指引

| 任务               | 位置                                           |
| ------------------ | ---------------------------------------------- |
| Tauri 命令（Rust） | `src-tauri/src/lib.rs`                         |
| 桌面布局           | `src/components/layout/`                       |
| Sidecar 打包脚本   | `src-tauri/scripts/bundle-sidecar.mjs`         |
| Tauri 配置         | `src-tauri/tauri.conf.json`                    |
| 自动更新           | `src/updater/auto-update.ts`                   |
| 通知管理           | `src/notification/notification-manager.ts`     |
| 复用的 Web 页面    | `../../web/src/pages/`（直接相对导入）         |
| 复用的认证状态     | `../../web/src/stores/auth.ts`（直接相对导入） |

## 架构说明

- **直接导入 Web 代码**：`App.tsx` 从 `../../web/src/pages/` 导入 `ChatPage`、`SessionsPage` 等，从 `../../web/src/stores/auth.ts` 导入 `useAuthStore`——非 npm 包依赖，而是直接 TS 相对导入。
- **Sidecar 流程**：`bun run --filter @openAwork/agent-gateway build:binary`（产出 `dist/openawork-gateway`）→ `bundle-sidecar.mjs` 复制并加目标三元组后缀（Linux 额外 gzip + wrapper）→ Tauri 打包为资源 → `lib.rs` 以 sidecar 名 `openawork-gateway` 生成子进程。改名时必须同步 `tauri.conf.json`、`capabilities/default.json`、`tauri.linux.conf.json`、`src/lib.rs` 与发布工作流。
- **Sidecar 的 Windows 资源**：在 Windows 主机上编译 sidecar 时，打包脚本会注入 `--windows-icon/--windows-title/--windows-description/--windows-publisher/--windows-version`（图标取 `src-tauri/icons/icon.ico`，描述固定 `OpenAWork Gateway`）。不注入时 exe 沿用 Bun 运行时的图标与「Bun」描述，任务管理器里会显示成陌生进程。这些参数只在 Windows 主机生效，非 Windows 主机交叉编译 Windows 目标时降级为警告；单独执行 `bun run build:binary` 的裸产物同样不含这些资源，正式产物只由 `bundle-sidecar.mjs` 生成。
- **桌面认证**：使用 `OnboardingWizard` 配置网关 URL 和凭据，而非 `LoginPage`。
- **通知**：Tauri 事件（`notification-action`）通过 `NotificationListener` 组件触发导航。
- **`useHasHydrated()`**：与 Web 端相同模式（有意保留——桌面和 Web 均需 Zustand persist 水合守卫）。

## 发布构建顺序

```bash
# 1. 编译网关二进制（dist/openawork-gateway）
bun run --filter @openAwork/agent-gateway build:binary

# 2. 暂存 Sidecar（binaries/openawork-gateway-<triple>）
node apps/desktop/src-tauri/scripts/bundle-sidecar.mjs

# 3. 构建桌面端
bun run --filter @openAwork/desktop build
```

## 禁止事项

- 禁止编辑 `src-tauri/binaries/` 下的产物——由脚本自动生成。
- 禁止删除 `main.rs:1` 中的 `// Prevents additional console window on Windows in release, DO NOT REMOVE!!`。
- 禁止使用 `bun run build`（仅 tsc）生成 Sidecar 二进制——必须使用 `build:binary`（bun compile）。
- 新增桌面页面前，先确认是否可通过相对导入复用 Web 版本。
