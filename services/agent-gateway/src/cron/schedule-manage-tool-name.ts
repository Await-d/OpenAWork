/**
 * `schedule_manage` 工具名常量。
 *
 * 独立成零依赖模块：权限派生器与会话可见性策略都需要引用它，而
 * `schedule-admin-tools.ts` 会拉起调度器 / DB / zod 等依赖。
 */
export const SCHEDULE_MANAGE_TOOL_NAME = 'schedule_manage';
