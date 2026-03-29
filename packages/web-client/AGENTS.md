# web-client — 知识库

## 概述

浏览器端网关客户端：WebSocket + SSE 流式通信、认证辅助函数和会话 API 客户端。被 `apps/web` 和 `apps/desktop` 共同使用。

## 目录结构

```
src/
├── index.ts           # 桶导出——所有公开 API 在此导出
├── gateway-ws.ts      # GatewayWebSocketClient — 通过 WS 实时流式 Agent 输出
├── gateway-sse.ts     # GatewaySSEClient — SSE 流式客户端
├── auth.ts            # login()、refreshAccessToken()、logout() — JWT Token 管理
└── sessions.ts        # createSessionsClient() — Agent 会话增删改查
```

## 公开 API

```ts
import {
  GatewayWebSocketClient, // WS 流式
  GatewaySSEClient, // SSE 流式
  login, // POST /auth/login → TokenPair
  refreshAccessToken, // POST /auth/refresh
  logout, // POST /auth/logout
  createSessionsClient, // 会话 CRUD 客户端
} from '@openAwork/web-client';
```

## 查找指引

| 任务                   | 位置                 |
| ---------------------- | -------------------- |
| WS 流式                | `src/gateway-ws.ts`  |
| SSE 流式               | `src/gateway-sse.ts` |
| 认证（登录/刷新/登出） | `src/auth.ts`        |
| 会话 CRUD              | `src/sessions.ts`    |

## 禁止事项

- 禁止在 Node.js/服务端上下文中使用此包——仅支持浏览器 API（`EventSource`、`WebSocket`）。
- 禁止将 Token 存储在非 Zustand 状态中——使用 `apps/web/src/stores/auth.ts`。
