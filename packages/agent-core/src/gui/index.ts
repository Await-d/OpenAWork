/**
 * GUI Agent 纯逻辑模块 barrel。
 *
 * Phase 0 提供坐标换算、动作类型、Operator 接口与截图缩放计算；
 * Phase 1 追加常量 / Prompt 模板与视觉决策主循环（WS-1 产物）。
 * 仍不包含任何平台实现或副作用（由网关侧在 Phase 1 注入）。
 */
export * from './action-parser.js';
export * from './action-types.js';
export * from './constants.js';
export * from './coordinates.js';
export * from './gui-agent-runner.js';
export * from './operator.js';
export * from './screenshot-scaler.js';
