export * from './shared-ui-brand.js';
export * from './shared-ui-inline.js';
export * from './shared-ui-mcp.js';
export * from './shared-ui-skills.js';
export * from './shared-ui-provider.js';
export * from './shared-ui-file-icons.js';

// 设计 token 是一组纯常量（无副作用、无依赖），没有值得替身的行为，
// 直接转发真实实现，避免 mock 与 packages/shared-ui/src/tokens.ts 逐渐漂移。
export { tokens } from '../../../../../packages/shared-ui/src/tokens.js';
export type { Tokens } from '../../../../../packages/shared-ui/src/tokens.js';

// ImagePreview 同为纯展示组件（仅依赖 react + tokens），转发真实实现才能让
// composer 附件预览的接线测试覆盖真实交互契约（点击 / 键盘 / aria-label）。
export { ImagePreview } from '../../../../../packages/shared-ui/src/chat/ImagePreview.js';
export type { ImagePreviewProps } from '../../../../../packages/shared-ui/src/chat/ImagePreview.js';

// SubagentNoticeRow 同为纯展示组件（仅依赖 react + shared 类型 + tokens），
// 转发真实实现才能让「通知按时间位置渲染」的接线测试覆盖真实行渲染。
export { SubagentNoticeRow } from '../../../../../packages/shared-ui/src/chat/SubagentNoticeRow.js';
export type { SubagentNoticeRowProps } from '../../../../../packages/shared-ui/src/chat/SubagentNoticeRow.js';

// 子代理工具名判定与子会话 id 提取是纯函数（无副作用、无依赖），转发真实实现，
// 保证消息流子代理卡片的可点击性 / 预览跳转接线测试覆盖真实判定口径。
export {
  extractSubagentSessionIdFromText,
  isSubagentToolName,
  resolveSubagentSessionIdFromToolOutput,
  SUBAGENT_TOOL_NAMES,
} from '../../../../../packages/shared-ui/src/tools/subagent-tool-names.js';
export type { SubagentToolName } from '../../../../../packages/shared-ui/src/tools/subagent-tool-names.js';
