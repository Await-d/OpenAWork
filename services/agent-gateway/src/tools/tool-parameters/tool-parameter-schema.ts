/**
 * 工具参数 schema 的类型别名。
 *
 * 直接复用 `tool-definitions.ts` 的 `GatewayToolDefinition['function']['parameters']`,
 * 避免在本目录重复声明结构而与对外契约漂移。(`import type` 在运行时被擦除,不产生模块环。)
 */
import type { GatewayToolDefinition } from '../tool-definitions.js';

export type ToolParameters = GatewayToolDefinition['function']['parameters'];
