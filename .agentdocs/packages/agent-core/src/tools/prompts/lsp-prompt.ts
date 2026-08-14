/**
 * LSP 工具使用提示词
 *
 * 参考: Claude Code LSPTool/prompt.ts
 */

export const LSP_TOOL_USAGE_GUIDE = `
## LSP 工具使用指南

### 核心工具

#### lsp_diagnostics - 获取诊断信息
**使用场景**:
- 修改代码后检查错误和警告
- 代码审查前验证代码质量
- CI/CD 流程中的代码检查

**最佳实践**:
1. 修改文件后先调用 \`lsp_touch\` 通知 LSP 服务器
2. 等待 1-2 秒后调用 \`lsp_diagnostics\` 获取最新诊断
3. 针对单个文件使用 \`filePath\` 参数过滤结果

**工作流示例**:
\`\`\`
1. 编辑文件 → 保存更改
2. lsp_touch(path="src/utils.ts", waitForDiagnostics=true)
3. lsp_diagnostics(filePath="src/utils.ts")
4. 分析诊断结果 → 修复问题
\`\`\`

#### lsp_touch - 通知文件变更
**使用场景**:
- 代码编辑后更新 LSP 服务器状态
- 触发增量编译和类型检查

**参数说明**:
- \`path\`: 被修改的文件路径（必需）
- \`waitForDiagnostics\`: 是否等待诊断更新（默认 true）

### 代码导航工具

#### lsp_goto_definition - 跳转到定义
**使用场景**:
- 查找函数、类、变量的定义位置
- 理解代码结构和依赖关系

**参数要求**:
- \`filePath\`: 文件路径
- \`line\`: 行号（从 1 开始）
- \`character\`: 列号（从 0 开始）

#### lsp_find_references - 查找引用
**使用场景**:
- 重构前评估影响范围
- 删除代码前确认是否有引用

### 工具组合模式

#### 模式 1: 代码理解流程
\`\`\`
1. lsp_symbols(scope="document") → 获取文件结构
2. lsp_goto_definition() → 跳转到关键符号定义
3. lsp_find_references() → 了解使用场景
\`\`\`

#### 模式 2: 代码修改工作流
\`\`\`
1. 修改代码 → 保存文件
2. lsp_touch(path, waitForDiagnostics=true) → 通知 LSP
3. lsp_diagnostics(filePath) → 检查错误
4. 如果有错误 → 修复 → 重复步骤 1-3
5. 如果无错误 → 提交代码
\`\`\`
`;

export const LSP_TOOLS_LIST = [
  'lsp_diagnostics',
  'lsp_touch',
  'lsp_goto_definition',
  'lsp_goto_implementation',
  'lsp_find_references',
  'lsp_symbols',
  'lsp_prepare_rename',
  'lsp_rename',
  'lsp_hover',
  'lsp_call_hierarchy',
] as const;
