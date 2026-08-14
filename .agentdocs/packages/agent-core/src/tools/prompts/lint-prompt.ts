/**
 * Post-Write Lint 工具使用提示词
 */

export const POST_WRITE_LINT_USAGE_GUIDE = `
## Post-Write Lint 工具使用指南

### 核心概念

#### 什么是 Post-Write Lint？
**编辑后自动运行的代码质量检查**，在文件修改完成后立即执行。

**核心特性**:
1. ✅ **增量检查**: 只检查修改的文件
2. ✅ **自动触发**: 编辑成功后自动运行
3. ✅ **即时反馈**: 立即返回 lint 结果
4. ✅ **非阻塞**: lint 失败不影响编辑成功

### 集成方式

#### 与哈希编辑集成
Post-Write Lint 内置于 \`HashAnchoredEditor.applyEdits()\` 中：

\`\`\`typescript
const result = await editor.applyEdits(edits);

if (result.success && result.lintFeedback) {
  console.log('Lint 反馈:', result.lintFeedback);
}
\`\`\`

### Lint 反馈格式

#### 标准格式
\`\`\`
src/utils.ts:
  5:10  error  'add' is defined but never used  @typescript-eslint/no-unused-vars
  10:5  warning  Unexpected console statement  no-console

✖ 2 problems (1 error, 1 warning)
\`\`\`

### 处理 Lint 反馈

#### 处理流程
\`\`\`typescript
const result = await editor.applyEdits(edits);

if (result.success && result.lintFeedback) {
  const { hasErrors, fixableCount } = parseLintFeedback(result.lintFeedback);

  if (hasErrors) {
    console.error('编辑引入了错误，需要修复');

    if (fixableCount > 0) {
      await runAutoFix(filePath);
    }
  }
}
\`\`\`

#### 严重级别处理策略

| 级别 | 策略 | 操作 |
|------|------|------|
| error | ❌ 必须修复 | 立即修复或回滚 |
| warning | ⚠️ 建议修复 | 记录并稍后处理 |
| fixable | ✅ 可自动修复 | 运行 eslint --fix |

### 自动修复

#### 运行 ESLint Fix
\`\`\`typescript
async function runAutoFix(filePath: string): Promise<boolean> {
  const eslint = new ESLint({ fix: true });
  const results = await eslint.lintFiles([filePath]);
  await ESLint.outputFixes(results);

  return results[0]?.messages.length === 0;
}
\`\`\`

### 常见 Lint 问题

#### 问题 1: 未使用的变量
**规则**: \`@typescript-eslint/no-unused-vars\`
**自动修复**: ❌ 不支持

#### 问题 2: 缺少分号
**规则**: \`@typescript-eslint/semi\`
**自动修复**: ✅ 支持

#### 问题 3: 使用 console
**规则**: \`no-console\`
**自动修复**: ❌ 不支持

### 最佳实践

#### 实践 1: 优先处理错误
先修复 error，再处理 warning

#### 实践 2: 利用自动修复
对于可修复的问题，自动运行 eslint --fix

#### 实践 3: 增量检查
只检查修改的文件，不检查整个项目

### 常见问题

**Q1: Lint 失败会阻止编辑吗？**
A: 不会。lint 在编辑成功后运行，只返回反馈。

**Q2: 自动修复安全吗？**
A: 是的。ESLint --fix 只修复确定安全的问题（如格式、分号）。
`;

export const POST_WRITE_LINT_TOOLS_LIST = ['post_write_lint'] as const;
