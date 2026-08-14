/**
 * 哈希锚定编辑工具使用提示词
 *
 * 参考: Claude Code FileEditTool/prompt.ts
 * 位置: temp/claude-code-sourcemap/restored-src/src/tools/FileEditTool/prompt.ts
 */

export const HASH_EDIT_TOOL_USAGE_GUIDE = `
## 哈希锚定编辑工具使用指南

### 核心概念

#### 什么是哈希锚定编辑？
哈希锚定编辑使用 **SHA-256 行哈希**来精确定位和验证代码行，确保编辑的原子性和安全性。

**核心优势**:
1. ✅ **并发安全**: 检测文件在读取后是否被修改
2. ✅ **原子性**: 批量编辑要么全部成功，要么全部失败
3. ✅ **精确定位**: 基于内容哈希，而非行号
4. ✅ **自动 Lint**: 编辑后自动运行代码检查

**与传统编辑的对比**:

| 特性 | 传统编辑 | 哈希锚定编辑 |
|------|---------|-------------|
| 并发检测 | ❌ 否 | ✅ 是 |
| 原子性 | ❌ 部分失败 | ✅ 全部或无 |
| 验证机制 | ❌ 行号 | ✅ 内容哈希 |
| 自动 Lint | ❌ 手动 | ✅ 自动 |
| 失败回滚 | ❌ 手动 | ✅ 自动 |

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

**使用场景**:
- 需要精确知道某行的哈希值
- 批量编辑前验证文件状态
- 调试哈希不匹配问题

**示例**:
\`\`\`typescript
const editor = new HashAnchoredEditorImpl();
const hashes = await editor.computeLineHashes('src/utils.ts');

// 结果示例:
// [
//   { lineNumber: 1, hash: 'a3d5e7f9', content: 'export function add(a, b) {' },
//   { lineNumber: 2, hash: 'b8c4d6e2', content: '  return a + b;' },
//   { lineNumber: 3, hash: 'c7d9e1f3', content: '}' }
// ]
\`\`\`

#### formatWithHashes - 格式化带哈希的文件
**功能**: 返回带行号和哈希的文件内容，便于人类阅读

**返回格式**:
\`\`\`
1#a3d5e7f9| export function add(a, b) {
2#b8c4d6e2|   return a + b;
3#c7d9e1f3| }
\`\`\`

**使用场景**:
- 查看文件时显示哈希信息
- 准备编辑前确认目标行
- 调试和日志记录

**示例**:
\`\`\`typescript
const formatted = await editor.formatWithHashes('src/utils.ts');
console.log(formatted);
// 输出带哈希的文件内容
\`\`\`

#### applyEdit - 应用单个编辑
**功能**: 对单个行应用编辑操作

**参数**:
\`\`\`typescript
interface AnchoredEdit {
  filePath: string;       // 文件路径
  lineNumber: number;     // 行号（从 1 开始）
  expectedHash: string;   // 预期的行哈希
  oldContent: string;     // 原始内容
  newContent: string;     // 新内容
}
\`\`\`

**返回**:
\`\`\`typescript
{
  success: boolean;    // 是否成功
  error?: string;      // 错误信息（如果失败）
}
\`\`\`

**使用场景**:
- 简单的单行编辑
- 需要立即知道编辑结果

**示例**:
\`\`\`typescript
const result = await editor.applyEdit({
  filePath: 'src/utils.ts',
  lineNumber: 2,
  expectedHash: 'b8c4d6e2',
  oldContent: '  return a + b;',
  newContent: '  return a + b + 1;',
});

if (result.success) {
  console.log('编辑成功');
} else {
  console.error('编辑失败:', result.error);
}
\`\`\`

#### applyEdits - 应用批量编辑（推荐）
**功能**: 原子性地应用多个编辑操作

**参数**: \`AnchoredEdit[]\`（编辑列表）

**返回**:
\`\`\`typescript
{
  success: boolean;       // 是否全部成功
  failed: number[];       // 失败的编辑索引
  error?: string;         // 第一个错误信息
  lintFeedback?: string;  // Lint 反馈（如果成功）
}
\`\`\`

**原子性保证**:
1. 所有编辑的哈希都验证通过
2. 所有编辑都成功应用
3. 如果任何一个失败，全部回滚
4. 文件保持一致状态

**使用场景**:
- 多行编辑（推荐）
- 需要原子性保证
- 需要自动 lint 反馈

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
  {
    filePath: 'src/utils.ts',
    lineNumber: 2,
    expectedHash: 'b8c4d6e2',
    oldContent: '  return a + b;',
    newContent: '  return (a + b) as number;',
  },
]);

if (result.success) {
  console.log('批量编辑成功');
  if (result.lintFeedback) {
    console.log('Lint 反馈:', result.lintFeedback);
  }
} else {
  console.error('编辑失败:', result.error);
  console.error('失败的编辑索引:', result.failed);
}
\`\`\`

### 完整工作流

#### 工作流 1: 单行编辑
\`\`\`
步骤 1: 读取文件（获取哈希）
const hashes = await computeLineHashes('src/utils.ts');

步骤 2: 找到目标行
const targetLine = hashes.find(h => h.lineNumber === 5);

步骤 3: 应用编辑
await applyEdit({
  filePath: 'src/utils.ts',
  lineNumber: targetLine.lineNumber,
  expectedHash: targetLine.hash,
  oldContent: targetLine.content,
  newContent: '新内容',
});

步骤 4: 验证结果
// 编辑成功后会自动运行 lint
\`\`\`

#### 工作流 2: 批量编辑（推荐）
\`\`\`
步骤 1: 读取文件
const hashes = await computeLineHashes('src/utils.ts');

步骤 2: 构建编辑列表
const edits: AnchoredEdit[] = [
  // 编辑行 5
  {
    filePath: 'src/utils.ts',
    lineNumber: 5,
    expectedHash: hashes[4].hash,
    oldContent: hashes[4].content,
    newContent: '修改后的第 5 行',
  },
  // 编辑行 10
  {
    filePath: 'src/utils.ts',
    lineNumber: 10,
    expectedHash: hashes[9].hash,
    oldContent: hashes[9].content,
    newContent: '修改后的第 10 行',
  },
];

步骤 3: 原子性应用所有编辑
const result = await applyEdits(edits);

步骤 4: 处理结果
if (result.success) {
  console.log('所有编辑成功');
  if (result.lintFeedback) {
    // 处理 lint 反馈
    console.log(result.lintFeedback);
  }
} else {
  console.error('部分编辑失败:', result.failed);
  // 所有编辑已自动回滚
}
\`\`\`

#### 工作流 3: 跨文件批量编辑
\`\`\`
步骤 1: 读取多个文件
const file1Hashes = await computeLineHashes('src/a.ts');
const file2Hashes = await computeLineHashes('src/b.ts');

步骤 2: 构建跨文件编辑列表
const edits: AnchoredEdit[] = [
  // 编辑 a.ts
  {
    filePath: 'src/a.ts',
    lineNumber: 5,
    expectedHash: file1Hashes[4].hash,
    oldContent: file1Hashes[4].content,
    newContent: '修改 a.ts',
  },
  // 编辑 b.ts
  {
    filePath: 'src/b.ts',
    lineNumber: 3,
    expectedHash: file2Hashes[2].hash,
    oldContent: file2Hashes[2].content,
    newContent: '修改 b.ts',
  },
];

步骤 3: 原子性应用
const result = await applyEdits(edits);
// 跨文件编辑也是原子性的
\`\`\`

### 错误处理

#### 错误 1: Hash Mismatch（哈希不匹配）
**错误信息**: "hash mismatch: file changed since read"

**原因**:
- 文件在读取后被其他进程修改
- 提供的 expectedHash 不正确
- 行内容已经变化

**解决方案**:
\`\`\`typescript
// 方案 1: 重新读取文件
const freshHashes = await computeLineHashes(filePath);
const updatedEdit = {
  ...originalEdit,
  expectedHash: freshHashes[lineNumber - 1].hash,
  oldContent: freshHashes[lineNumber - 1].content,
};
await applyEdit(updatedEdit);

// 方案 2: 使用 formatWithHashes 查看当前状态
const current = await formatWithHashes(filePath);
console.log('当前文件状态:', current);
// 手动调整编辑
\`\`\`

#### 错误 2: Old Content Mismatch（内容不匹配）
**错误信息**: "old content mismatch: file changed since read"

**原因**:
- oldContent 与当前行内容不一致
- 可能是空格、换行符等差异

**解决方案**:
\`\`\`typescript
// 精确匹配当前内容
const hashes = await computeLineHashes(filePath);
const correctOldContent = hashes.find(h => h.lineNumber === targetLine).content;

await applyEdit({
  ...edit,
  oldContent: correctOldContent,  // 使用从文件读取的精确内容
});
\`\`\`

#### 错误 3: Line Out of Range（行号超出范围）
**错误信息**: "line out of range: X"

**原因**:
- 行号超出文件范围
- 文件被删除或清空

**解决方案**:
\`\`\`typescript
// 验证行号范围
const hashes = await computeLineHashes(filePath);
if (lineNumber < 1 || lineNumber > hashes.length) {
  console.error(\`行号 \${lineNumber} 超出范围 1-\${hashes.length}\`);
  return;
}

// 继续编辑
await applyEdit({...edit, lineNumber});
\`\`\`

#### 错误 4: Unable to Load File（无法加载文件）
**错误信息**: "unable to load file: ..."

**原因**:
- 文件不存在
- 没有读取权限
- 路径错误

**解决方案**:
\`\`\`typescript
import { access } from 'fs/promises';

// 检查文件是否存在
try {
  await access(filePath);
} catch {
  console.error('文件不存在:', filePath);
  return;
}

// 检查路径是否正确
const absolutePath = path.resolve(filePath);
console.log('使用绝对路径:', absolutePath);
\`\`\`

#### 错误 5: Atomic Apply Failed（原子性应用失败）
**错误信息**: "failed to apply edits atomically: ..."

**原因**:
- 写入过程中磁盘满
- 文件被锁定
- 权限不足

**解决方案**:
\`\`\`typescript
// 自动回滚已经完成
// 检查失败原因
const result = await applyEdits(edits);
if (!result.success) {
  console.error('原子性应用失败:', result.error);
  console.error('失败的编辑:', result.failed);

  // 检查磁盘空间
  // 检查文件权限
  // 重试
}
\`\`\`

### Lint 反馈处理

#### Lint 反馈格式
编辑成功后，\`lintFeedback\` 字段包含 ESLint 检查结果：

\`\`\`
src/utils.ts:
  5:10  error  'add' is defined but never used  @typescript-eslint/no-unused-vars
  10:5  warning  Unexpected console statement  no-console

✖ 2 problems (1 error, 1 warning)
\`\`\`

#### 处理 Lint 反馈
\`\`\`typescript
const result = await applyEdits(edits);

if (result.success && result.lintFeedback) {
  const feedback = result.lintFeedback;

  // 检查是否有 error
  if (feedback.includes('error')) {
    console.error('编辑引入了 ESLint 错误:');
    console.error(feedback);

    // 可能需要修复
    // 或回滚编辑
  }

  // 检查是否有 warning
  if (feedback.includes('warning')) {
    console.warn('编辑引入了警告:');
    console.warn(feedback);
  }
}
\`\`\`

#### 自动修复 Lint 问题
\`\`\`typescript
// 编辑后运行 lint fix
const result = await applyEdits(edits);

if (result.success && result.lintFeedback) {
  // 运行 eslint --fix
  await runLintFix(filePath);

  // 验证修复结果
  const afterFix = await lintFile(filePath);
  if (afterFix.errors.length === 0) {
    console.log('Lint 问题已自动修复');
  }
}
\`\`\`

### 最佳实践

#### 实践 1: 优先使用 applyEdits（批量）
✅ **推荐**: 批量编辑
\`\`\`typescript
await applyEdits([edit1, edit2, edit3]);
\`\`\`

❌ **不推荐**: 多次单独编辑
\`\`\`typescript
await applyEdit(edit1);
await applyEdit(edit2);
await applyEdit(edit3);
\`\`\`

**原因**:
- 批量编辑有原子性保证
- 只运行一次 lint
- 性能更好

#### 实践 2: 先读取再编辑
✅ **推荐**: 使用 computeLineHashes
\`\`\`typescript
const hashes = await computeLineHashes(filePath);
const targetLine = hashes[4];  // 第 5 行

await applyEdit({
  filePath,
  lineNumber: targetLine.lineNumber,
  expectedHash: targetLine.hash,
  oldContent: targetLine.content,
  newContent: '新内容',
});
\`\`\`

❌ **不推荐**: 手动构造哈希
\`\`\`typescript
await applyEdit({
  filePath,
  lineNumber: 5,
  expectedHash: 'guessed-hash',  // ❌ 猜测的哈希
  oldContent: 'guessed content',  // ❌ 猜测的内容
  newContent: '新内容',
});
\`\`\`

#### 实践 3: 保留精确的缩进和空格
\`\`\`typescript
// ✅ 正确：保留原始缩进
const hashes = await computeLineHashes(filePath);
const original = hashes[4].content;  // "  return a + b;"（2个空格）

await applyEdit({
  oldContent: original,  // 精确匹配，包括缩进
  newContent: '  return a + b + 1;',  // 保持 2 个空格缩进
});

// ❌ 错误：改变缩进
await applyEdit({
  oldContent: original,
  newContent: '    return a + b + 1;',  // 4 个空格，与原始不一致
});
\`\`\`

#### 实践 4: 处理编辑结果
\`\`\`typescript
const result = await applyEdits(edits);

// ✅ 完整处理
if (result.success) {
  console.log('编辑成功');

  if (result.lintFeedback) {
    // 处理 lint 反馈
    handleLintFeedback(result.lintFeedback);
  }
} else {
  console.error('编辑失败:', result.error);
  console.error('失败索引:', result.failed);

  // 分析失败原因
  // 重试或报告错误
}

// ❌ 忽略错误
await applyEdits(edits);  // 不检查结果
\`\`\`

#### 实践 5: 并发编辑保护
\`\`\`typescript
// ✅ 使用哈希检测并发修改
const hashes = await computeLineHashes(filePath);

// ... 一些操作，文件可能被修改 ...

const result = await applyEdit({
  expectedHash: hashes[4].hash,  // 会检测文件是否改变
  // ...
});

if (!result.success && result.error?.includes('hash mismatch')) {
  // 检测到并发修改
  console.warn('文件已被其他进程修改，重新读取');
  const freshHashes = await computeLineHashes(filePath);
  // 使用新的哈希重试
}
\`\`\`

### 性能优化

#### 优化 1: 批量读取多个文件
\`\`\`typescript
// ✅ 并行读取
const [file1, file2, file3] = await Promise.all([
  computeLineHashes('src/a.ts'),
  computeLineHashes('src/b.ts'),
  computeLineHashes('src/c.ts'),
]);

// ❌ 串行读取
const file1 = await computeLineHashes('src/a.ts');
const file2 = await computeLineHashes('src/b.ts');
const file3 = await computeLineHashes('src/c.ts');
\`\`\`

#### 优化 2: 复用哈希计算结果
\`\`\`typescript
// ✅ 计算一次，多次使用
const hashes = await computeLineHashes(filePath);

const edits = [
  { lineNumber: 5, expectedHash: hashes[4].hash, ... },
  { lineNumber: 10, expectedHash: hashes[9].hash, ... },
  { lineNumber: 15, expectedHash: hashes[14].hash, ... },
];

await applyEdits(edits);

// ❌ 多次计算
await applyEdit({
  expectedHash: (await computeLineHashes(filePath))[4].hash,
  ...
});
await applyEdit({
  expectedHash: (await computeLineHashes(filePath))[9].hash,
  ...
});
\`\`\`

#### 优化 3: 减少 formatWithHashes 调用
\`\`\`typescript
// formatWithHashes 主要用于调试和展示
// 正常编辑流程使用 computeLineHashes 即可

// ✅ 仅在需要展示时使用
if (DEBUG_MODE) {
  const formatted = await formatWithHashes(filePath);
  console.log(formatted);
}

// ❌ 不必要的格式化
const formatted = await formatWithHashes(filePath);  // 不需要展示
const hashes = await computeLineHashes(filePath);    // 又计算一次
\`\`\`

### 使用场景

#### 场景 1: 代码重构
批量重命名变量，保证原子性

#### 场景 2: 并发编辑
多人协作时检测冲突

#### 场景 3: 自动化修复
脚本批量修改代码

#### 场景 4: 代码生成
生成代码后插入到指定位置

### 常见问题

**Q1: 为什么要用哈希而不是行号？**
A: 哈希基于内容，即使文件被其他进程修改（如插入/删除行），也能准确检测到变化。

**Q2: 哈希冲突怎么办？**
A: SHA-256 前 8 位冲突概率极低（约 1/4,294,967,296），实际使用中可以忽略。

**Q3: 编辑失败会影响文件吗？**
A: 不会。\`applyEdits\` 保证原子性，失败时自动回滚，文件保持编辑前状态。

**Q4: Lint 失败会阻止编辑吗？**
A: 不会。编辑会成功应用，lint 反馈仅作为警告返回。

**Q5: 可以跨文件编辑吗？**
A: 可以。\`applyEdits\` 支持编辑多个文件，原子性保证适用于所有文件。
`;

export const HASH_EDIT_TOOLS_LIST = ['hash_edit'] as const;
