/**
 * Post-Write Lint 工具使用提示词
 *
 * 参考: Claude Code 代码质量相关提示
 * 位置: temp/claude-code-sourcemap/restored-src/src/constants/prompts.ts
 */

export const POST_WRITE_LINT_USAGE_GUIDE = `
## Post-Write Lint 工具使用指南

### 核心概念

#### 什么是 Post-Write Lint？
Post-Write Lint 是**编辑后自动运行的代码质量检查**，在文件修改完成后立即执行，提供即时的代码质量反馈。

**核心特性**:
- **增量检查**: 只检查修改的文件，不扫描整个项目
- **自动触发**: 编辑成功后自动运行，无需手动调用
- **即时反馈**: 立即返回 lint 结果，形成"写→lint→修"闭环
- **非阻塞**: lint 失败不影响编辑成功，只提供反馈

**工作流程**:
\`\`\`
文件编辑 → 写入成功 → Post-Write Lint → 返回反馈
                               ↓
                         检测到问题 → 建议修复
\`\`\`

### 集成方式

#### 与哈希编辑集成
Post-Write Lint 内置于 \`HashAnchoredEditor.applyEdits()\` 中，编辑成功后自动运行。

**工作原理**:
\`\`\`typescript
const result = await editor.applyEdits(edits);

if (result.success) {
  // 编辑成功

  if (result.lintFeedback) {
    // 自动运行的 lint 反馈
    console.log('Lint 反馈:', result.lintFeedback);
  }
}
\`\`\`

**优点**:
- 无需手动调用 lint
- 编辑和检查原子化
- 减少遗漏 lint 的可能

### Lint 反馈格式

#### 标准格式示例
\`\`\`
[post-write-lint] 文件写入后 lint 检查结果：

✗ src/utils.ts（125ms）:
  /path/to/src/utils.ts: line 5, col 10, Error - 'add' is defined but never used. (@typescript-eslint/no-unused-vars)
  /path/to/src/utils.ts: line 10, col 5, Warning - Unexpected console statement. (no-console)

⚠ src/types.ts（89ms）:
  /path/to/src/types.ts: line 3, col 15, Warning - Type 'any' should be avoided. (@typescript-eslint/no-explicit-any)

✓ 1 个文件 lint 通过

请根据上述 lint 结果修复问题后继续。
\`\`\`

#### 字段说明
- **文件路径**: \`src/utils.ts\`
- **执行时间**: \`（125ms）\`
- **位置**: \`line 5, col 10\` (行:列)
- **严重级别**: \`Error\` 或 \`Warning\`
- **消息**: 问题描述
- **规则ID**: ESLint 规则名称（括号内）

#### 状态标记
- **✗**: 有错误（Error）
- **⚠**: 有警告（Warning）
- **✓**: 检查通过

### 处理 Lint 反馈

#### 基本处理流程
\`\`\`typescript
const result = await editor.applyEdits(edits);

if (result.success && result.lintFeedback) {
  // 步骤 1: 检查是否有错误或警告
  if (result.lintFeedback.includes('✗')) {
    // 有错误，需要立即修复
    console.error('编辑引入了错误，需要修复');
    // 分析错误并修复
  } else if (result.lintFeedback.includes('⚠')) {
    // 有警告，建议修复
    console.warn('编辑引入了警告，建议修复');
  } else if (result.lintFeedback.includes('✓')) {
    // 通过检查
    console.log('代码质量检查通过');
  }
}
\`\`\`

#### 严重级别处理策略

| 级别 | 策略 | 操作 |
|------|------|------|
| Error (✗) | 必须修复 | 立即修复或重新编辑 |
| Warning (⚠) | 建议修复 | 记录并稍后处理 |
| Pass (✓) | 无需操作 | 继续下一步 |

#### 解析 Lint 反馈
\`\`\`typescript
interface ParsedLintFeedback {
  hasErrors: boolean;
  hasWarnings: boolean;
  errorFiles: string[];
  warningFiles: string[];
  cleanFiles: string[];
  totalFiles: number;
}

function parseLintFeedback(feedback: string): ParsedLintFeedback {
  const hasErrors = feedback.includes('✗');
  const hasWarnings = feedback.includes('⚠');

  // 提取文件列表
  const errorMatches = feedback.matchAll(/✗ (.+?)（/g);
  const errorFiles = Array.from(errorMatches, m => m[1]);

  const warningMatches = feedback.matchAll(/⚠ (.+?)（/g);
  const warningFiles = Array.from(warningMatches, m => m[1]);

  // 提取通过的文件数
  const cleanMatch = feedback.match(/✓ (\\d+) 个文件 lint 通过/);
  const cleanCount = cleanMatch ? parseInt(cleanMatch[1]) : 0;

  return {
    hasErrors,
    hasWarnings,
    errorFiles,
    warningFiles,
    cleanFiles: [], // 不包含具体文件名
    totalFiles: errorFiles.length + warningFiles.length + cleanCount,
  };
}

// 使用示例
const parsed = parseLintFeedback(result.lintFeedback);
console.log(\`检查了 \${parsed.totalFiles} 个文件\`);
console.log(\`错误: \${parsed.errorFiles.length}, 警告: \${parsed.warningFiles.length}\`);
\`\`\`

### 自动修复

#### ESLint 自动修复
某些 lint 问题可以通过 ESLint 的 \`--fix\` 选项自动修复：

**可自动修复的问题**:
- 缺少分号
- 单引号/双引号统一
- 缩进和空格
- 尾随逗号
- 导入语句排序

**不可自动修复的问题**:
- 未使用的变量（需要理解代码逻辑）
- 使用 \`any\` 类型（需要类型推断）
- \`console\` 语句（需要决策是否保留）
- 缺少类型注解（需要类型推断）

#### 手动修复流程
\`\`\`typescript
async function handleLintErrors(
  feedback: string,
  filePath: string,
): Promise<void> {
  const parsed = parseLintFeedback(feedback);

  if (parsed.hasErrors) {
    console.error('❌ 检测到错误，需要修复:');
    console.error(feedback);

    // 分析具体错误
    for (const errorFile of parsed.errorFiles) {
      console.log(\`处理文件: \${errorFile}\`);
      // 根据错误信息决定修复策略
    }
  }
}
\`\`\`

### 常见 Lint 问题

#### 问题 1: 未使用的变量
**规则**: \`@typescript-eslint/no-unused-vars\`

**示例**:
\`\`\`typescript
// ❌ 错误
function add(a: number, b: number) {
  const result = a + b;  // 'result' is defined but never used
  return a + b;
}

// ✅ 正确
function add(a: number, b: number) {
  return a + b;
}
\`\`\`

**修复方法**: 删除未使用的变量或使用它

#### 问题 2: 缺少分号
**规则**: \`@typescript-eslint/semi\`

**示例**:
\`\`\`typescript
// ❌ 错误
const x = 1

// ✅ 正确
const x = 1;
\`\`\`

**修复方法**: 添加分号（可自动修复）

#### 问题 3: 使用 console
**规则**: \`no-console\`

**示例**:
\`\`\`typescript
// ❌ 警告
console.log('debug');

// ✅ 正确（生产代码）
import { logger } from './logger.js';
logger.debug('debug');

// ✅ 正确（开发代码）
// eslint-disable-next-line no-console
console.log('debug');
\`\`\`

**修复方法**: 使用日志库或添加 eslint 忽略注释

#### 问题 4: 使用 any 类型
**规则**: \`@typescript-eslint/no-explicit-any\`

**示例**:
\`\`\`typescript
// ❌ 错误
function process(data: any) {
  return data;
}

// ✅ 正确
function process<T>(data: T): T {
  return data;
}

// ✅ 正确（确实需要 any）
function process(data: unknown) {
  return data;
}
\`\`\`

**修复方法**: 使用具体类型或泛型

#### 问题 5: 缺少类型注解
**规则**: \`@typescript-eslint/explicit-function-return-type\`

**示例**:
\`\`\`typescript
// ❌ 错误
function add(a: number, b: number) {
  return a + b;
}

// ✅ 正确
function add(a: number, b: number): number {
  return a + b;
}
\`\`\`

**修复方法**: 添加返回类型注解

### 最佳实践

#### 实践 1: 优先处理错误
错误（Error）应立即修复，警告（Warning）可以稍后处理。

\`\`\`typescript
if (result.lintFeedback) {
  if (result.lintFeedback.includes('✗')) {
    // ✅ 优先处理错误
    await handleErrors(result.lintFeedback);
    return;  // 先修复错误再继续
  }

  if (result.lintFeedback.includes('⚠')) {
    // ⚠️ 警告可以稍后处理
    logWarnings(result.lintFeedback);
  }
}
\`\`\`

#### 实践 2: 理解错误根因
不要盲目修复，要理解为什么会出现 lint 错误。

\`\`\`typescript
// ❌ 错误：盲目添加 eslint-disable
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const unusedVar = 123;

// ✅ 正确：理解问题并修复
// 如果确实不需要这个变量，删除它
// 如果需要，则使用它
console.log(unusedVar);
\`\`\`

#### 实践 3: 保持编辑和 Lint 的一致性
编辑代码时就要考虑 lint 规则，不要写完再修。

\`\`\`typescript
// ✅ 好习惯：编辑时就遵循规则
const result: number = calculate();

// ❌ 坏习惯：先写错误代码，等 lint 报错再修
const result = calculate()  // 缺少分号和类型
\`\`\`

#### 实践 4: 增量修复
如果一次编辑引入多个问题，逐个修复而不是一次性修改所有。

\`\`\`typescript
// 步骤 1: 修复最严重的错误
await fixCriticalErrors();

// 步骤 2: 修复其他错误
await fixRemainingErrors();

// 步骤 3: 修复警告
await fixWarnings();
\`\`\`

#### 实践 5: 理解项目的 Lint 规则
不同项目可能有不同的 lint 配置，要了解当前项目的规则。

\`\`\`typescript
// 查看项目的 eslint 配置
// .eslintrc.js 或 eslint.config.js
\`\`\`

### 配置优化

#### ESLint 配置建议
\`\`\`javascript
// .eslintrc.js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    // 错误级别规则（必须修复）
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/no-explicit-any': 'error',

    // 警告级别规则（建议修复）
    'no-console': 'warn',

    // 自动修复规则
    '@typescript-eslint/semi': ['error', 'always'],
    'quotes': ['error', 'single'],
  },
};
\`\`\`

#### 性能优化配置
Post-Write Lint 已经针对性能进行了优化：
- **增量检查**: 只检查修改的文件
- **超时控制**: 15 秒超时防止卡死
- **配置缓存**: ESLint 配置会被缓存
- **安静跳过**: 如果没有 eslint 配置，安静跳过

### 错误处理

#### 处理 Lint 失败
Lint 失败不会阻塞编辑，但应该处理反馈：

\`\`\`typescript
const result = await editor.applyEdits(edits);

if (result.success) {
  console.log('✓ 文件编辑成功');

  if (result.lintFeedback) {
    // 有 lint 反馈，处理它
    handleLintFeedback(result.lintFeedback);
  } else {
    // 没有 lint 反馈（可能是项目没有配置 eslint）
    console.log('未运行 lint 检查');
  }
}
\`\`\`

#### 处理配置错误
如果项目没有 eslint 配置，Post-Write Lint 会安静跳过：

\`\`\`typescript
// 项目需要 eslint 配置文件之一：
// - eslint.config.js (推荐，新版 flat config)
// - .eslintrc.js
// - .eslintrc.json
// - .eslintrc

// 如果都不存在，lint 会跳过，不报错
\`\`\`

### 与其他工具集成

#### 与 Prettier 集成
如果项目同时使用 Prettier 和 ESLint：

\`\`\`javascript
// .eslintrc.js
module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier', // 关闭与 Prettier 冲突的规则
  ],
};
\`\`\`

#### 与 Git Hooks 集成
Post-Write Lint 运行在编辑时，与 pre-commit hooks 互补：

\`\`\`json
// package.json
{
  "husky": {
    "hooks": {
      "pre-commit": "lint-staged"
    }
  },
  "lint-staged": {
    "*.ts": [
      "eslint --fix",
      "git add"
    ]
  }
}
\`\`\`

### 性能考虑

#### 增量检查优势
Post-Write Lint 只检查修改的文件，性能开销很小：

\`\`\`
单文件 lint: 50-200ms
多文件 lint: 并行执行，总时间取决于最慢的文件
超时控制: 15 秒后强制终止
\`\`\`

#### 何时会跳过 Lint
以下情况会跳过 lint 检查：
- 项目没有 eslint 配置文件
- eslint 命令不可用
- lint 超时（15 秒）
- 出现其他错误

**跳过 lint 不会阻塞编辑成功**，只是不提供反馈。

### 常见问题

**Q1: Lint 失败会阻止编辑吗？**
A: 不会。Post-Write Lint 在编辑成功后运行，lint 失败只返回反馈，不影响编辑结果。

**Q2: 如何禁用某个规则？**
A: 在 .eslintrc.js 中设置 \`rules: { 'rule-name': 'off' }\` 或使用 \`// eslint-disable-next-line rule-name\` 注释。

**Q3: 为什么没有 lint 反馈？**
A: 可能是：
- 项目没有 eslint 配置
- 编辑的文件不在 lint 范围内
- eslint 命令不可用

**Q4: 如何加快 lint 速度？**
A: Post-Write Lint 已经做了优化（只检查修改的文件），无需额外配置。

**Q5: 如何处理第三方库的类型错误？**
A: 使用 \`// @ts-expect-error\` 注释或在 tsconfig.json 中配置 \`skipLibCheck: true\`。

**Q6: 可以手动触发 lint 吗？**
A: 不需要。Post-Write Lint 自动运行。如果想手动 lint 整个项目，使用 \`npx eslint .\`。

**Q7: Lint 反馈太长怎么办？**
A: 反馈会自动截断到 2000 字符。如果需要完整输出，手动运行 \`npx eslint <file>\`。

### 执行纪律与交接准则

Post-Write Lint 的价值不在于把每一条提示都“清零”，而在于把代码质量风险变成可定位、可复现、可交接的事实。处理反馈时，先确认当前反馈对应的是刚刚修改的文件，再决定是否继续编辑；不要把其他文件的历史告警混入本次结论。

#### 每次编辑后的最小闭环

1. **确认范围**：核对反馈中的文件路径和本轮写入目标一致。若路径不一致，先停止扩展修改，避免误把并发任务的结果当成自己的问题。
2. **按严重级别排序**：先解决 Error，再评估 Warning。Error 代表当前提交路径不满足项目约束；Warning 需要结合行为、可读性和项目规则判断。
3. **定位根因**：从规则 ID、行列号和最近改动三者交叉确认。不要用删除断言、关闭规则或宽泛类型断言掩盖问题。
4. **最小改动修复**：只改造成问题的代码和必要的测试，不进行与反馈无关的格式化或重构，避免扩大审查面。
5. **重新检查并记录结果**：修复后再次获得反馈；只有目标问题消失且没有新增同级错误，才进入下一个任务。

#### 反馈归类表

| 反馈类型 | 首先检查 | 推荐处理 | 不应采用的做法 |
| --- | --- | --- | --- |
| 类型错误 | 输入边界、可空分支、导入类型 | 用窄化、明确类型或 Zod 校验表达真实约束 | \`any\`、非空断言、抑制 TypeScript 错误 |
| 未使用代码 | 调用路径与导出面 | 删除死代码或接入实际使用点 | 仅改名为下划线来掩盖逻辑遗漏 |
| 格式问题 | 项目格式化配置 | 使用项目已有格式化命令 | 手工混合多个格式化风格 |
| 异步错误 | Promise 生命周期和取消路径 | 等待、返回或明确处理 rejection | \`void\` 掉失败的 Promise 或空 catch |
| 安全/边界告警 | 外部输入与文件/网络边界 | 先验证再执行，并保留可诊断错误 | 把外部数据直接拼接到命令或路径 |

#### 何时升级处理

出现以下任一情况时，不应反复尝试同一种表面修补：同一规则在多个文件同时出现、修复会改变公开接口、反馈涉及权限/路径/网络边界、或者检查结果与运行时行为矛盾。此时应记录复现命令、错误原文和受影响文件，先明确根因，再提出最小的结构性修复。这样能让后续维护者从证据继续，而不是从猜测重新开始。

### 总结

Post-Write Lint 是代码质量保障的第一道防线：

✅ **自动运行** - 编辑后立即检查，无需手动触发
✅ **增量检查** - 只检查修改的文件，性能开销小
✅ **即时反馈** - 立即发现问题，形成快速迭代闭环
✅ **非阻塞** - 不影响编辑成功，只提供反馈
✅ **安全跳过** - 没有配置或不可用时安静跳过

**使用建议**：
1. 优先处理错误（✗），警告（⚠）可稍后处理
2. 理解错误根因，不要盲目修复
3. 保持编辑和 lint 规则的一致性
4. 增量修复，逐个解决问题
5. 了解项目的 lint 规则配置
`;

export const POST_WRITE_LINT_TOOLS_LIST = Object.freeze(['post_write_lint'] as const);
