/**
 * OpenCode LLM 类型适配层
 *
 * 提供 AI SDK 和 OpenCode LLM 之间的类型兼容性
 */

import type * as OpenCodeLLM from '@openAwork/opencode-llm'

// ============================================================================
// AI SDK 兼容类型定义
// ============================================================================

/**
 * ModelMessage - 兼容 AI SDK 的 ModelMessage 类型
 */
export type ModelMessage = OpenCodeLLM.Message

/**
 * SystemModelMessage - 兼容 AI SDK 的 SystemModelMessage 类型
 */
export type SystemModelMessage = OpenCodeLLM.SystemPart

/**
 * UserContent - 兼容 AI SDK 的 UserContent 类型
 */
export type UserContent = OpenCodeLLM.ContentPart

/**
 * ToolSet - 兼容 AI SDK 的 ToolSet 类型
 */
export type ToolSet = Record<string, OpenCodeLLM.ToolDefinition>

/**
 * Tool - 兼容 AI SDK 的 Tool 类型
 */
export type Tool = OpenCodeLLM.ToolDefinition

// ============================================================================
// 消息转换函数
// ============================================================================

/**
 * 将 AI SDK SystemModelMessage 转换为 OpenCode LLM SystemPart
 */
export function toOpenCodeSystemPart(
  message: SystemModelMessage | string
): OpenCodeLLM.SystemPart {
  if (typeof message === 'string') {
    return OpenCodeLLM.SystemPart.make(message)
  }
  return message as OpenCodeLLM.SystemPart
}

/**
 * 将 AI SDK ModelMessage 数组转换为 OpenCode LLM Message 数组
 */
export function toOpenCodeMessages(
  messages: ModelMessage[]
): OpenCodeLLM.Message[] {
  return messages as OpenCodeLLM.Message[]
}

/**
 * 将 OpenCode LLM Message 转换为 AI SDK ModelMessage
 */
export function fromOpenCodeMessage(
  message: OpenCodeLLM.Message
): ModelMessage {
  return message as ModelMessage
}

/**
 * 将 AI SDK ToolSet 转换为 OpenCode LLM ToolDefinition 数组
 */
export function toOpenCodeTools(
  tools: ToolSet | undefined
): OpenCodeLLM.ToolDefinition[] | undefined {
  if (!tools) return undefined
  return Object.values(tools)
}

/**
 * 将 OpenCode LLM ToolDefinition 数组转换为 AI SDK ToolSet
 */
export function fromOpenCodeTools(
  tools: OpenCodeLLM.ToolDefinition[] | undefined
): ToolSet | undefined {
  if (!tools) return undefined
  return Object.fromEntries(
    tools.map(tool => [tool.name, tool])
  )
}

// ============================================================================
// 类型守卫
// ============================================================================

/**
 * 检查是否为系统消息
 */
export function isSystemMessage(
  message: ModelMessage | SystemModelMessage
): message is SystemModelMessage {
  return 'type' in message && message.type === 'text'
}

/**
 * 检查是否为用户消息
 */
export function isUserMessage(message: ModelMessage): boolean {
  return message.role === 'user'
}

/**
 * 检查是否为助手消息
 */
export function isAssistantMessage(message: ModelMessage): boolean {
  return message.role === 'assistant'
}

/**
 * 检查是否为工具消息
 */
export function isToolMessage(message: ModelMessage): boolean {
  return message.role === 'tool'
}
