# Claude API 工具概览

> 本文档整理了 Anthropic 官方提供的各类 Claude SDK 及其开源状态，便于快速查阅和选型。

---

## 1. Anthropic Python SDK

| 项目 | 说明 |
|------|------|
| **PyPI 包名** | `anthropic` |
| **GitHub** | [anthropics/anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python) |
| **License** | MIT |
| **是否开源** | ✅ 是 |

### 快速上手

```bash
pip install anthropic
```

```python
import anthropic

client = anthropic.Anthropic(api_key="sk-ant-...")

message = client.messages.create(
    model="claude-sonnet-5-20250514",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Hello, Claude!"}
    ]
)
print(message.content[0].text)
```

### 特点

- 同步 & 异步（`AsyncAnthropic`）双模式支持
- 自动重试、流式响应、工具调用（Tool Use）等完整功能
- 支持 Messages API、Batch API、Files API 等全部端点

---

## 2. Anthropic TypeScript / Node.js SDK

| 项目 | 说明 |
|------|------|
| **npm 包名** | `@anthropic-ai/sdk` |
| **GitHub** | [anthropics/anthropic-sdk-typescript](https://github.com/anthropics/anthropic-sdk-typescript) |
| **License** | MIT |
| **是否开源** | ✅ 是 |

### 快速上手

```bash
npm install @anthropic-ai/sdk
```

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const message = await client.messages.create({
  model: 'claude-sonnet-5-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello, Claude!' }],
});

console.log(message.content[0].text);
```

### 特点

- TypeScript 原生，完整类型定义
- 支持 Node.js & Bun 运行时
- 流式响应、工具调用、Vision 等全功能

---

## 3. Claude Code（CLI & SDK）

| 项目 | 说明 |
|------|------|
| **npm 包名** | `@anthropic-ai/claude-code` |
| **GitHub** | [anthropics/claude-code](https://github.com/anthropics/claude-code) |
| **License** | Apache 2.0 |
| **是否开源** | ✅ 是 |

### 安装

```bash
npm install -g @anthropic-ai/claude-code
```

### 两种使用方式

#### CLI 模式（交互式终端）

```bash
claude   # 启动交互式会话
```

#### SDK 模式（编程调用）

```typescript
import { query, type SDKMessage } from "@anthropic-ai/claude-code";

const response = await query({
  prompt: "Write a hello world program in Python",
  options: {
    maxTurns: 3,
  },
});
console.log(response);
```

### 特点

- 将 Claude Code 作为子代理（subagent）嵌入到应用中
- 内置文件读写、搜索、终端执行等工具
- 支持 MCP（Model Context Protocol）扩展
- 支持自定义系统提示、权限控制、会话管理

---

## 4. 开源状态总结

| SDK | 是否开源 | License | 模型是否开源 |
|-----|---------|---------|-------------|
| Python SDK (`anthropic`) | ✅ 开源 | MIT | ❌ 闭源（仅 API 访问） |
| TypeScript SDK (`@anthropic-ai/sdk`) | ✅ 开源 | MIT | ❌ 闭源（仅 API 访问） |
| Claude Code (`@anthropic-ai/claude-code`) | ✅ 开源 | Apache 2.0 | ❌ 闭源（仅 API 访问） |

> **关键区分**：SDK / 客户端工具是开源的，Claude 模型本身是闭源的，只能通过 Anthropic API 或 claude.ai 使用。

---

## 5. 相关资源

| 资源 | 链接 |
|------|------|
| Anthropic 官方文档 | [docs.anthropic.com](https://docs.anthropic.com) |
| API Key 管理 | [console.anthropic.com](https://console.anthropic.com) |
| Claude Code 文档 | [docs.anthropic.com/en/docs/claude-code](https://docs.anthropic.com/en/docs/claude-code) |
| MCP 协议规范 | [modelcontextprotocol.io](https://modelcontextprotocol.io) |

---

## 6. 在 OpenAWork 项目中的应用

本项目（OpenAWork）已集成 Claude Code SDK 作为 AI 代理网关的核心组件：

- **位置**：`temp/claude-code/` 目录下包含 Claude Code 运行时
- **网关集成**：通过 `apps/desktop/src-tauri/sidecars/agent-gateway/` 将 Claude Code 作为 sidecar 运行
- **扩展方式**：通过 MCP 服务器扩展工具能力（参考 `docs/chat/omo-mcp-adapter-architecture.md`）

---

*最后更新：2026-07-26*
