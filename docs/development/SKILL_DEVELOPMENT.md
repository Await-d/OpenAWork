# OpenAWork Skill 开发指南

本指南将帮助你了解如何为 OpenAWork 开发、测试并发布一个 Skill。OpenAWork 的 Skill 系统基于 MCP (Model Context Protocol) 协议，允许开发者通过统一的框架扩展智能体的能力。

## 1. 概述

### 什么是 Skill？

Skill 是智能体能力的封装单元。一个 Skill 可以包含多个工具 (Tools)、资源 (Resources) 和提示词指引 (Prompts)。它可以通过封装远程 MCP Server 实现，也可以是纯本地实现的 TypeScript 代码。

### Skill vs Plugin

- **Skill**: 专注于原子化的工具调用 (tool_use)。由 LLM 根据任务需求自主触发。
- **Plugin**: 更高级的组合，包含多个 Skill、斜杠命令 (Slash Commands) 以及生命周期钩子 (Hooks)。

### 什么时候需要创建 Skill？

- 需要让智能体访问外部 API（如搜索、天气）。
- 需要让智能体操作本地文件系统或剪贴板。
- 需要为特定领域提供专业工具（如数据库查询、代码分析）。

## 2. 快速开始

在 10 分钟内创建一个简单的 "Hello World" Skill。

### 第一步：创建项目目录

```bash
mkdir my-hello-skill
cd my-hello-skill
```

### 第二步：初始化 Manifest

在根目录创建 `skill.yaml`：

```yaml
apiVersion: 'agent-skill/v1'
id: 'com.example.hello-skill'
name: 'hello-world'
displayName: 'Hello World Skill'
version: '1.0.0'
description: '一个简单的示例 Skill'
descriptionForModel: |
  当用户要求打招呼或需要示例工具时使用此 Skill。
author: 'Developer'
capabilities:
  - greeting
permissions:
  - type: clipboard
    scope: read
    required: false
```

### 第三步：本地预览与安装

使用 `opkg` 工具加载本地目录进行开发：

```bash
opkg install ./ --dev
```

安装完成后，在 OpenAWork 客户端的工具列表中即可看到 "Hello World Skill"。

## 3. Skill Manifest 规范

每个 Skill 的核心是一个 `skill.yaml` 文件。以下是各个字段的详细说明：

| 字段                  | 类型     | 说明                                            |
| --------------------- | -------- | ----------------------------------------------- |
| `apiVersion`          | string   | 规范版本，当前为 `agent-skill/v1`               |
| `id`                  | string   | 全局唯一 ID，推荐使用反向域名格式               |
| `name`                | string   | 模型可见名称，用于工具路由（建议小写短横线）    |
| `displayName`         | string   | 用户界面显示的名称                              |
| `version`             | string   | 符合 Semver 规范的版本号                        |
| `description`         | string   | 对用户的简短描述                                |
| `descriptionForModel` | string   | 注入 LLM 的调用指引，帮助模型理解何时调用此工具 |
| `capabilities`        | string[] | 能力标签，用于市场发现                          |
| `permissions`         | array    | 声明该 Skill 需要的各类权限                     |

### 示例配置

```yaml
# 注入上下文的参考文档
references:
  - path: ./docs/api-guide.md
    loadAt: activation

# 用户可配置项（将渲染为设置 UI）
configSchema:
  type: object
  properties:
    apiKey: { type: string, description: 'API Key for search' }
    safeSearch: { type: boolean, default: true }
```

## 4. 工具实现

Skill 的工具可以通过 MCP (Model Context Protocol) 实现。以下是使用 TypeScript 实现的一个简单 MCP 工具示例：

```typescript
import { Server } from '@modelcontextprotocol/sdk/server';

const server = new Server({
  name: 'my-hello-server',
  version: '1.0.0',
});

server.tool('greet', { name: { type: 'string' } }, async ({ name }) => {
  return {
    content: [{ type: 'text', text: `Hello, ${name}!` }],
  };
});

// 运行服务器
server.listen();
```

## 5. 权限声明

权限是 Skill 系统安全性的基石。每个 Skill 必须在 `skill.yaml` 中显式声明其需要的权限。安装时，系统会向用户展示权限列表并请求授权。授权状态支持运行时撤销。

### 常见权限类型列表

| 类型         | 范围示例                    | 说明                   |
| ------------ | --------------------------- | ---------------------- |
| `network`    | `https://api.example.com/*` | 限定特定域名的网络访问 |
| `filesystem` | `/path/to/project/*`        | 限定目录的文件读写权限 |
| `clipboard`  | `read` / `write`            | 对系统剪贴板的访问权限 |
| `env`        | `BRAVE_API_KEY`             | 获取指定环境变量的权限 |

### 示例权限配置

```yaml
permissions:
  - type: network
    scope: 'https://api.search.brave.com/*'
    required: true
  - type: env
    scope: BRAVE_API_KEY
    required: true
```

## 6. MCP Server 绑定

Skill 是对 MCP Server 的高阶封装。你可以在 `skill.yaml` 中绑定现有的远程或本地 MCP Server。

### 绑定远程 Server (SSE)

```yaml
mcp:
  transport: sse
  url: 'https://mcp.example.com/search'
```

### 绑定本地 Server (Stdio)

> 注意：Stdio 模式仅在桌面端可用。

```yaml
mcp:
  transport: stdio
  command: 'node'
  args: ['./dist/server.js']
```

## 7. 本地开发与热重载

使用 `opkg` CLI 管理你的 Skill 生命周期。推荐在本地开发时启用 `--dev` 模式。

### 常用命令列表

- **本地安装**：`opkg install ./my-skill`
- **开发模式**：`opkg install ./my-skill --dev` (自动监听 `skill.yaml` 变更)
- **查看列表**：`opkg list`
- **卸载 Skill**：`opkg remove com.example.my-skill`

## 8. 测试

在发布前，请务必进行以下测试：

### 1. 验证 Manifest 格式

```bash
opkg validate ./my-skill
```

该命令将检查 `skill.yaml` 是否符合最新规范，包括权限声明是否正确。

### 2. 测试工具执行

在 OpenAWork 客户端中手动触发工具，并观察控制台日志。确保：

- 输入参数校验符合 `inputSchema`。
- 异步操作处理正常，不发生超时。
- 错误处理返回了清晰的错误信息。

## 9. 发布到市场

当你准备好分享你的 Skill 时，可以将其发布到 OpenAWork 市场或私有注册中心。

### 1. 打包

```bash
opkg pack ./my-skill
```

这会生成一个 `.agentskill` 文件，包含所有必要资产。

### 2. 发布

```bash
opkg publish ./my-skill --target myteam
```

> 注意：发布到特定市场通常需要认证，请确保已通过 `opkg registry add` 配置了访问凭据。

## 10. 常见错误

在使用和开发 Skill 过程中，你可能会遇到以下常见问题：

1. **ID 冲突**：确保你的 `id` 是全局唯一的，推荐使用反向域名格式（如 `com.yourcompany.skillname`）。
2. **权限不足**：如果你收到权限错误，请检查 `skill.yaml` 是否正确声明了 `permissions` 列表，并确保在安装时用户已授权。
3. **Stdio 连接失败**：在桌面端使用 Stdio transport 时，确保 `command` 对应的程序在系统 PATH 中，且 `args` 中的路径是正确的。
4. **apiVersion 不匹配**：请确保 `apiVersion: 'agent-skill/v1'` 字段正确无误，过旧的版本可能无法在最新的 OpenAWork 客户端中运行。
5. **Manifest 校验失败**：运行 `opkg validate ./` 获取详细的格式错误说明，并参照官方字段规范进行修正。
