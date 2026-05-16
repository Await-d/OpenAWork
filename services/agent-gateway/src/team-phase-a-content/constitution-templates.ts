/**
 * 260515-team-phase-a · T-11
 *
 * 团队宪法（Team Constitution）预置模板。
 *
 * 宪法 = 团队长期约束的明文锚点，对应 7 层指令注入栈中的第 3 层：
 *   AGENTS → architecture → **constitution** → project-memory → lessons-learned → user_memory → SOUL
 *
 * 这些模板提供"工程严格 / 快速迭代 / 平衡"三种风格基调，用户可以在 team workspace
 * 创建后选择一份套用到 `team_workspaces.constitution_md`，再按需要继续编辑。
 */

export interface ConstitutionTemplate {
  /** 模板稳定标识，作为 PUT /constitution 的 source 字段使用 */
  id: string;
  /** 模板名称（中文） */
  name: string;
  /** 一句话描述（用于模板选择卡片） */
  description: string;
  /** 推荐适用场景标签，UI 展示用 */
  recommendedFor: string;
  /** 模板正文（Markdown，写入 team_workspaces.constitution_md） */
  body: string;
}

const ENGINEERING_STRICT: ConstitutionTemplate = {
  id: 'engineering-strict',
  name: '工程严格型',
  description: '强调可验证、可追溯、可回滚；适合后端 / 关键业务团队',
  recommendedFor: '后端团队 / 平台基础设施 / 高合规要求',
  body: `# 团队宪法（工程严格型）

## 我们坚持什么

1. **可验证胜过自洽**：任何主张都要可以通过测试 / 类型 / 日志 / 度量证伪。
2. **小步可逆**：每一次改动都要能在 5 分钟内回滚到上一个稳定状态。
3. **明确权属**：每个文件 / 服务都有明确 owner，owner 不在场时禁止改动其核心契约。
4. **失败即学习**：每一次回归 / 事故都必须沉淀到 lessons-learned，并产出至少一条 guardrail。

## 我们不接受什么

- **未类型化的接口**：所有跨边界调用必须有 Zod / TypeScript 类型契约。
- **静默失败**：禁止空 catch、禁止吞错；错误必须有日志或被显式抛出。
- **未测试的合并**：主分支只接受通过单元测试 + 集成测试的提交。
- **临时方案长期化**：任何 TODO / FIXME 必须有 issue 编号和到期时间。

## 工作方式

- 优先使用现有抽象，不要为单次需求引入新框架。
- 任何新依赖需要在 PR 中说明替代方案对比。
- 新接口必须先写 Zod schema 和测试用例，再写实现。
- 长任务（> 3 天）每天有可演示进度。

## 升级 / 降级原则

- 引入新工具前先评估退出成本。
- 任何外部 SaaS 集成必须有降级方案（mock / fixture / 离线）。
`,
};

const RAPID_ITERATION: ConstitutionTemplate = {
  id: 'rapid-iteration',
  name: '快速迭代型',
  description: '强调先跑起来再优化；适合早期产品 / 探索性团队',
  recommendedFor: '产品验证 / MVP / Hackathon 风格冲刺',
  body: `# 团队宪法（快速迭代型）

## 我们坚持什么

1. **能跑胜过完美**：先验证假设再雕琢实现。
2. **可丢弃**：所有代码默认是可被替换的，不要为它写情书。
3. **速度即反馈**：迭代的价值不在于做对，而在于做快了再调整。
4. **简单胜过聪明**：复杂方案需要在 PR 中明确解释为什么简单方案不行。

## 我们不接受什么

- **过度工程**：还没有第二个使用者就抽出"通用框架"。
- **不可观测**：上线后没有日志 / 没有埋点 / 不知道用户怎么用。
- **PR 卡 3 天以上**：超过 3 天的 review 直接合并并把后续改动写成新 PR。
- **完美主义阻塞**：因为想清楚 100% 再动手。

## 工作方式

- 第一版优先走通主路径，副作用 / 边界条件用 TODO 标记。
- 重构可以单独成 PR，但禁止与功能改动混合。
- 新功能上线前至少有最简单的人工验证脚本。
- 任何被复用 ≥ 3 次的函数 / 组件再考虑抽公共。

## 升级 / 降级原则

- 当前阶段优先选成熟工具，少自研。
- feature flag / kill switch 是基本配置。
`,
};

const BALANCED: ConstitutionTemplate = {
  id: 'balanced',
  name: '平衡型',
  description: '在工程严格与快速迭代之间取中；适合大多数中型项目团队',
  recommendedFor: '中型业务系统 / 已有用户的产品 / 持续演进项目',
  body: `# 团队宪法（平衡型）

## 我们坚持什么

1. **既要快也要稳**：核心路径有测试和监控，边缘路径允许快糙猛。
2. **判断优先级**：用户价值 > 工程整洁度 > 个人偏好。
3. **承认不完美**：技术债是真实债务，但不是所有债都要立刻还。
4. **可逆性贵于一切**：有方案让你"撤回"，错的决定才不是灾难。

## 我们不接受什么

- **核心路径无测试**：用户每天会跑的功能必须有最小验收测试。
- **监控空白**：上线没有错误率 / 延迟 / 关键业务指标。
- **决策无文字记录**：超过 2 小时讨论的方案必须留下 ADR / 决策记录。
- **"以后再说"**：任何被推迟的事情必须明确"什么时候做、做不做的判断标准"。

## 工作方式

- 新功能 PR 必须说明：影响哪些用户路径、有什么测试覆盖、如何回滚。
- 重构与功能改动分开 PR；超过 200 行的 PR 需要拆分。
- 关键模块（auth / 计费 / 数据迁移）的改动必须有第二人 review。
- 长任务每周一个 checkpoint，可以是文字进度也可以是可演示 demo。

## 升级 / 降级原则

- 引入新工具前先确认替代成本与团队学习成本。
- 关键 SaaS 必须有 30 天替换方案。
- feature flag 优先于硬切换。
`,
};

const RESEARCH_DRIVEN: ConstitutionTemplate = {
  id: 'research-driven',
  name: '研究驱动型',
  description: '强调假设先行 / 数据说话；适合算法 / 数据 / 模型团队',
  recommendedFor: '机器学习 / 数据分析 / 算法研究',
  body: `# 团队宪法（研究驱动型）

## 我们坚持什么

1. **先假设后实现**：每个新模型 / 算法都要有书面假设和验证目标。
2. **可复现高于一切**：所有实验必须能在他人机器复现。
3. **基线明确**：没有 baseline 的实验结果不算结论。
4. **数据透明**：训练 / 评估 / 推理用的数据集来源必须有据可查。

## 我们不接受什么

- **没有 baseline 的优化**：声称"提升了 X%"必须给出对比基线。
- **隐式数据泄露**：训练 / 验证 / 测试集划分必须可审计。
- **黑盒调参**：超参数变化必须有实验记录。
- **指标作弊**：只看好看的指标 / 选择性汇报数据。

## 工作方式

- 实验先写实验卡（Hypothesis + Method + Metrics + 失败判据）。
- 代码 + 配置 + 数据 hash 一起记录到实验追踪系统。
- 每周有 reading group / 实验复盘。
- Notebook 用完即整理为可复用脚本，不留在 working tree。

## 升级 / 降级原则

- 模型上线前必须有离线 + 在线 A/B 双重验证。
- 所有上线模型必须有回滚到上一版本的开关。
`,
};

const PRODUCT_LED: ConstitutionTemplate = {
  id: 'product-led',
  name: '产品主导型',
  description: '强调用户价值 / 体验闭环；适合面向终端用户的产品团队',
  recommendedFor: 'C 端 / B 端 SaaS / 用户体验型产品',
  body: `# 团队宪法（产品主导型）

## 我们坚持什么

1. **用户视角第一**：所有改动先回答"对用户意味着什么"。
2. **闭环优先**：能完成一个完整用户旅程比加 5 个不闭环功能更重要。
3. **数据驱动**：每次上线后跟踪关键漏斗指标至少一周。
4. **故事比代码重要**：产品经理 + 工程师必须共享同一个用户故事描述。

## 我们不接受什么

- **没有用户场景的需求**：每个 ticket 都需要 user story / 使用场景。
- **不看数据的发版**：发版后没有人盯指标。
- **体验断点**：一个流程中跳出 app / 切换 tab / 弹窗截断不算闭环。
- **A/B 不收尾**：开了 A/B 实验不看结果就下线。

## 工作方式

- 每个新功能必须先有线框图 / 流程图。
- 工程师参与需求评审，发现可简化的环节当场提出。
- 上线前做一次"5 个真实用户走查"。
- 每周 product review，同步指标、用户反馈、下一步计划。

## 升级 / 降级原则

- 任何影响用户体验的改动必须先小流量灰度。
- 关键漏斗指标变差超过 5% 自动回滚。
`,
};

export const CONSTITUTION_TEMPLATES: readonly ConstitutionTemplate[] = [
  ENGINEERING_STRICT,
  RAPID_ITERATION,
  BALANCED,
  RESEARCH_DRIVEN,
  PRODUCT_LED,
];

export function findConstitutionTemplate(id: string): ConstitutionTemplate | undefined {
  return CONSTITUTION_TEMPLATES.find((template) => template.id === id);
}
