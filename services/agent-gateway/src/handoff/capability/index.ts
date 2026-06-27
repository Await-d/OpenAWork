/**
 * handoff/capability/ — 五层架构层级约束系统
 *
 * 目录结构：
 *   - layer-capabilities.ts     — Capability 矩阵 + 5 个 guard 函数
 *   - builtin-instructions.ts   — 指令注册表 + dispatcher + toToolDefinition
 *   - builtin-instructions-impl.ts — 所有层的指令实现（注册入口）
 *   - toolset-gate.ts           — 通用工具 toolset 白名单过滤
 *   - dispatch-package.ts       — d 层 dispatch_package 标准结构
 *   - index.ts                  — 本文件，barrel 导出
 *
 * 后续扩展方向：
 *   - 当 builtin-instructions-impl.ts 超过 1500 行时，按层拆分为：
 *     instructions-reception.ts / instructions-pm1.ts / instructions-pm2.ts / instructions-execution.ts
 *   - 新增指令时在对应层文件中 registerInstruction，然后在 barrel 中 import
 */

// ─── Layer Capabilities（guard 函数）
export {
  LAYER_CAPABILITIES,
  assertCanHandoffTo,
  assertCanReceiveInbound,
  assertSubstateAllowed,
  assertCanWriteArtifactPhase,
  assertInstructionOwnedByLayer,
  LayerCapabilityViolationError,
  type LayerCapabilities,
  type ViolationKind,
  type InboundMessageType,
} from './layer-capabilities.js';

// ─── Builtin Instructions（注册表 + dispatcher）
export {
  registerInstruction,
  getInstruction,
  getInstructionsForLayer,
  invokeInstruction,
  toToolDefinition,
  __clearRegistryForTesting,
  type BuiltinInstruction,
  type InstructionContext,
  type InstructionResult,
} from './builtin-instructions.js';

// ─── Toolset Gate（通用工具过滤）
export {
  filterToolsByAllowedSets,
  extractToolsetsFromMetadata,
  TOOLSET_TO_TOOL_NAMES,
} from './toolset-gate.js';

// ─── Dispatch Package（d 层标准载荷）
export {
  assignedMemberSchema,
  dispatchPackageSchema,
  taskProfileSchema,
  parseTaskLine,
  parseAllTasks,
  buildDispatchPackages,
  inferTaskKind,
  inferTaskSurface,
  inferTaskProfile,
  resolveAssignedMember,
  buildTaskProfilePromptFragment,
  TOOLSET_CATEGORIES,
  TASK_KINDS,
  TASK_SURFACES,
  type DispatchPackage,
  type ParsedTaskLine,
  type AssignedMember,
  type TaskProfile,
  type TaskKind,
  type TaskSurface,
  type ToolsetCategory,
} from './dispatch-package.js';
