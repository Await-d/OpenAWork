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

// VideoPlayer / AudioPlayer 是媒体渲染的真实交互组件（原生 <video>/<audio> + 自绘控件 +
// 可访问进度条），没有值得替身的行为：转发真实实现，媒体卡片的接线测试才能覆盖真实的
// seek / 键盘 / aria 契约。二者静态依赖只有 react —— hls.js 是 VideoPlayer 内部的动态
// import（非 HLS 分支不会加载），转发不会把重依赖拖进测试环境。
export { VideoPlayer } from '../../../../../packages/shared-ui/src/chat/VideoPlayer.js';
export type { VideoPlayerProps } from '../../../../../packages/shared-ui/src/chat/VideoPlayer.js';
export { AudioPlayer } from '../../../../../packages/shared-ui/src/chat/AudioPlayer.js';
export type { AudioPlayerProps } from '../../../../../packages/shared-ui/src/chat/AudioPlayer.js';

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

// diff / 文件预览共用的高亮工具是纯函数（无副作用）：转发真实实现，
// `FileContentPreview` 会直接调用它们（组件本身仍由 shared-ui-inline mock 替身）。
export {
  detectLanguage,
  highlightCodeLines,
} from '../../../../../packages/shared-ui/src/tools/UnifiedCodeDiff.js';

// 工具视觉状态判定是纯函数（只依赖入参），ToolGlyph 是纯内联 SVG：一并转发真实
// 实现，避免未手写 mock 的测试文件在 import 时拿到 undefined（渲染期直接崩掉）。
export {
  resolveToolVisualStatus,
  ToolGlyph,
} from '../../../../../packages/shared-ui/src/tools/tool-visual-meta.js';
export type { DiffToken } from '../../../../../packages/shared-ui/src/tools/UnifiedCodeDiff.js';

// 思考档位权重与排序是纯常量 / 纯函数(无副作用):转发真实实现,
// 避免模型设置弹层的档位顺序在测试里与真实实现漂移。
export {
  REASONING_EFFORT_RANK,
  sortSupportedReasoningEfforts,
} from '../../../../../packages/shared-ui/src/models/model-reasoning-support.js';

// 模型选择器的过滤 / 分组 / 排序是纯函数（只依赖 fuzzysort，无副作用）：转发真实实现，
// 让模型弹层的接线测试覆盖真实的过滤与排序口径，而不是替身行为。
export {
  buildFilteredModelGroups,
  compareModelsByName,
} from '../../../../../packages/shared-ui/src/models/model-picker-search.js';
export type {
  ModelPickerGroup,
  ModelPickerModel,
  ModelPickerProvider,
  SearchableModelOption,
} from '../../../../../packages/shared-ui/src/models/model-picker-search.js';

// 动态导入失败判定是纯函数（无副作用、无依赖）：转发真实实现，
// 保证路由懒加载自愈与错误边界使用同一套判定口径。
export { isDynamicImportFailure } from '../../../../../packages/shared-ui/src/feedback/dynamic-import-failure.js';

// `BlockToolCall` 的 web 分支只读 displayData 的 `bashView` / `diffView`，而这两个字段
// 在 web 路径下本就是 undefined。这里给一个最小替身，避免为了一条卡片测试把 1340 行的
// `ToolCallCard` 整块拖进测试环境（它连带 diff / 高亮渲染依赖）。
// 注意：若将来 web 分支开始读 displayData 的其它字段，需要在替身里一并补上，
// 否则测试会静默通过而真实环境取不到值。
export function resolveToolCallCardDisplayData(): {
  bashView?: undefined;
  diffView?: undefined;
} {
  return {};
}
