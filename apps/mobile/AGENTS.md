# apps/mobile — 知识库

## 概述

Expo Router（React Native）移动端应用。支持聊天、会话和设置功能。路由事实标准是 **Expo Router 的 `app/` 目录文件路由**：根布局 `app/_layout.tsx` 用 `<Stack>` 承载屏幕，各路由在 `<Stack.Screen>` 中登记。不引入 React Navigation。

## 目录结构

```
app/                       # Expo Router 文件路由（导航的唯一来源）
├── _layout.tsx            # 根布局：<Stack>/<Stack.Screen> 登记路由 + 引导检查 + 认证守卫 + BottomNav
├── index.tsx              # 入口 Redirect（无 token → /connection，否则 → /home）
├── home.tsx               # 底部导航根页
├── sessions.tsx / sessions/new.tsx
├── settings.tsx / settings/{mcp,[section]}.tsx
├── chat/[sessionId].tsx   # 动态聊天路由，渲染 src/screens/ChatScreen
├── onboarding.tsx / onboarding/{gateway,client}.tsx
├── channel/{[channelId],diagnostics}.tsx
└── …                      # 其它工具页：artifacts / image-workspace / network / panel-center / channels 等
src/
├── screens/               # 页面级组件：ChatScreen / SessionsScreen / SettingsScreen + 纯逻辑与流处理器
├── components/            # 移动端 UI 组件
│   ├── ui/                # 原子组件（Button / Chip / Card / ListRow / PageHeader …，经 index.ts 统一导出）
│   ├── image-viewer/      # 图片查看器子域（lightbox 纯逻辑 + 测试）
│   └── *.tsx              # 聊天/会话/导航等业务组件（BottomNav / NetworkBanner / 消息动作 …）
├── hooks/                 # useGatewayClient / useNetworkState / useOtaUpdate / 图片缓存等
├── store/                 # Zustand 认证与 Provider 持久化（AsyncStorage）
├── db/                    # expo-sqlite 本地会话存储
├── chat/                  # 聊天纯逻辑（消息内容渲染、路由历史状态）
├── layout/                # 键盘高度 / 尺寸 token / 底部导航 inset 计算
├── theme/                 # colors / spacing / radii / typography token
├── onboarding/            # OnboardingWizard
├── monitoring/            # Sentry 初始化
├── navigation/            # 遗留：AppNavigator.tsx（当前无引用，见文末「已知文档漂移与遗留」）
├── utils/                 # 工具（artifact-platform-adapter.ts 当前无引用，见文末）
└── __tests__/             # 跨模块测试（gateway-client / chat-message-actions）
```

测试文件共 12 个，除 `src/__tests__/` 下 2 个外均与源码就近放置（`hooks/`、`components/image-viewer/`、`screens/`、`screens/chat-screen/`、`chat/`、`layout/`、`store/`）。

## 查找指引

| 任务               | 位置                                              |
| ------------------ | ------------------------------------------------- |
| 屏幕导航 / 路由    | `app/_layout.tsx`（`<Stack>` + `<Stack.Screen>`） |
| 认证（登录/Token） | `src/store/auth.ts`                               |
| 网关 WS/SSE 客户端 | `src/hooks/useGatewayClient.ts`                   |
| 本地会话存储       | `src/db/session-store.ts`                         |
| OTA 更新           | `src/hooks/useOtaUpdate.ts`                       |
| 网络状态           | `src/hooks/useNetworkState.ts`                    |

## 架构说明

- **路由（Expo Router）**：导航由 `app/` 目录的文件路由驱动，`app/_layout.tsx` 用 `<Stack>` 承载并显式列出 `<Stack.Screen>`。`app/index.tsx` 是入口 `Redirect`（无 token → `/connection`，否则 → `/home`）；聊天页 `app/chat/[sessionId].tsx` 读取 `sessionId` 后渲染 `src/screens/ChatScreen`。根布局同时负责引导检查、全局认证守卫与 `BottomNav`。不引入 React Navigation。
- **认证持久化**：通过 Zustand store 使用 `AsyncStorage`（而非 `localStorage`）。
- **引导流程**：`app/_layout.tsx` 挂载时通过 `AsyncStorage.getItem('onboarded')` 检查，未完成则 `router.replace('/connection')`。
- **入口点**：`expo-router/entry`（Expo Router 从 `app/` 目录处理路由）。

## 常用命令

```bash
bun run --filter @openAwork/mobile dev     # Expo 开发服务器
bun run --filter @openAwork/mobile build   # EAS 构建
bun run --filter @openAwork/mobile test    # Vitest
```

## 禁止事项

- 禁止引入 React Navigation 或其他第三方导航栈：移动端路由事实标准是 Expo Router 的 `app/` 文件路由，请勿另起一套导航。
- 禁止使用 `localStorage`：React Native 必须使用 `AsyncStorage`。
- 新增屏幕必须在 `app/` 目录下新增路由文件，并在 `app/_layout.tsx` 的 `<Stack.Screen>` 中登记；`app/` 文件路由是唯一导航来源，不要再依赖 `src/navigation/AppNavigator.tsx`（当前无引用）。

## 已知文档漂移与遗留

本节记录 2026-09-21 对 `apps/mobile` 的实测校准，及后续开发需注意的现状事实。

- **导航漂移已更正**：旧版文档称「使用手动屏幕状态机替代 React Navigation」并指向 `src/navigation/AppNavigator.tsx`。实测活路由是 Expo Router：`app/_layout.tsx` 的 `<Stack>` + `app/` 文件路由；`app/index.tsx` 为 `Redirect`，聊天页为 `app/chat/[sessionId].tsx`。`AppNavigator.tsx` 已无任何引用，相关描述与约束一并改写。
- **孤儿（遗留）文件**：以下文件当前无任何文件 import，保留但不参与运行。如需复用，须先确认接线（谁调用、如何挂到 Expo Router），不要假设它们已生效：
  - `src/navigation/AppNavigator.tsx`
  - `src/utils/artifact-platform-adapter.ts`
- **测试现状**：共 12 个测试文件，与源码就近放置，`src/__tests__/` 下另有 2 个。移动端**无 `babel.config.js`**（仅自定义 `metro.config.js`），**无 `@testing-library/react-native` / `react-test-renderer`**；`test` 脚本为 `vitest run --passWithNoTests`。即当前测试只覆盖 Vitest 纯逻辑，没有渲染级 / 组件级测试。
