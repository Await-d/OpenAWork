/**
 * 哈希锚定编辑工具使用提示词
 *
 * 参考: Claude Code FileEditTool/prompt.ts
 */

export const HASH_EDIT_TOOL_USAGE_GUIDE = `
## 哈希锚定编辑工具使用指南

### 核心概念

#### 什么是哈希锚定编辑？
使用 **SHA-256 行哈希**来精确定位和验证代码行，确保编辑的原子性和安全性。

**核心优势**:
1. ✅ **并发安全**: 检测文件在读取后是否被修改
2. ✅ **原子性**: 批量编辑要么全部成功，要么全部失败
3. ✅ **精确定位**: 基于内容哈希，而非行号
4. ✅ **自动 Lint**: 编辑后自动运行代码检查

### 工具函数

#### computeLineHashes - 计算行哈希
**功能**: 计算文件每一行的 SHA-256 哈希值

**返回格式**:
\`\`\`typescript
interface LineHash {
  lineNumber: number;  // 行号（从 1 开始）
  hash: string;        // SHA-256 哈希（前 8 位）
  content: string;     // 行内容
}
\`\`\`

#### applyEdits - 应用批量编辑（推荐）
**功能**: 原子性地应用多个编辑操作

**原子性保证**:
1. 所有编辑的哈希都验证通过
2. 所有编辑都成功应用
3. 如果任何一个失败，全部回滚

**示例**:
\`\`\`typescript
const result = await editor.applyEdits([
  {
    filePath: 'src/utils.ts',
    lineNumber: 1,
    expectedHash: 'a3d5e7f9',
    oldContent: 'export function add(a, b) {',
    newContent: 'export function add(a: number, b: number): number {',
  },
]);

if (result.success) {
  console.log('批量编辑成功');
  if (result.lintFeedback) {
    console.log('Lint 反馈:', result.lintFeedback);
  }
}
\`\`\`

### 完整工作流

#### 工作流: 批量编辑（推荐）
\`\`\`
步骤 1: 读取文件
const hashes = await computeLineHashes('src/utils.ts');

步骤 2: 构建编辑列表
const edits = [
  {
    filePath: 'src/utils.ts',
    lineNumber: 5,
    expectedHash: hashes[4].hash,
    oldContent: hashes[4].content,
    newContent: '修改后的第 5 行',
  },
];

步骤 3: 原子性应用所有编辑
const result = await applyEdits(edits);
\`\`\`

### 错误处理

#### 错误 1: Hash Mismatch（哈希不匹配）
**原因**: 文件在读取后被其他进程修改

**解决方案**:
\`\`\`typescript
// 重新读取文件
const freshHashes = await computeLineHashes(filePath);
const updatedEdit = {
  ...originalEdit,
  expectedHash: freshHashes[lineNumber - 1].hash,
};
await applyEdit(updatedEdit);
\`\`\`

### 最佳实践

#### 实践 1: 优先使用 applyEdits（批量）
✅ 推荐: \`await applyEdits([edit1, edit2, edit3]);\`
❌ 不推荐: 多次单独编辑

**原因**: 批量编辑有原子性保证，只运行一次 lint

#### 实践 2: 先读取再编辑
✅ 使用 computeLineHashes 获取精确的哈希和内容
❌ 不要手动构造哈希

#### 实践 3: 保留精确的缩进和空格
确保 oldContent 精确匹配，包括所有空格和缩进
`;

export const HASH_EDIT_TOOLS_LIST = ['hash_edit'] as const;
