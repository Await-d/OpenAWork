/**
 * 团队质量门禁（Team Quality Gates）内联常量。
 *
 * 来源文件：templates/shared/quality-gates.md
 *
 * 修改流程：
 *   1. 编辑 templates/shared/quality-gates.md
 *   2. 将内容同步到本文件的 QUALITY_GATES_MD 常量
 *   3. 运行 `pnpm --filter @openAwork/agent-gateway typecheck` 验证
 *
 * 注入位置：team-instruction-stack.ts 的第 3.5 层（constitution 之后、project-memory 之前）。
 * 这样所有角色的 LLM 都能看到共享质量门禁，无需每个 SOUL 重复定义。
 */

export const QUALITY_GATES_MD = `# 团队质量门禁（Team Quality Gates）

> 本文档是所有角色 SOUL 的共享附录。各角色在执行时必须参照本清单进行自检。
>
> 融合来源：spec-kit Constitution Check 门禁 + hermes-agent Footprint Ladder + hermes-agent TDD/systematic-debugging Iron Law

---

## Spec 阶段门禁

- ✅ **禁止提技术栈/API/代码结构**——spec 只写 WHAT 和 WHY，不写 HOW
- ✅ **所有模糊点必须标记** \`[NEEDS CLARIFICATION: 具体问题]\`，最多 3 个
- ✅ **验收标准必须可测量**——含具体指标（时间/百分比/数量/比率）
- ✅ **验收标准必须技术无关**——不提框架/语言/数据库/工具名
- ✅ **验收标准必须用户导向**——从用户/业务视角描述，不从系统内部描述
- ✅ **成功标准必须可验证**——不知道实现细节也能验证

## Plan 阶段门禁

- ✅ **Constitution Check 门禁**——Phase -1 Pre-Implementation Gates：
  - Simplicity Gate：是否 ≤3 个项目？是否无 future-proofing？
  - Anti-Abstraction Gate：是否直接使用框架？是否单一模型表示？
  - Integration-First Gate：Contracts 是否定义？Contract 测试是否已写？
- ✅ **plan 产物必须包含 \`## 宪法对齐检查\` 表格**——\`| 宪法条目 | 本计划是否符合 | 备注 |\` 格式；constitution 为空时填占位行
- ✅ **门禁不过时必须记录 Complexity Tracking 表**——违反项 / 为什么需要 / 为什么更简单的替代方案不够
- ✅ **技术选型不确定项先产出 research.md**——Decision / Rationale / Alternatives considered
- ✅ **涉及数据实体时附 data-model.md**——实体名/字段/关系/验证规则/状态转换

## Tasks 阶段门禁

- ✅ **按 User Story 分阶段**——每个 story 独立可测、独立可交付
- ✅ **每个任务带精确文件路径**——Create/Modify/Test 三类路径
- ✅ **任务自包含**——每个任务条目自带完整上下文（目标/文件/验收标准/约束），不依赖前序任务的对话历史
- ✅ **\`[P]\` 标记可并行任务**——不同文件、无依赖
- ✅ **\`[US1]\` 标记用户故事归属**
- ✅ **测试先于实现**——文件创建顺序：contracts → tests → source

## 实现阶段门禁

- ✅ **TDD Iron Law: 没有先失败的测试，不写生产代码**
  - RED：写一个最小失败测试 → **运行确认它失败（mandatory）**
  - GREEN：写最小代码让测试通过
  - REFACTOR：重构，保持测试绿
- ✅ **Systematic Debugging Iron Law: 没有根因调查，不尝试修复**
  - Phase 1: Root Cause Investigation → Phase 2: Pattern Analysis → Phase 3: Hypothesis & Testing → Phase 4: Implementation
  - **Rule of Three**：3 次修复失败后停下质疑架构，不盲目尝试第 4 次
- ✅ **交付的代码必须完整可运行**——无 TODO 占位、无"此处省略"、无未实现的 stub
- ✅ **禁止范围外"顺手优化/重构"**——发现机会通过 proposedMemoryEntries 提议，不擅自偏离
- ✅ **Ignore 文件验证**——新建项目结构时检查 .gitignore / .dockerignore / .eslintignore 等

## Review 阶段门禁

- ✅ **两阶段 review 顺序**——必须先 Spec Compliance Review，通过后才进入 Code Quality Review
- ✅ **Spec Compliance Review 维度**：
  - 需求覆盖（每个 FR-### 是否有对应任务？）
  - 歧义检测（是否有 fast/scalable/secure 等未量化形容词？）
  - 一致性（术语是否漂移？实体是否跨文件矛盾？）
  - 宪法对齐（是否违反 MUST 原则？）
  - **范围蔓延检测**（代码中是否有 spec/plan/tasks 未要求的功能？→ 标记 \`unrequested\`）
- ✅ **Code Quality Review 维度**：
  - 项目规范对齐
  - 错误处理
  - 命名清晰度
  - 测试覆盖（+ change-detector 测试检测）
  - **安全扫描清单**：硬编码密钥/Token、shell 注入、eval/exec、pickle.loads、SQL 拼接、路径遍历
- ✅ **严重度四级分级**：
  - CRITICAL（宪法违反 / 核心功能缺失）→ 阻塞打回
  - HIGH（需求重复 / 安全属性模糊 / 不可测试）→ 待修改
  - MEDIUM（术语漂移 / 非功能覆盖缺失）→ 记录但放行
  - LOW（风格 / 冗余）→ 不阻塞
- ✅ **Coverage 统计表**：需求总数 / 有对应实现的需求数 / 覆盖率 % / 无对应实现的需求列表 / 无对应需求的实现列表
- ✅ **独立审查者原则**：reviewer 只看代码和 diff，不假设执行者的意图

## 跨阶段通用门禁

- ✅ **Footprint Ladder（能力扩展决策树）**：新能力应按优先级选择——扩展已有代码 → CLI+skill → service-gated tool → plugin → MCP server → core tool
- ✅ **Fresh subagent per task**：每个任务派发新鲜上下文的子代理，防止上下文污染
- ✅ **禁止投机性功能 / future-proofing / 过度抽象**——每个功能必须追溯到具体用户故事
- ✅ **行为契约胜过快照测试**——测试断言不变量（两块数据必须如何关联），而非冻结当前值
- ✅ **E2E 验证胜过纯 mock**——涉及解析链/配置传播/安全边界/远程后端/文件IO 时，用真实路径验证`;
