# 工具提示词模块

## 目录结构

```
prompts/
├── README.md              # 本文件
├── types.ts              # 接口定义
├── index.ts              # 统一导出
├── lsp-prompt.ts         # LSP 工具提示词
├── web-search-prompt.ts  # Web 搜索工具提示词
├── hash-edit-prompt.ts   # 哈希编辑工具提示词
└── lint-prompt.ts        # Lint 工具提示词
```

## 命名规范

- 文件名: `<tool-name>-prompt.ts`
- 导出常量: `<TOOL>_USAGE_GUIDE` (使用指南文本)
- 导出常量: `<TOOL>_TOOLS_LIST` (工具名称列表)

## 示例

```typescript
// lsp-prompt.ts
export const LSP_TOOL_USAGE_GUIDE = `...`;
export const LSP_TOOLS_LIST = ['lsp_diagnostics', ...] as const;
```

## 使用方式

```typescript
import { LSP_TOOL_USAGE_GUIDE } from '@openAwork/agent-core';
```
