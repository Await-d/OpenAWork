/**
 * Dynamic Agent Prompt Builder
 *
 * Ported from oh-my-opencode's dynamic-agent-prompt-builder.ts.
 * Generates prompt sections (delegation table, tool selection table, key triggers,
 * agent-specific sections) dynamically from REFERENCE_AGENT_ROLE_METADATA.
 *
 * This allows adding/removing agents without manually updating orchestrator prompts.
 */

import {
  REFERENCE_AGENT_ROLE_METADATA,
  type AgentCategory,
  type AgentCost,
  type DelegationTrigger,
} from '@openAwork/shared';

export interface AvailableAgent {
  name: string;
  description: string;
  category?: AgentCategory;
  cost?: AgentCost;
  triggers?: DelegationTrigger[];
  keyTrigger?: string;
  useWhen?: string[];
  avoidWhen?: string[];
}

/**
 * Build the list of available agents from REFERENCE_AGENT_ROLE_METADATA,
 * filtered to only those with category/cost metadata (i.e. the structured agents).
 */
export function getAvailableAgents(filter?: (agent: AvailableAgent) => boolean): AvailableAgent[] {
  const agents: AvailableAgent[] = [];
  for (const [name, meta] of Object.entries(REFERENCE_AGENT_ROLE_METADATA)) {
    if (!meta.category || !meta.cost) continue;
    const agent: AvailableAgent = {
      name,
      description: meta.canonicalRole.coreRole,
      category: meta.category,
      cost: meta.cost,
      triggers: meta.triggers,
      keyTrigger: meta.keyTrigger,
      useWhen: meta.useWhen,
      avoidWhen: meta.avoidWhen,
    };
    if (!filter || filter(agent)) {
      agents.push(agent);
    }
  }
  return agents;
}

/**
 * Build Key Triggers section — checked BEFORE request classification.
 */
export function buildKeyTriggersSection(agents: AvailableAgent[]): string {
  const keyTriggers = agents.filter((a) => a.keyTrigger).map((a) => `- ${a.keyTrigger}`);

  if (keyTriggers.length === 0) return '';

  return `### 关键触发器（分类前检查）：

${keyTriggers.join('\n')}
- **"调研" + "创建 PR"** → 不仅是调研。完整的实施周期。`;
}

/**
 * Build Tool & Agent Selection table sorted by cost.
 */
export function buildToolSelectionTable(agents: AvailableAgent[]): string {
  const rows: string[] = ['### 工具与 Agent 选择：', ''];

  rows.push('| 资源 | 成本 | 何时使用 |');
  rows.push('|------|------|----------|');
  rows.push('| 直接工具 (grep/glob/read) | FREE | 不复杂、范围明确、无隐含假设 |');

  const costOrder: Record<AgentCost, number> = { FREE: 0, CHEAP: 1, EXPENSIVE: 2 };
  const sortedAgents = [...agents]
    .filter((a) => a.category !== 'utility')
    .sort((a, b) => (costOrder[a.cost!] ?? 2) - (costOrder[b.cost!] ?? 2));

  for (const agent of sortedAgents) {
    const shortDesc = agent.description;
    rows.push(`| \`${agent.name}\` agent | ${agent.cost} | ${shortDesc} |`);
  }

  rows.push('');
  rows.push('**默认流程**: explore/librarian (后台) + 工具 → oracle (如需要)');

  return rows.join('\n');
}

/**
 * Build Explore agent section with use/avoid table.
 */
export function buildExploreSection(agents: AvailableAgent[]): string {
  const exploreAgent = agents.find((a) => a.name === 'explore');
  if (!exploreAgent) return '';

  const useWhen = exploreAgent.useWhen || [];
  const avoidWhen = exploreAgent.avoidWhen || [];

  return `### Explore Agent = 代码库搜索

把它当作**同级工具**使用，而非后备。大量启动。

| 使用直接工具 | 使用 Explore Agent |
|-------------|-------------------|
${avoidWhen.map((w) => `| ${w} |  |`).join('\n')}
${useWhen.map((w) => `|  | ${w} |`).join('\n')}`;
}

/**
 * Build Librarian agent section with internal/external comparison.
 */
export function buildLibrarianSection(agents: AvailableAgent[]): string {
  const librarianAgent = agents.find((a) => a.name === 'librarian');
  if (!librarianAgent) return '';

  const useWhen = librarianAgent.useWhen || [];

  return `### Librarian Agent = 外部文档搜索

搜索**外部参考**（文档、OSS、Web）。涉及不熟悉的库时主动启动。

| 内部搜索 (Explore) | 外部搜索 (Librarian) |
|--------------------|---------------------|
| 搜索我们的代码库 | 搜索外部资源 |
| 在本仓库中找模式 | 在其他仓库中找示例 |
| 我们的代码如何工作？ | 这个库如何工作？ |
| 项目特定逻辑 | 官方 API 文档 |
| | 库的最佳实践与特性 |
| | OSS 实现示例 |

**触发短语**（立即启动 librarian）：
${useWhen.map((w) => `- "${w}"`).join('\n')}`;
}

/**
 * Build Delegation Table from agent triggers.
 */
export function buildDelegationTable(agents: AvailableAgent[]): string {
  const rows: string[] = [
    '### 委派表：',
    '',
    '| 领域 | 委派给 | 触发条件 |',
    '|------|--------|----------|',
  ];

  for (const agent of agents) {
    if (!agent.triggers) continue;
    for (const trigger of agent.triggers) {
      rows.push(`| ${trigger.domain} | \`${agent.name}\` | ${trigger.trigger} |`);
    }
  }

  return rows.join('\n');
}

/**
 * Build Oracle usage section with when/when-not tables.
 */
export function buildOracleSection(agents: AvailableAgent[]): string {
  const oracleAgent = agents.find((a) => a.name === 'oracle');
  if (!oracleAgent) return '';

  const useWhen = oracleAgent.useWhen || [];
  const avoidWhen = oracleAgent.avoidWhen || [];

  return `<Oracle_Usage>
## Oracle — 只读高智商顾问

Oracle 是只读的、昂贵的、高质量推理模型，用于调试和架构。仅咨询。

### 何时咨询：

| 触发条件 | 动作 |
|---------|------|
${useWhen.map((w) => `| ${w} | 先 Oracle，再实施 |`).join('\n')}

### 何时不咨询：

${avoidWhen.map((w) => `- ${w}`).join('\n')}

### 使用模式：
调用前简要声明"咨询 Oracle 以[原因]"。

**例外**：这是唯一需要提前声明的情况。其他所有工作，立即开始，不更新状态。
</Oracle_Usage>`;
}

/**
 * Build Hard Blocks section — never-violate constraints.
 */
export function buildHardBlocksSection(): string {
  return `## 硬性禁止（绝不违反）

| 约束 | 无例外 |
|------|--------|
| 类型错误压制 (\`as any\`, \`@ts-ignore\`) | 绝不 |
| 未经明确请求就提交 | 绝不 |
| 对未读代码进行推测 | 绝不 |
| 失败后让代码处于破损状态 | 绝不 |`;
}

/**
 * Build Anti-Patterns section.
 */
export function buildAntiPatternsSection(): string {
  return `## 反模式（阻断违规）

| 类别 | 禁止 |
|------|------|
| **类型安全** | \`as any\`, \`@ts-ignore\`, \`@ts-expect-error\` |
| **错误处理** | 空 catch 块 \`catch(e) {}\` |
| **测试** | 删除失败测试来"通过" |
| **搜索** | 为单行拼写错误或明显语法错误启动 agent |
| **调试** | 散弹式调试，随机修改 |`;
}

/**
 * Build the full dynamic prompt sections for an orchestrator agent (Sisyphus/Atlas).
 * Combines all sections into a single string ready for injection.
 */
export function buildDynamicOrchestratorPrompt(): string {
  const agents = getAvailableAgents();

  const sections: string[] = [];

  const keyTriggers = buildKeyTriggersSection(agents);
  if (keyTriggers) sections.push(keyTriggers);

  sections.push(buildToolSelectionTable(agents));
  sections.push(buildDelegationTable(agents));

  const exploreSection = buildExploreSection(agents);
  if (exploreSection) sections.push(exploreSection);

  const librarianSection = buildLibrarianSection(agents);
  if (librarianSection) sections.push(librarianSection);

  const oracleSection = buildOracleSection(agents);
  if (oracleSection) sections.push(oracleSection);

  sections.push(buildHardBlocksSection());
  sections.push(buildAntiPatternsSection());

  return sections.join('\n\n');
}
