/**
 * 260515-team-phase-b · T-09 / T-10 Feature Flags
 *
 * 控制 handoff 协议是否激活。当 flag 关闭时，现有 interaction-agent / team-leader
 * 流程完全不变（零回归）；当 flag 开启时，这些流程会额外创建 handoff_records
 * 记录派发链，让 watcher / 前端 session 树 / 事件总线能观察到层级关系。
 *
 * Phase B 阶段 flag 默认关闭（opt-in）；Phase C 稳定后默认开启。
 */

/**
 * 是否启用 handoff 协议模式。
 *
 * 开启后：
 *   - POST /team/interaction-agent/rewrite 完成后自动创建 handoff(reception→pm1)
 *   - POST /team/leader/dispatch 完成后自动创建 handoff(pm1→executor) × N
 *   - 前端可通过 /team-events WS 观察到 handoff.created 事件
 *   - session 树可视化能看到 parent→child 链
 *
 * 关闭时：
 *   - 现有行为完全不变
 *   - handoff_records 表不会被写入
 *   - watcher 仍然运行但 pending 队列为空
 */
export function isHandoffModeEnabled(): boolean {
  return globalThis.process?.env['OPENAWORK_TEAM_HANDOFF_MODE'] === '1';
}
