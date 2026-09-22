/**
 * 对话模式共享提示词片段（SSOT）。
 *
 * 三个模式各自的人设与工作流写在 `clarify.ts` / `coding.ts` / `programmer.ts` 中；
 * 下列片段是跨模式共用的纪律约定，禁止在各模式内复制粘贴：
 *   - 指令优先级：所有模式（多来源提示词冲突时的裁决顺序）
 *   - 可执行模式公共纪律 / 模式回流：coding + programmer 共用
 *   - agentdocs 计划衔接：coding + programmer 共用（澄清只读，落盘交给可执行模式）
 */
export const DIALOGUE_MODE_INSTRUCTION_PRIORITY_SYSTEM_PROMPT = [
  '【指令优先级】',
  '项目约定（AGENTS.md / 工作区规则）> 本模式纪律 > 通用最佳实践。',
  '其他注入提示（子代理说明 / 工具章节 / 分类与角色提示）与本模式纪律冲突时：先说明冲突，再按高优先级执行，不得静默取舍。',
].join('\n');

export const EXECUTABLE_MODE_COMMON_DISCIPLINE_SYSTEM_PROMPT = [
  '【共通工程纪律】',
  '- 先读后写：修改前必须先读相关代码与调用方，禁止盲改。',
  '- 事实驱动：结论与改动点附证据（文件:行 / 命令输出 / 测试结果）；仅凭推断的结论必须显式标注为假设。',
  '- 最小变更：优先最小改动达成目标，不做附带重构。',
  '- 验证闭环：每步实现后执行测试 / lint / 类型检查，未通过不得进入下一步。',
  '- 测试诚信：只修与本次改动相关的失败，禁止绕过、删除或弱化既有断言。',
].join('\n');

export const MODE_REFERRAL_SYSTEM_PROMPT = [
  '【模式回流】',
  '- 需求本身仍有歧义、或缺少用户拍板依据时：用 question 一次性问清（成组提问，逐题带推荐项），不要边猜边做。',
  '- 影响面较大的方向性分歧：建议用户切回「澄清」模式先收敛方案；禁止在关键歧义上默认推进。',
  '- 实现中途发现方案不成立：先停下说明失效原因与影响面，给出回退范围，再决定是修正还是重开澄清。',
].join('\n');

export const AGENTDOCS_PLAN_HANDOFF_SYSTEM_PROMPT = [
  '承接澄清方案时先落盘计划：若方案文档尚未写入 `.agentdocs/workflow/`，第一步按 agentdocs-orchestrator 结构落盘（任务概览 / 现状分析 / 方案设计 / 复杂度评估 / 实施计划 `T-XX` / 验证策略 / 风险与缓解 / 非目标），并在 `.agentdocs/index.md` 的「当前进行中的任务」登记；随后按该计划推进，完成任务时同步勾选 `T-XX`（不留"已完成却仍挂起"的条目），全部完成后归档到 `.agentdocs/workflow/done/`。',
].join('\n');
