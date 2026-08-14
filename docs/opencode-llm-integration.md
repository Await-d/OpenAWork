# OpenCode LLM 集成文档

## 概述

opencode-llm 包已成功集成到 OpenAWork 项目中，可在 agent-gateway 服务中使用。

## 安装

包已添加到 agent-gateway 的依赖中：

```json
{
  "dependencies": {
    "@openAwork/opencode-llm": "workspace:*"
  }
}
```

## 快速开始

### 1. 导入包

```typescript
import * as OpenCodeLLM from "@openAwork/opencode-llm"
```

### 2. 创建简单请求

```typescript
const message = new OpenCodeLLM.Message({
  role: "user",
  content: [
    {
      type: "text",
      text: "你好，请介绍一下自己。",
    }
  ],
})

const request = OpenCodeLLM.LLM.request({
  model: new OpenCodeLLM.Model({
    provider: "openai",
    model: "gpt-4",
  }),
  messages: [message],
})
```

### 3. 添加工具调用

```typescript
const weatherTool = new OpenCodeLLM.ToolDefinition({
  name: "get_weather",
  description: "获取指定城市的天气信息",
  inputSchema: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "城市名称",
      }
    },
    required: ["city"],
  },
})

const request = OpenCodeLLM.LLM.request({
  model: new OpenCodeLLM.Model({
    provider: "openai",
    model: "gpt-4",
  }),
  messages: [message],
  tools: [weatherTool],
})
```

## 支持的提供商

- **OpenAI**: `openai-chat` 协议
- **Anthropic**: `anthropic-messages` 协议
- **Google Gemini**: `gemini` 协议
- **AWS Bedrock**: `bedrock-converse` 协议
- **Azure OpenAI**: `openai-chat` 协议
- **OpenRouter**: 兼容 OpenAI 格式
- **Groq**: 兼容 OpenAI 格式

## 核心功能

### 流式响应处理

```typescript
async function* handleStreamEvents(events: AsyncIterable<OpenCodeLLM.LLMEvent>) {
  for await (const event of events) {
    switch (event.type) {
      case "text-delta":
        console.log("文本增量:", event.delta)
        yield { type: "text", content: event.delta }
        break

      case "tool-call-delta":
        console.log("工具调用:", event.name)
        break

      case "complete":
        console.log("完成原因:", event.finishReason)
        break
    }
  }
}
```

### 错误处理

```typescript
function handleLLMError(error: unknown) {
  if (OpenCodeLLM.isContextOverflow(error)) {
    return {
      type: "context_overflow",
      message: "消息长度超出模型限制",
    }
  }

  if (OpenCodeLLM.isContextOverflowFailure(error)) {
    return {
      type: "context_overflow_failure",
      message: "无法处理过长的上下文",
    }
  }

  // 其他错误
  return {
    type: "unknown_error",
    message: String(error),
  }
}
```

## 示例代码

完整示例代码位于：
- `services/agent-gateway/src/integrations/opencode-llm-example.ts`
- `services/agent-gateway/src/integrations/test-opencode-llm.ts`

运行示例：
```bash
cd services/agent-gateway
npx tsx src/integrations/test-opencode-llm.ts
```

## API 参考

### 核心类型

#### Message
消息对象，表示对话中的一条消息。

```typescript
new OpenCodeLLM.Message({
  role: "user" | "assistant" | "system",
  content: ContentPart[]
})
```

#### Model
模型配置。

```typescript
new OpenCodeLLM.Model({
  provider: string,
  model: string,
})
```

#### ToolDefinition
工具定义。

```typescript
new OpenCodeLLM.ToolDefinition({
  name: string,
  description: string,
  inputSchema: JsonSchema,
})
```

#### LLMRequest
完整的 LLM 请求。

```typescript
OpenCodeLLM.LLM.request({
  model: Model,
  messages: Message[],
  tools?: ToolDefinition[],
  generation?: GenerationOptions,
})
```

### 事件类型

- `text-delta`: 文本增量
- `text-start`: 文本开始
- `text-end`: 文本结束
- `tool-call-delta`: 工具调用增量
- `tool-input-start`: 工具输入开始
- `tool-input-end`: 工具输入结束
- `complete`: 请求完成
- `step-start`: 步骤开始
- `step-finish`: 步骤完成

## 与现有系统集成

### 与 AI SDK 集成

```typescript
interface OpenCodeLLMAdapter {
  model: OpenCodeLLM.Model
  createRequest: (messages: OpenCodeLLM.Message[]) => OpenCodeLLM.LLMRequest
  processResponse: (response: OpenCodeLLM.LLMResponse) => any
}

function createAdapter(provider: string, modelId: string): OpenCodeLLMAdapter {
  const model = new OpenCodeLLM.Model({
    provider,
    model: modelId,
  })

  return {
    model,
    createRequest(messages) {
      return OpenCodeLLM.LLM.request({
        model: this.model,
        messages,
      })
    },
    processResponse(response) {
      return {
        text: response.text,
        usage: response.usage,
        finishReason: response.finishReason,
      }
    },
  }
}
```

## 测试

### 单元测试

包级别测试：
```bash
cd packages/opencode-llm
pnpm test
```

### 集成测试

```bash
cd packages/opencode-llm
node examples/integration-test.mjs
```

### Agent Gateway 集成测试

```bash
cd services/agent-gateway
npx tsx src/integrations/test-opencode-llm.ts
```

## 下一步

1. **配置 API 密钥**: 在环境变量中配置各提供商的 API 密钥
2. **实现路由层**: 完成 HTTP 传输和路由配置
3. **添加缓存**: 实现请求/响应缓存策略
4. **监控和日志**: 集成遥测和日志系统
5. **性能优化**: 优化流式处理性能

## 技术栈

- **TypeScript**: 类型安全
- **Effect**: 函数式编程和错误处理
- **Schema**: 运行时类型验证

## 支持

如有问题，请查看：
- 包源码: `packages/opencode-llm/`
- 示例代码: `packages/opencode-llm/examples/`
- 集成示例: `services/agent-gateway/src/integrations/`
