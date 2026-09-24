/**
 * `skill_manage` 工具名常量。
 *
 * 独立成零依赖模块：权限派生器与会话可见性策略都需要引用它，而
 * `skill-admin-tools.ts` 会拉起 DB / 技能注册源客户端 / zod 等依赖，
 * 不适合被纯策略模块（`session-tool-visibility.ts`）导入。
 */
export const SKILL_MANAGE_TOOL_NAME = 'skill_manage';
