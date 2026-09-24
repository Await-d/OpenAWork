/**
 * `memory_manage` 工具名常量。
 *
 * 独立成零依赖模块：权限派生器与会话可见性策略都需要引用它，而
 * `memory-admin-tools.ts` 会拉起 DB / 记忆存储 / zod 等依赖，不适合被
 * 纯策略模块（`session-tool-visibility.ts`）导入。
 */
export const MEMORY_MANAGE_TOOL_NAME = 'memory_manage';
