# apps/mobile — 知识库

## 概述

Expo Router（React Native）移动端应用。支持聊天、会话和设置功能。使用手动屏幕状态机替代 React Navigation 栈——这是有意为之的设计选择。

## 目录结构

```
app/                       # Expo Router 文件路由
└── chat/[sessionId].tsx   # 动态聊天路由
src/
├── navigation/
│   └── AppNavigator.tsx   # 手动屏幕状态机（非 React Navigation 栈）
├── screens/
│   ├── ChatScreen.tsx
│   ├── SessionsScreen.tsx
│   └── SettingsScreen.tsx
├── components/
│   └── NetworkBanner.tsx
├── store/
│   ├── auth.ts             # Zustand 认证存储（AsyncStorage 持久化）
│   └── providerPersistence.ts
├── db/
│   └── session-store.ts    # 本地 SQLite 会话存储
├── hooks/
│   ├── useGatewayClient.ts
│   ├── useNetworkState.ts
│   └── useOtaUpdate.ts
├── onboarding/
│   └── OnboardingWizard.tsx
├── monitoring/
│   └── sentry.ts
└── __tests__/
    ├── auth-store.test.ts
    ├── session-store.test.ts
    └── use-network-state.test.ts
```

## 查找指引

| 任务               | 位置                              |
| ------------------ | --------------------------------- |
| 屏幕导航           | `src/navigation/AppNavigator.tsx` |
| 认证（登录/Token） | `src/store/auth.ts`               |
| 网关 WS/SSE 客户端 | `src/hooks/useGatewayClient.ts`   |
| 本地会话存储       | `src/db/session-store.ts`         |
| OTA 更新           | `src/hooks/useOtaUpdate.ts`       |
| 网络状态           | `src/hooks/useNetworkState.ts`    |

## 架构说明

- **屏幕状态机**：`AppNavigator.tsx` 使用手动 `Screen` 可辨识联合类型（`loading | onboarding | sessions | chat | settings`）配合 `useState` 管理。并非 React Navigation——有意为之，以简化导航逻辑。
- **认证持久化**：通过 Zustand store 使用 `AsyncStorage`（而非 `localStorage`）。
- **引导流程**：挂载时通过 `AsyncStorage.getItem('onboarded')` 检查是否已完成引导。
- **入口点**：`expo-router/entry`（Expo Router 从 `app/` 目录处理路由）。

## 常用命令

```bash
pnpm --filter @openAwork/mobile dev     # Expo 开发服务器
pnpm --filter @openAwork/mobile build   # EAS 构建
pnpm --filter @openAwork/mobile test    # Vitest
```

## 禁止事项

- 禁止将 `AppNavigator.tsx` 状态机替换为 React Navigation——这是有意设计，请先充分理解。
- 禁止使用 `localStorage`——React Native 必须使用 `AsyncStorage`。
- 新增屏幕后必须在 `AppNavigator.tsx` 中注册。
