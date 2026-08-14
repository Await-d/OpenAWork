/**
 * OpenCode LLM 集成示例
 *
 * 展示如何在 agent-gateway 中使用 opencode-llm 包
 */

import { Effect, Stream } from "effect"
import * as OpenCodeLLM from "@openAwork/opencode-llm"

/**
 * 示例 1: 创建一个简单的 LLM 请求
 */
export function createSimpleRequest() {
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

  return request
}

/**
 * 示例 2: 创建带工具的请求
 */
export function createRequestWithTools() {
  const weatherTool = new OpenCodeLLM.ToolDefinition({
    name: "get_weather",
    description: "获取指定城市的天气信息",
    inputSchema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "城市名称，如：北京、上海",
        },
        unit: {
          type: "string",
          enum: ["celsius", "fahrenheit"],
          description: "温度单位",
        }
      },
      required: ["city"],
    },
  })

  const message = new OpenCodeLLM.Message({
    role: "user",
    content: [
      {
        type: "text",
        text: "北京今天天气怎么样？",
      }
    ],
  })

  const request = OpenCodeLLM.LLM.request({
    model: new OpenCodeLLM.Model({
      provider: "openai",
      model: "gpt-4",
    }),
    messages: [message],
    tools: [weatherTool],
  })

  return request
}

/**
 * 示例 3: 使用 LLMClient 发送请求（需要配置 API 密钥）
 */
export async function sendRequestWithClient(apiKey: string) {
  // 创建 LLM 客户端
  const client = OpenCodeLLM.LLMClient

  // 创建请求
  const request = createSimpleRequest()

  // 配置认证
  const auth = OpenCodeLLM.Auth.apiKey(apiKey)

  // 发送请求并处理流式响应
  const program = Effect.gen(function* () {
    // 这里是 Effect 风格的流式处理
    // 在实际使用中，你需要配置完整的路由和传输层

    yield* Effect.log("发送 LLM 请求...")

    // 返回请求对象供后续处理
    return request
  })

  return Effect.runPromise(program)
}

/**
 * 示例 4: 处理流式响应事件
 */
export async function* handleStreamEvents(events: AsyncIterable<OpenCodeLLM.LLMEvent>) {
  for await (const event of events) {
    switch (event.type) {
      case "text-delta":
        // 处理文本增量
        console.log("文本增量:", event.delta)
        yield { type: "text", content: event.delta }
        break

      case "tool-call-delta":
        // 处理工具调用
        console.log("工具调用:", event.name)
        break

      case "complete":
        // 请求完成
        console.log("完成原因:", event.finishReason)
        yield { type: "complete", reason: event.finishReason }
        break

      default:
        // 其他事件类型
        console.log("事件:", event.type)
    }
  }
}

/**
 * 示例 5: 与现有 AI SDK 集成
 *
 * 展示如何将 opencode-llm 与 agent-gateway 现有的 AI SDK 集成
 */
export interface OpenCodeLLMAdapter {
  model: OpenCodeLLM.Model
  createRequest: (messages: OpenCodeLLM.Message[]) => OpenCodeLLM.LLMRequest
  processResponse: (response: OpenCodeLLM.LLMResponse) => any
}

export function createAdapter(provider: string, modelId: string): OpenCodeLLMAdapter {
  const model = new OpenCodeLLM.Model({
    provider,
    model: modelId,
  })

  return {
    model,

    createRequest(messages: OpenCodeLLM.Message[]) {
      return OpenCodeLLM.LLM.request({
        model: this.model,
        messages,
      })
    },

    processResponse(response: OpenCodeLLM.LLMResponse) {
      // 将 OpenCode LLM 响应转换为 agent-gateway 格式
      return {
        text: response.text,
        usage: response.usage,
        finishReason: response.finishReason,
      }
    },
  }
}

/**
 * 示例 6: 错误处理
 */
export function handleLLMError(error: unknown) {
  if (OpenCodeLLM.isContextOverflow(error)) {
    console.error("上下文溢出错误:", error)
    return {
      type: "context_overflow",
      message: "消息长度超出模型限制",
    }
  }

  if (OpenCodeLLM.isContextOverflowFailure(error)) {
    console.error("上下文溢出失败:", error)
    return {
      type: "context_overflow_failure",
      message: "无法处理过长的上下文",
    }
  }

  // 其他错误
  console.error("LLM 错误:", error)
  return {
    type: "unknown_error",
    message: String(error),
  }
}

/**
 * 使用示例
 */
export async function exampleUsage() {
  console.log("=== OpenCode LLM 集成示例 ===\n")

  // 1. 创建简单请求
  console.log("1. 创建简单请求")
  const simpleRequest = createSimpleRequest()
  console.log("  - 消息数:", simpleRequest.messages.length)
  console.log("  - 模型:", simpleRequest.model.model)

  // 2. 创建带工具的请求
  console.log("\n2. 创建带工具的请求")
  const toolRequest = createRequestWithTools()
  console.log("  - 工具数:", toolRequest.tools?.length || 0)

  // 3. 创建适配器
  console.log("\n3. 创建 OpenAI 适配器")
  const adapter = createAdapter("openai", "gpt-4")
  console.log("  - 提供商:", adapter.model.provider)
  console.log("  - 模型:", adapter.model.model)

  console.log("\n✅ 所有示例创建成功")
  console.log("\n下一步: 配置 API 密钥并发送实际请求")
}
