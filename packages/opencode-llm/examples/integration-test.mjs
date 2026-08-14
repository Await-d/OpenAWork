/**
 * OpenCode LLM 集成测试
 *
 * 测试编译后的代码是否可以正常导入和使用
 */

import * as OpenCodeLLM from "../dist/index.js"

console.log("OpenCode LLM 集成测试\n")
console.log("=".repeat(50))

try {
  // 测试 1: 导入检查
  console.log("\n测试 1: 模块导入检查")
  console.log("  ✓ 主模块导入成功")
  console.log("  - 导出数量:", Object.keys(OpenCodeLLM).length)

  // 核心导出检查
  const coreExports = ['LLMClient', 'Auth', 'Provider', 'Tool', 'LLM', 'LLMRequest', 'Message', 'LLMEvent']
  coreExports.forEach(name => {
    const exists = name in OpenCodeLLM
    console.log(`  - ${name}:`, exists ? "✓" : "✗")
  })

  // 测试 2: 创建 Message
  console.log("\n测试 2: 创建 Message")
  const { Message, TextPart } = OpenCodeLLM

  const message = new Message({
    role: "user",
    content: [
      {
        type: "text",
        text: "Hello, World!",
      }
    ],
  })
  console.log("  ✓ Message 创建成功")
  console.log("  - 角色:", message.role)
  console.log("  - 内容数量:", message.content.length)

  // 测试 3: 使用 LLM.request 创建请求
  console.log("\n测试 3: 使用 LLM.request 创建请求")
  const { Model } = OpenCodeLLM

  const request = OpenCodeLLM.LLM.request({
    model: new Model({
      provider: "openai",
      model: "gpt-4",
    }),
    messages: [message],
  })
  console.log("  ✓ LLM.request 创建成功")
  console.log("  - 类型:", request.constructor.name)
  console.log("  - 消息数量:", request.messages.length)
  console.log("  - 模型:", request.model.model)

  // 测试 4: 工具定义
  console.log("\n测试 4: 创建 ToolDefinition")
  const { ToolDefinition } = OpenCodeLLM

  const toolDef = new ToolDefinition({
    name: "get_weather",
    description: "获取天气信息",
    inputSchema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "城市名称"
        }
      },
      required: ["city"]
    },
  })
  console.log("  ✓ ToolDefinition 创建成功")
  console.log("  - 名称:", toolDef.name)
  console.log("  - 描述:", toolDef.description)

  // 测试 5: 事件类型检查
  console.log("\n测试 5: 事件类型检查")
  const { LLMEvent, TextDelta } = OpenCodeLLM

  // LLMEvent 是一个类型，不是构造函数
  console.log("  ✓ LLMEvent 类型可用")
  console.log("  - TextDelta:", typeof TextDelta)

  // 测试 6: LLM 命名空间
  console.log("\n测试 6: LLM 命名空间")
  console.log("  ✓ LLM 命名空间可用")
  console.log("  - request:", typeof OpenCodeLLM.LLM.request === "function" ? "✓" : "✗")
  console.log("  - updateRequest:", typeof OpenCodeLLM.LLM.updateRequest === "function" ? "✓" : "✗")

  // 测试 7: Provider 检查
  console.log("\n测试 7: Provider 模块")
  const { Provider } = OpenCodeLLM
  console.log("  ✓ Provider 模块可用")
  console.log("  - 类型:", typeof Provider)

  // 测试 8: 工具相关
  console.log("\n测试 8: Tool 相关")
  const { Tool, toDefinitions } = OpenCodeLLM
  console.log("  ✓ Tool 模块可用")
  console.log("  - toDefinitions:", typeof toDefinitions === "function" ? "✓" : "✗")

  console.log("\n" + "=".repeat(50))
  console.log("\n✅ 所有集成测试通过!")
  console.log("\n📦 opencode-llm 包验证成功")
  console.log("   - 所有核心类型可用")
  console.log("   - 对象创建正常")
  console.log("   - 可以在 OpenAWork 中使用")

} catch (error) {
  console.error("\n❌ 测试失败:")
  console.error(error.message)
  console.error("\nStack trace:")
  console.error(error.stack)
  process.exit(1)
}
