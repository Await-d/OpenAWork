/**
 * OpenCode LLM 基本使用示例
 *
 * 这个示例展示如何使用 opencode-llm 包与 LLM 提供商交互
 */

import { Effect } from "effect"
import { LLMClient, Provider, LLM } from "../src/index.js"

// 示例 1: 创建一个简单的 LLM 请求
async function exampleSimpleRequest() {
  console.log("=== 示例 1: 简单 LLM 请求 ===\n")

  // 创建一个 LLM 请求
  const request = new LLM.LLMRequest({
    messages: [
      new LLM.Message({
        role: "user",
        content: [
          new LLM.TextPart({
            type: "text",
            text: "Hello, how are you?",
          }),
        ],
      }),
    ],
  })

  console.log("请求创建成功:")
  console.log("- 消息数量:", request.messages.length)
  console.log("- 第一条消息角色:", request.messages[0]?.role)
  console.log("- 第一条消息内容:", request.messages[0]?.content[0])
}

// 示例 2: 使用工具定义
async function exampleWithTools() {
  console.log("\n=== 示例 2: 带工具的 LLM 请求 ===\n")

  // 定义一个简单的工具
  const weatherTool = new LLM.ToolDefinition({
    name: "get_weather",
    description: "获取指定城市的天气信息",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "城市名称",
        },
      },
      required: ["city"],
    },
  })

  console.log("工具定义创建成功:")
  console.log("- 工具名称:", weatherTool.name)
  console.log("- 工具描述:", weatherTool.description)
}

// 示例 3: 创建流式响应事件
async function exampleStreamEvents() {
  console.log("\n=== 示例 3: 流式响应事件 ===\n")

  // 创建文本增量事件
  const textDelta = new LLM.LLMEvent({
    type: "text-delta",
    index: 0,
    delta: "Hello, ",
  })

  console.log("文本增量事件:")
  console.log("- 类型:", textDelta.type)
  console.log("- 索引:", textDelta.index)
  console.log("- 增量:", textDelta.delta)

  // 创建完成事件
  const complete = new LLM.LLMEvent({
    type: "complete",
    finishReason: "stop",
  })

  console.log("\n完成事件:")
  console.log("- 类型:", complete.type)
  console.log("- 完成原因:", complete.finishReason)
}

// 示例 4: 使用提供商
async function exampleProviders() {
  console.log("\n=== 示例 4: 提供商信息 ===\n")

  console.log("支持的提供商:")
  console.log("- OpenAI (openai-chat 协议)")
  console.log("- Anthropic (anthropic-messages 协议)")
  console.log("- Google Gemini (gemini 协议)")
  console.log("- AWS Bedrock (bedrock-converse 协议)")
  console.log("- Azure OpenAI (openai-chat 协议)")
}

// 运行所有示例
async function main() {
  console.log("OpenCode LLM 集成测试\n")
  console.log("=" .repeat(50))

  try {
    await exampleSimpleRequest()
    await exampleWithTools()
    await exampleStreamEvents()
    await exampleProviders()

    console.log("\n" + "=".repeat(50))
    console.log("\n✅ 所有示例运行成功!")
    console.log("\n下一步:")
    console.log("1. 配置 API 密钥")
    console.log("2. 使用 LLMClient 发送实际请求")
    console.log("3. 处理流式响应")

  } catch (error) {
    console.error("\n❌ 示例运行失败:", error)
    process.exit(1)
  }
}

// 执行主函数
main()
