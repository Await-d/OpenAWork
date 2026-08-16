/**
 * OpenCode LLM 类型适配层
 *
 * 提供 AI SDK 和 OpenCode LLM 之间的类型兼容性
 */

import { SystemPart } from '@openAwork/opencode-llm';
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

export type { Tool, ToolSet } from 'ai';

export type OpenCodeToolSet = Record<string, OpenCodeLLM.ToolDefinition>;

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
    return SystemPart.make(message)
  }
  return message
}

/**
 * 将 AI SDK ModelMessage 数组转换为 OpenCode LLM Message 数组
 */
export function toOpenCodeMessages(
  messages: ModelMessage[]
): OpenCodeLLM.Message[] {
  return messages
}

/**
 * 将 OpenCode LLM Message 转换为 AI SDK ModelMessage
 */
export function fromOpenCodeMessage(
  message: OpenCodeLLM.Message
): ModelMessage {
  return message
}

/**
 * 将 AI SDK ToolSet 转换为 OpenCode LLM ToolDefinition 数组
 */
export function toOpenCodeTools(
  tools: OpenCodeToolSet | undefined
): OpenCodeLLM.ToolDefinition[] | undefined {
  if (!tools) return undefined
  return Object.values(tools)
}

/**
 * 将 OpenCode LLM ToolDefinition 数组转换为 AI SDK ToolSet
 */
export function fromOpenCodeTools(
  tools: OpenCodeLLM.ToolDefinition[] | undefined
): OpenCodeToolSet | undefined {
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
