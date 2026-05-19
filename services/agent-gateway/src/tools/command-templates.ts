/**
 * Command Templates
 *
 * Ported from oh-my-opencode's builtin-commands/templates.
 * These templates provide detailed workflow instructions that get injected
 * into the LLM conversation when a slash command is executed.
 *
 * In oh-my-opencode, these were injected via the command template system.
 * In OpenAWork, they're injected as synthetic context in the user message
 * when the corresponding command metadata is detected.
 *
 * 语言策略：所有面向 LLM 的指令模板统一使用中文，与 OpenAWork 其他系统级
 * prompt（compaction / dialogue mode / LSP guidance）保持一致。仅
 * `reference-frozen/` 下的快照保留英文（不可改）。
 */

// ---------------------------------------------------------------------------
// /ralph-loop
// ---------------------------------------------------------------------------

export const RALPH_LOOP_INSTRUCTION = `你正在启动一个 Ralph Loop —— 直到任务完成才停下的自循环开发模式。

## Ralph Loop 工作方式

1. 你需要持续推进任务
2. 当你判断任务**完全完成**时，输出：\`<promise>DONE</promise>\`
3. 如果你没有输出完成承诺，循环会自动注入下一轮提示让你继续
4. 最大迭代次数：100（默认）

## 规则

- 聚焦于把任务**完整**做完，而不是部分完成
- 任务真正做完前不要输出完成承诺
- 每一轮都要有实质进展
- 卡住时尝试不同思路
- 用 todos 跟踪进度

## 退出条件

1. **完成**：在任务真正做完后输出完成承诺标签
2. **达到上限**：循环到达最大迭代次数自动停止
3. **取消**：用户运行 \`/cancel-ralph\` 命令`;

export const CANCEL_RALPH_INSTRUCTION = `取消当前激活的 Ralph Loop。

这一步会：
1. 停止循环继续推进
2. 清理 loop 状态文件
3. 让会话正常结束

请检查是否有激活的循环并取消，再把结果告知用户。`;

// ---------------------------------------------------------------------------
// /ulw-loop (ultrawork loop variant)
// ---------------------------------------------------------------------------

export const ULW_LOOP_INSTRUCTION = `你正在启动一个 UltraWork Loop —— 带验证环节的高强度开发循环。

## UltraWork Loop 工作方式

1. **阶段 1：执行**——以 ultrawork 强度持续推进任务
2. 阶段 1 完成后输出：\`<promise>DONE</promise>\`
3. **阶段 2：验证**——会有验证步骤检查你的成果
4. 验证通过后输出：\`<promise>VERIFIED</promise>\`
5. 验证不通过则修复问题并重新验证

## 规则

- ultrawork 模式：最大专注、不做无谓解释
- 任务完整完成前不要发出完成信号
- 每一项断言都需要证据（测试运行、诊断结果等）
- 用 todos 跟踪进度
- 完成后整理改动列表与验证方式，准备好接受验证

## 退出条件

1. **已验证**：验证成功后输出 \`<promise>VERIFIED</promise>\`
2. **达到上限**：循环到达最大迭代次数自动停止
3. **取消**：用户运行 \`/cancel-ralph\` 命令`;

// ---------------------------------------------------------------------------
// /start-work
// ---------------------------------------------------------------------------

export const START_WORK_INSTRUCTION = `你正在启动一个 Sisyphus 工作会话。

## 操作步骤

1. **查找可用计划**：在 \`.sisyphus/plans/\` 目录下查找 Prometheus 生成的计划文件

2. **检查激活的 boulder 状态**：若存在 \`.sisyphus/boulder.json\` 则读取

3. **决策逻辑**：
   - 若 \`.sisyphus/boulder.json\` 存在**且**计划尚未完成（仍有未勾选项）：
     - 把当前 session **追加**到 session_ids
     - 继续推进现有计划
   - 若没有激活计划，或计划已完成：
     - 列出可用的计划文件
     - 若仅有一份计划：自动选中
     - 若有多份计划：列表带时间戳给用户选择

4. **创建/更新 boulder.json**，写入当前激活计划信息

5. **读取计划文件**并按 Orchestrator Sisyphus 工作流执行任务

## 关键约束

- 启动工作前**必须**先更新 boulder.json
- 委派任务前**必须**读完整份计划
- 严格遵循 Orchestrator Sisyphus 委派协议`;

// ---------------------------------------------------------------------------
// /init-deep
// ---------------------------------------------------------------------------

export const INIT_DEEP_INSTRUCTION = `生成层级化的 AGENTS.md 文件。根目录 + 按复杂度评分挑选的子目录。

## 用法

\`\`\`
/init-deep                      # 更新模式：修改已有文件 + 在合适位置新建
/init-deep --create-new         # 读取已有 → 全部移除 → 从零重新生成
/init-deep --max-depth=2        # 限制目录深度（默认 3）
\`\`\`

## 工作流

1. **发现 + 分析**（并行）
   - 立刻发起后台 explore agent
   - 主会话：执行 bash 结构扫描 + LSP codemap + 读取已有 AGENTS.md
2. **打分 & 决策** —— 综合所有发现，决定哪些目录需要 AGENTS.md
3. **生成** —— 先生成根目录，子目录并行生成
4. **复审** —— 去重、裁剪、校验

## 评分矩阵

| 因子 | 权重 | 高分阈值 | 数据来源 |
|--------|--------|----------------|--------|
| 文件数 | 3x | >20 | bash |
| 子目录数 | 2x | >5 | bash |
| 代码占比 | 2x | >70% | bash |
| 独特模式 | 1x | 有自己的配置 | explore |
| 模块边界 | 2x | 含 index.ts/__init__.py | bash |
| 符号密度 | 2x | >30 个符号 | LSP |

## 决策规则

| 评分 | 动作 |
|-------|--------|
| **根目录 (.)** | 必创建 |
| **>15** | 创建 AGENTS.md |
| **8-15** | 若属于独立领域则创建 |
| **<8** | 跳过（父级已覆盖） |

## 质量门槛

- 根目录 AGENTS.md：50–150 行，不写泛泛建议，不写显然信息
- 子目录 AGENTS.md：30–80 行以内，**绝不**重复父级内容
- 章节：OVERVIEW（1 行）、STRUCTURE、WHERE TO LOOK、CONVENTIONS、ANTI-PATTERNS

## 反模式

- **固定 agent 数**：必须根据项目规模/深度动态调整
- **顺序执行**：必须并行（explore + LSP 同时跑）
- **忽视已有内容**：始终先读已有 AGENTS.md，即使带 --create-new
- **过度文档化**：不是每个目录都需要 AGENTS.md
- **冗余**：子级永远不重复父级
- **泛泛而谈**：删掉那些适用于所有项目的内容`;

// ---------------------------------------------------------------------------
// /refactor
// ---------------------------------------------------------------------------

export const REFACTOR_INSTRUCTION = `智能重构命令 —— 在完整代码库感知下做确定性重构。

## 阶段

### PHASE 0：意图门禁（必须最先执行）
- 解析请求类型：明确文件/符号、明确变换、还是开放式
- 若为开放式（"改进一下"、"清理代码"），**必须先追问**具体的改进目标
- 为所有阶段创建初始 todos

### PHASE 1：代码库分析（并行）
- 并行启动 explore agent 调查：目标、依赖、相似模式、测试、架构
- 使用 LSP 工具：LspGotoDefinition、LspFindReferences、LspDocumentSymbols
- 使用 AST-grep：ast_grep_search 进行结构化模式搜索
- 收齐所有后台返回结果

### PHASE 2：构建 codemap
- 构造确定性的 codemap：核心文件、依赖图、影响半径
- 列出重构约束：必须遵守、不得破坏、可安全调整

### PHASE 3：测试评估
- 检测测试基础设施并分析覆盖率
- 根据覆盖率确定验证策略：
  - 高（>80%）：每一步后跑现有测试
  - 中（50%–80%）：跑测试 + 增加安全断言
  - 低（<50%）：**暂停**——先建议补测试
  - 无：**阻断**——拒绝激进重构

### PHASE 4：生成计划
- 调用 Plan agent 输出详细重构计划
- 复核计划完备性
- 为每一步登记详细 todos

### PHASE 5：执行重构
- 每一步：read → edit → verify（lsp_diagnostics + 测试 + type check）
- 验证失败：停止、回滚、定位
- 在逻辑检查点提交

### PHASE 6：最终验证
- 全量测试、type check、lint、构建验证
- 输出改动汇总与验证结果

## 关键规则

- 改完后**绝不**跳过 lsp_diagnostics 检查
- **绝不**在测试失败的情况下继续
- 应用前**始终**预览（ast_grep dryRun=true）
- **始终**遵循已有代码风格
- 连续 3 次验证失败 → 停止，向用户求助`;

// ---------------------------------------------------------------------------
// /remove-deadcode (workflow 260509 P2-DEADCODE)
// ---------------------------------------------------------------------------

export const REMOVE_DEADCODE_INSTRUCTION = `死代码清理命令 —— 在完整 LSP/AST 感知下做证据驱动的删除。

目标是删除**可证明未被使用**的代码。每一项删除都**必须**有确定性证据
支撑（LSP find_references 返回空、AST-grep 显示仅有的调用都在删除目标
内部，等等）。仅靠启发式（grep + 直觉）的删除是**不允许**的。

## 阶段

### PHASE 0：范围门禁（必须最先执行）
- 解析目标范围：
  - 用户给出明确的路径/符号/glob，按字面使用
  - 用户说"整个仓库"或类似话术，先确认范围再扫描
    （仓库级扫描代价高，优先按包/按目录推进）
- 拒绝开放式表述（"清理代码"），直到用户给出具体范围
- 为下方所有阶段建立 todos，使整次清理可审计

### PHASE 1：发现（并行 / 证据优先）
并行启动以下检索：
- AST-grep / 结构化搜索：未使用的导出、从未被 import 的文件、
  从未被引用的顶层函数/类、死分支（\`if (false) …\`）
- 在范围内跑 LSP \`document_symbols\`，列出所有导出 / 公开符号
- 对每个候选符号跑 LSP \`find_references\` —— 引用为空是核心正向信号
- bash：\`git log -- <file>\` 查看候选是否最近才加（避免删掉别人正在做的工作）

### PHASE 2：构建候选清单
- 按类别分组：死文件、死导出、死局部符号、死分支、死测试夹具等
- 命中以下任一条件的候选**全部剔除**：动态分发、反射、字符串注册表
  成员、框架自动发现、对外公共 API、来自其他工作区包的引用
- 每个保留下来的候选必须记录：位置、证据、影响半径、测试覆盖信号

### PHASE 3：删除计划
- 按影响半径排序（最小先删）
- 把原子删除组织成 commit —— 每个逻辑独立的删除一个 commit，
  方便 bisect 定位回归
- 当候选数 ≥3，或任一候选触及公共 API / package barrel 时，
  动手前先把计划呈给用户

### PHASE 4：执行删除
对每个候选（最小影响半径优先）：
1. 重新核验证据（LSP \`find_references\` 仍为空、AST-grep 仍无使用）
2. 应用删除
3. 在受影响文件上跑 \`lsp_diagnostics\`
4. 跑覆盖该区域的最小可行测试集
5. 验证失败：停止、回滚**该候选**、标注为"需要人工复核"，继续下一项

### PHASE 5：最终验证
- 全量 type check + 全量测试 + lint
- 若存在构建产物（bundle / CLI 二进制），跑构建
- 输出删除报告：
  - 候选清单：考虑了哪些、删除了哪些、跳过了哪些（附原因）
  - diff 统计（文件数 / LOC）
  - 跑过的验证命令及其退出状态

## 关键规则
- 没有"无引用"的确定性证据，**绝不**删除代码
- 公共 API 符号在本次未获用户明确同意，**绝不**删除
- **绝不**整批回滚：每个被否决的候选单独回滚
- "注释 + TODO" 仅在用户明确同意时使用，默认"删除即彻底删除"
- 连续 3 次验证失败 → 停止，向用户求助`;

// ---------------------------------------------------------------------------
// Template resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the command instruction template based on command action kind.
 * Returns the instruction text to inject, or null if no template exists.
 */
export function resolveCommandInstruction(
  actionKind: string,
  _metadata: Record<string, unknown>,
): string | null {
  switch (actionKind) {
    case 'start_ralph_loop':
      return RALPH_LOOP_INSTRUCTION;
    case 'start_ulw_loop':
      return ULW_LOOP_INSTRUCTION;
    case 'cancel_ralph_loop':
      return CANCEL_RALPH_INSTRUCTION;
    case 'start_work':
      return START_WORK_INSTRUCTION;
    case 'init_deep':
      return INIT_DEEP_INSTRUCTION;
    case 'refactor_session':
      return REFACTOR_INSTRUCTION;
    case 'remove_deadcode':
      return REMOVE_DEADCODE_INSTRUCTION;
    default:
      return null;
  }
}

/**
 * Check if session metadata indicates an active command that needs
 * its instruction template injected into the next model round.
 */
export function detectActiveCommandContext(
  metadataJson: string,
): { actionKind: string; instruction: string } | null {
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(metadataJson);
  } catch {
    return null;
  }

  // Check for active loop
  if (meta.ralphLoopActive || meta.activeLoopKind === 'ralph') {
    return { actionKind: 'start_ralph_loop', instruction: RALPH_LOOP_INSTRUCTION };
  }
  if (meta.ulwLoopActive || meta.activeLoopKind === 'ulw') {
    return { actionKind: 'start_ulw_loop', instruction: ULW_LOOP_INSTRUCTION };
  }

  // Check for active refactor
  if (meta.refactorStartedAt && !meta.refactorCompletedAt) {
    return { actionKind: 'refactor_session', instruction: REFACTOR_INSTRUCTION };
  }

  // Check for active dead-code removal (P2-DEADCODE workflow 260509).
  // Mirrors the refactor pattern: any non-completed `removeDeadcodeStartedAt`
  // signals the next model round should re-receive the instruction so the
  // workflow survives reload / continuation without leaking past completion.
  if (meta.removeDeadcodeStartedAt && !meta.removeDeadcodeCompletedAt) {
    return { actionKind: 'remove_deadcode', instruction: REMOVE_DEADCODE_INSTRUCTION };
  }

  // Check for active start-work
  if (meta.startWorkAt && !meta.startWorkCompletedAt) {
    return { actionKind: 'start_work', instruction: START_WORK_INSTRUCTION };
  }

  return null;
}
