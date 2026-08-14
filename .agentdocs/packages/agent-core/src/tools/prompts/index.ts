/**
 * 工具提示词统一导出
 */

// LSP 工具
export {
  LSP_TOOL_USAGE_GUIDE,
  LSP_TOOLS_LIST,
} from './lsp-prompt.js';

// Web 搜索工具
export {
  WEB_SEARCH_TOOL_USAGE_GUIDE,
  WEB_SEARCH_TOOLS_LIST,
  WEB_SEARCH_PROVIDERS,
} from './web-search-prompt.js';

// 哈希编辑工具
export {
  HASH_EDIT_TOOL_USAGE_GUIDE,
  HASH_EDIT_TOOLS_LIST,
} from './hash-edit-prompt.js';

// Lint 工具
export {
  POST_WRITE_LINT_USAGE_GUIDE,
  POST_WRITE_LINT_TOOLS_LIST,
} from './lint-prompt.js';

// 类型定义
export type {
  ToolUsageGuide,
  ToolNamesList,
  ToolPromptExport,
} from './types.js';
