import { KeywordDetectorImpl } from '@openAwork/agent-core';
import type { DialogueMode } from '@openAwork/shared';
import { isFlatMcpToolsDisabled } from '../mcp/mcp-tool-naming.js';

export const TOOL_OUTPUT_REFERENCE_SYSTEM_PROMPT =
  '当历史中出现 [tool_output_reference] 时，表示先前工具输出的完整结果仍然保存在当前会话里，但为了避免上下文膨胀，没有把全文重新塞进提示词。此时不要基于引用猜测细节；如果后续推理需要真实内容，优先调用 read_tool_output，并尽量直接传 toolCallId 配合 lineStart/lineCount、jsonPath 或 itemStart/itemCount 做定向读取。只有在当前会话历史里确实出现了 [tool_output_reference] 且拿不到 toolCallId 时，才允许使用 useLatestReferenced=true。单纯复制/粘贴 UI 上的提示、命令或片段，不等于拥有当前会话里的引用依据。';

/**
 * 网络搜索 / 代码搜索 工具的路由策略。
 *
 * 系统同时存在三条网页搜索路径，目的不同，**必须**按下面规则路由，避免
 * LLM 把原生 `websearch` 工具与多个 MCP 搜索入口视作同义工具反复试用：
 *
 *   1. 默认搜索 MCP：`open_websearch`
 *      - 免 API Key，Gateway 内置适配器，优先用于网页发现。
 *      - 暴露 `search` / `fetch_web` / `fetch_github_readme` 三个工具。
 *
 *   2. `websearch`（原生 tool）— 多 provider 竞速 / 合并 / 顺序兜底，
 *      由用户在 settings 中自行配置 provider 与 API key（DDG / Tavily /
 *      Exa / Serper / SearXNG / Bocha / 智谱 / Google / Bing 任选）。
 *      当默认 MCP 不可用，或用户希望走自定义 provider 时再回退到这里。
 *
 *   3. Exa MCP：默认 flat MCP 模式下，系统内置 Exa MCP 会以
 *      `mcp__websearch__web_search_exa` 这类扁平工具名直接出现在本轮
 *      tools 列表中；仅作为前两条路径都不可用时的最后兜底。
 *
 *   4. grep.app 公开 GitHub 仓库代码检索同理使用本轮 tools 列表里的
 *      `mcp__grep_app__...` 扁平工具；`web_search` 不擅长这种「查代码示例」
 *      场景，遇到 "搜搜开源项目里 X 怎么用 / Y 是怎么实现的" 时直接走
 *      grep_app。
 */
export interface WebSearchRoutingPromptOptions {
  readonly flatMcpToolsEnabled?: boolean;
}

export function buildWebSearchRoutingSystemPrompt(
  options: WebSearchRoutingPromptOptions = {},
): string {
  const flatMcpToolsEnabled = options.flatMcpToolsEnabled ?? !isFlatMcpToolsDisabled();
  const openWebSearchPrimary = flatMcpToolsEnabled
    ? '- 优先使用本轮工具列表中实际存在的 `mcp__open_websearch__search` 做网页发现；需要公开网页正文或 GitHub README 时，再用同 server 的 `fetch_web` / `fetch_github_readme`'
    : '- 优先使用 `mcp_call({ serverId: "open_websearch", toolName: "search", arguments: {...} })` 做网页发现；需要正文或 README 时使用同 server 的 `fetch_web` / `fetch_github_readme`';
  const nativeWebSearchFallback =
    '- 若 `open_websearch` 当前不可用，回退到 `websearch` 工具（原生多 provider / 用户自定义 provider）';
  const exaMcpFallback = flatMcpToolsEnabled
    ? '- 只有前两条路径都不可用，或你明确需要 Exa 结果时，才回退到本轮工具列表中实际存在的 `mcp__websearch__web_search_exa`；不要调用未列出的 MCP 工具名'
    : '- 只有前两条路径都不可用，或你明确需要 Exa 结果时，才回退到 `mcp_call({ serverId: "websearch", toolName: "web_search_exa", arguments: {...} })`';
  const mcpCodeSearchFallback = flatMcpToolsEnabled
    ? '- 想搜「开源项目里 X 是怎么用的 / Y 的真实实现」走本轮工具列表中实际存在的 `mcp__grep_app__...` 扁平 MCP 工具，不要用 `websearch`；不要猜测或调用未列出的旧 MCP 包装入口'
    : '- 想搜「开源项目里 X 是怎么用的 / Y 的真实实现」走 `mcp_call({ serverId: "grep_app", toolName: "<实际工具名>", arguments: {...} })`，不要用 `web_search`';

  return [
    '网络搜索 / 代码搜索 路由策略：',
    '',
    '【网页与时效性信息】',
    openWebSearchPrimary,
    nativeWebSearchFallback,
    exaMcpFallback,
    '- 不要为了同一个普通网页查询在同一轮里连续试完三条搜索路径；只有上一条明确失败、限流或结果明显不够时才继续回退',
    '- 用户要抓取、查找、获取、展示互联网上已经存在的图片时：先用 `open_websearch` 找到页面或图片；只有 `open_websearch` 不可用时再回退到 `websearch`，然后用 `webfetch` 抓取具体图片 URL；这不是图片生成任务',
    '- 只有用户明确要求创建、画、设计、生成一张新的图片时，才允许调用 `generate_image`；不要把“抓取网络图片 / 展示已有图片”误路由到图片生成工具',
    '',
    '【公开仓库的代码检索】',
    mcpCodeSearchFallback,
    '- 工作区内部的代码搜索仍然走原生 `grep` / `glob` / LSP，不要用 grep_app（grep_app 只搜公开 GitHub）',
    '',
    '【何时不需要任何搜索】',
    '- 用户问的是工作区内的事实（已有代码 / 配置 / 文档）→ 优先 read / grep / lsp，不要先去搜外网',
    '- 时效性不强的语言/库基础知识可以直接回答，不必每问必搜',
  ].join('\n');
}

export const WEB_SEARCH_ROUTING_SYSTEM_PROMPT = buildWebSearchRoutingSystemPrompt({
  flatMcpToolsEnabled: true,
});

export const DIALOGUE_MODE_SYSTEM_PROMPTS: Record<DialogueMode, string> = {
  clarify: [
    'OpenAWork 对话模式提醒：clarify（澄清）',
    '',
    '【核心定位】',
    '你是需求澄清助手，唯一目标是理解用户需求、分析项目现状、通过渐进式提问消除歧义，最终产出一份可执行的方案文档。',
    '你的职责是"澄清并设计方案"，不是"实现方案"。编码和文件修改交给编程模式或程序员模式执行。',
    '',
    '【禁止事项】',
    '- 禁止编写代码、修改文件、执行命令。不要使用任何写入/执行类工具（write、edit、bash、apply_patch 等）。',
    '- 禁止在关键需求未明时直接给完整方案；能合理推断的细节先列为假设，不逐项打断用户。',
    '- 禁止把高影响真歧义藏进假设；只有无法安全代决策的关键点才等待用户确认。',
    '',
    '【子任务使用】',
    '- 可以使用 task/Agent 创建子任务，但仅用于信息获取和问题分析，不能用于修改文件或执行命令。',
    '- 子任务会继承澄清模式的工具限制，只能使用只读工具。',
    '- 适合用子任务进行：代码结构探索、依赖分析、影响面调查等，节省主对话 token。',
    '',
    '【渐进式提问原则】',
    '- 由浅入深，每轮只推进一个层级，不一次性回答完毕。',
    '- 当某个方向存在多种选择且会显著影响目标、成本、风险或不可逆后果时，给出 2-4 个可选方向及各自利弊，让用户选择后再深入。',
    '- 每次提问聚焦一个维度，不要在一轮中堆叠过多问题。',
    '',
    '【使用 AskUserQuestion 工具提问】',
    '- 只有遇到高影响、无法根据上下文安全默认的关键选择时，才调用 AskUserQuestion 工具；普通实现细节由你推荐默认方案并继续。',
    '- AskUserQuestion 会生成结构化的交互式问题卡片，用户可以直接点选，体验更好。',
    '- 典型场景：会改变产品目标、数据保留/删除、外部成本、合规边界或不可逆操作的选择。',
    '- 仅在开放性问题（如"你想实现什么功能？"）时才使用纯文本提问。',
    '- 每次调用 AskUserQuestion 聚焦一个关键决策点；如果能给出合理默认值，就不要调用。',
    '',
    '【浅层需求的展开路径】',
    '当用户只给出一句话需求（如"帮我创建一个XX应用"），按以下层级逐步展开：',
    '1. 应用方向：做什么？给谁用？解决什么问题？→ 给出可选方向让用户选择',
    '2. 技术路线：前端/后端/部署/集成方案 → 给出可选技术栈让用户选择',
    '3. 功能设计：核心功能、优先级、MVP 范围 → 列出功能清单让用户圈定',
    '4. 数据/接口设计：实体、API、存储 → 让用户确认',
    '5. 最终方案文档：汇总所有确认内容，输出结构化方案',
    '每一层默认给出推荐假设并推进；只有关键歧义才等用户回复后再进入下一层。',
    '',
    '【已有功能的针对性分析】',
    '当用户对已有项目提出修改需求时：',
    '1. 先用只读工具（read、grep、glob、LSP 查询等）阅读项目相关代码和结构',
    '2. 定位影响范围：涉及哪些模块、接口、数据流',
    '3. 针对性提问：修改意图、兼容性要求、边界条件、优先级',
    '4. 逐步确认后给出修改方案',
    '',
    '【方案输出】',
    '- 方案完成后，明确告知用户：如需实现，请切换到编程模式或程序员模式执行。',
    '- 方案文档应包含：目标、约束、功能清单、技术选型、实施步骤、风险点。',
  ].join('\n'),
  coding: [
    'OpenAWork 对话模式提醒：coding（编程）',
    '',
    '【核心定位】',
    '快速实现导向，产出最小可运行结果。',
    '承接澄清模式的方案，直接落地为代码和命令。',
    '与程序员模式的区别：更短路径、更少铺垫、更容忍"先跑起来再优化"。',
    '',
    '【行为原则】',
    '- 先读后写：修改前必须先读相关代码，禁止盲改。',
    '- 假设显式化：必须假设时写出假设，不默默假设并继续。',
    '- 最小变更：优先最小改动达成目标，不做附带重构。',
    '- 一次一题：每轮聚焦一个实现点，不并行展开多个独立改动。',
    '',
    '【禁止事项】',
    '- 禁止未经阅读直接修改或删除代码。',
    '- 禁止一次性输出大段未经验证的代码（超过 80 行应分步给出）。',
    '- 禁止忽略类型错误和 lint 警告。',
    '- 禁止跳过测试验证（如果项目已有测试）。',
    '',
    '【工具使用策略】',
    '- 修改前：read / grep / lsp 理解上下文 → 确认影响面。',
    '- 修改时：edit 优先于 write（精准替换 > 整文件覆写）。',
    '- 修改后：bash 执行测试或构建验证。',
    '- LSP 语义查询优先于文本搜索（定义跳转、引用查找等）。',
    '',
    '【多步任务策略】',
    '- 识别任务复杂度：单步直接做，多步则列出步骤后逐步执行。',
    '- 每步完成后验证再进入下一步。',
    '- 遇到阻塞时回退到分析，而非强行推进。',
    '',
    '【输出风格】',
    '- 说明尽量短，代码优先。',
    '- 关键决策点简述取舍（1-2 句）。',
    '- 不铺陈大段背景，除非影响落地。',
  ].join('\n'),
  programmer: [
    'OpenAWork 对话模式提醒：programmer（程序员）',
    '',
    '【核心定位】',
    '工程协作模式，以软件工程最佳实践为准则。',
    '侧重：影响面分析、回归安全、可验证性、可维护性。',
    '与编程模式的区别：更重视分析→设计→实现→验证的完整闭环。',
    '',
    '【行为原则】',
    '- 理解优先：动手前充分理解现有代码结构、调用链、数据流。',
    '- 影响面驱动：任何修改必须先评估影响范围。',
    '- 渐进式实现：大改动拆分为可验证的小步骤。',
    '- 验证闭环：每步实现后必须有验证手段（测试 / lint / 构建）。',
    '- 风险前置：提前识别兼容性、性能、安全风险。',
    '',
    '【禁止事项】',
    '- 禁止未经影响面分析直接修改公共接口或共享模块。',
    '- 禁止忽略边界条件和错误处理。',
    '- 禁止提交未通过 lint / 类型检查的代码。',
    '- 禁止绕过现有测试或弱化测试断言。',
    '- 禁止在不确定时给出未标注置信度的结论。',
    '',
    '【工具使用策略】',
    '- 分析阶段：lsp_goto_definition / lsp_find_references / lsp_call_hierarchy 建立调用图。',
    '- 影响评估：grep 搜索引用点 → read 确认每个引用的语义。',
    '- 实现阶段：edit 精准替换 → apply_patch 批量修改。',
    '- 验证阶段：bash 运行测试 → lsp_diagnostics 检查类型和引用错误。',
    '- 重构场景：lsp_prepare_rename → lsp_rename（禁止跳过 prepare）。',
    '',
    '【多步任务策略】',
    '- 任务分解：复杂任务拆为分析→设计→实现→验证四阶段。',
    '- 每阶段产出：分析报告 / 修改方案 / 代码变更 / 验证结果。',
    '- 依赖管理：识别步骤间依赖，无依赖的可并行子任务。',
    '- 回滚准备：关键修改前记录原始状态，支持快速回退。',
    '',
    '【代码质量要求】',
    '- 遵循项目既有代码风格和规范。',
    '- 类型安全：禁止 any、ts-ignore、空 catch。',
    '- 错误处理：所有异步操作必须处理 rejection。',
    '- 测试同步：修改功能时同步更新相关测试。',
    '- 文档更新：公共接口变更时更新注释或文档。',
    '',
    '【输出风格】',
    '- 步骤化组织：多步任务用编号步骤呈现。',
    '- 取舍说明：关键决策点简述利弊和选择理由。',
    '- 风险标注：潜在风险用【风险】前缀显式标注。',
    '- 验证指引：每步给出可执行的验证命令。',
  ].join('\n'),
};

export const YOLO_MODE_SYSTEM_PROMPT = [
  'OpenAWork 执行偏好提醒：yolo',
  '优先少确认、快执行、直达结果；除非明显缺信息，否则不要反复征询。',
].join('\n');

export const CLARIFY_LSP_TOOL_GUIDANCE_SYSTEM_PROMPT = [
  'Codegraph / LSP 只读工具使用策略（澄清模式）：',
  '',
  '【发现缓存优先 codegraph】',
  '- 架构梳理、影响面调查、符号/调用关系探索：优先尝试 codegraph_status → codegraph_search/codegraph_node/codegraph_callers/codegraph_impact',
  '- codegraph 是 gateway-owned 发现缓存；结果若显示 not_indexed、stale、degraded 或 not_available，必须回退到 lsp_*、ast_grep_search、grep、read',
  '- codegraph 结果不能作为编辑/删除的正确性证明；涉及 stale 文件时用 read 或 LSP 读取真实当前内容',
  '',
  '【语义查询优先 LSP】',
  '- 查找符号定义 → lsp_goto_definition',
  '- 查找接口/抽象方法的具体实现 → lsp_goto_implementation',
  '- 查找所有引用/使用 → lsp_find_references',
  '- 获取文件/工作区符号列表 → lsp_symbols',
  '- 查看符号类型签名/文档 → lsp_hover',
  '- 查看函数的调用关系 → lsp_call_hierarchy',
  '- 上述工具用于理解项目结构和影响范围，帮助你给出更准确的方案',
  '',
  '【全文文本搜索用 grep】',
  '- 搜索字符串字面量、注释内容、配置文本 → grep',
  '- 搜索文件名模式 → glob',
  '',
  '【禁止事项】',
  '- 澄清模式下禁止使用 lsp_rename、lsp_prepare_rename 等写入类 LSP 工具',
  '- 不要每轮自动调用 LSP 工具，仅在需要理解项目结构时使用',
].join('\n');

export const LSP_TOOL_GUIDANCE_SYSTEM_PROMPT = [
  'Codegraph / LSP 工具使用策略：',
  '',
  '【发现缓存优先 codegraph】',
  '- 架构梳理、重构影响面、符号/调用关系探索：优先尝试 codegraph_status → codegraph_search/codegraph_node/codegraph_callers/codegraph_impact',
  '- codegraph 是 gateway-owned 发现缓存；结果若显示 not_indexed、stale、degraded 或 not_available，必须回退到 lsp_*、ast_grep_search、grep、read',
  '- codegraph_index 只写 gateway data dir 下的缓存，不应在项目根创建 .codegraph，也不能替代测试、类型检查或源码读取',
  '- codegraph 结果不能作为编辑/删除的正确性证明；涉及 stale 文件时用 read 或 LSP 读取真实当前内容',
  '',
  '【语义查询优先 LSP】',
  '- 查找符号定义 → lsp_goto_definition（而非 grep）',
  '- 查找接口/抽象方法的具体实现 → lsp_goto_implementation（而非 lsp_goto_definition）',
  '- 查找所有引用/使用 → lsp_find_references（而非 grep）',
  '- 获取文件/工作区符号列表 → lsp_symbols（而非正则匹配）',
  '- 查看符号类型签名/文档 → lsp_hover（快速了解类型信息，无需跳转到定义）',
  '- 查看函数的调用关系（谁调用了它/它调用了谁） → lsp_call_hierarchy',
  '- 上述工具返回的是精确语义结果，优先于文本搜索',
  '',
  '【全文文本搜索用 grep】',
  '- 搜索字符串字面量、注释内容、配置文本 → grep',
  '- 搜索文件名模式 → glob',
  '- grep 适合非符号级的文本检索场景',
  '',
  '【重命名必须按序执行】',
  '- 第一步：lsp_prepare_rename — 验证该位置是否可重命名',
  '- 第二步：lsp_rename — 仅在 prepare 通过后执行',
  '- 绝不跳过 prepare 直接 rename',
  '- 绝不自动执行 rename，必须是用户明确要求',
  '',
  '【LSP 不可用时降级】',
  '- 如果 LSP 工具返回"No definition found"/"No implementation found"/"No references found"/"No symbols found"/"No hover information available"/"No call hierarchy found"/"No incoming calls found"/"No outgoing calls found"，回退到 grep + read 组合',
  '- LSP 能力依赖语言服务器是否运行，不是所有文件类型都支持',
  '',
  '【禁止事项】',
  '- 不要每轮自动调用 lsp_goto_definition/lsp_find_references/lsp_symbols/lsp_call_hierarchy',
  '- 不要自动执行 lsp_rename（除非用户明确请求重命名）',
  '- lsp_diagnostics 用于查看当前诊断状态，不要作为常规轮次动作',
].join('\n');

interface RequestScopedPromptOptions {
  companionPrompt?: string | null;
  dialogueMode?: DialogueMode;
  yoloMode?: boolean;
}

// Note: pinnedSkillsPrompt is intentionally not surfaced through
// `buildRequestScopedSystemPrompts` — that helper is for non-stream call
// sites (capability snapshots, etc.) that don't need the per-session
// snapshot. Stream/round paths feed pinnedSkillsPrompt through
// `buildTwoPartSystemPrompts` / `buildSystemPromptChain` directly.

export function buildRequestScopedSystemPrompts(
  message: string,
  capabilityContext: string,
  options: RequestScopedPromptOptions = {},
): string[] {
  const detector = new KeywordDetectorImpl();
  const detection = detector.detect(message);
  const dialogueModePrompt =
    options.dialogueMode !== undefined ? DIALOGUE_MODE_SYSTEM_PROMPTS[options.dialogueMode] : null;
  const yoloModePrompt = options.yoloMode === true ? YOLO_MODE_SYSTEM_PROMPT : null;

  const lspGuidance =
    options.dialogueMode === 'clarify'
      ? CLARIFY_LSP_TOOL_GUIDANCE_SYSTEM_PROMPT
      : LSP_TOOL_GUIDANCE_SYSTEM_PROMPT;

  return [
    detection.injectedPrompt,
    capabilityContext,
    options.companionPrompt,
    lspGuidance,
    dialogueModePrompt,
    yoloModePrompt,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Prompt cache optimization: 2-part system prompt
//
// Part 1 (stable prefix) — rarely changes within a session, high cache hit rate:
//   workspaceCtx + routeSystemPrompt + lspGuidance + dialogueMode + yoloMode
//   + toolOutputReference + thinkingLanguage
//
// Part 2 (dynamic suffix) — changes per round:
//   memoryBlock
//
// Compaction summary is injected into the conversation flow as user+assistant
// message pair (opencode pattern), not as a system message.
//
// Per-request dynamic content (injectedPrompt, capabilityContext, companionPrompt)
// is injected into the last user message as a synthetic part via
// injectSyntheticRequestContext(), similar to oh-my-opencode's
// experimental.chat.messages.transform hook pattern.
// ---------------------------------------------------------------------------

const MEMORY_BLOCK_PLACEHOLDER = `<user-memory />\n当前会话无持久化记忆。`;

const WORKSPACE_CTX_PLACEHOLDER = '<workspace />';

const ROUTE_SYSTEM_PROMPT_PLACEHOLDER = '<route-system-prompt />';

const LSP_GUIDANCE_PLACEHOLDER = '<lsp-guidance />\nLSP 工具使用策略未启用。';

const DIALOGUE_MODE_PLACEHOLDER = '<dialogue-mode />\n当前未指定对话模式。';

const YOLO_MODE_PLACEHOLDER = '<yolo-mode />\n当前未启用 YOLO 执行偏好。';

const THINKING_LANGUAGE_PLACEHOLDER = '<thinking-language />\n当前未启用思考模式。';

export interface SyntheticRequestContext {
  injectedPrompt?: string | null;
  capabilityContext?: string | null;
  companionPrompt?: string | null;
  /**
   * Per-turn thinking-language hint persisted as a *trailing* synthetic
   * text part on the user message. Was previously injected in-memory
   * inside `runModelRound` against whichever message currently happened
   * to be the latest user turn, which mutated the bytes of earlier user
   * turns across rounds and tanked the Anthropic / OpenAI prompt-cache
   * prefix (websearch low-cache-hit root cause).
   *
   * Mirrors opencode's `insertReminders` flow which writes `synthetic`
   * parts back to `sessions.updatePart()` instead of decorating the
   * outbound conversation each turn.
   */
  thinkingLanguageHint?: string | null;
}

const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;

/**
 * Detect a thinking-language hint from a single user-message text.
 *
 * Stateless variant of the legacy `detectUserLanguageHint` — we only look
 * at the message currently being persisted instead of scanning the
 * entire history, because each user message gets its own hint snapshot
 * baked in at write time. Cross-turn cache stability is the goal; if a
 * user switches language mid-session, subsequent turns will simply
 * persist the new language's hint on the new user message.
 *
 * Returns null when no CJK characters are present.
 */
export function detectThinkingLanguageHintFromText(text: string): string | null {
  if (!text || !CJK_RANGE.test(text)) return null;
  const jaRatio = (text.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
  const krRatio = (text.match(/[\uac00-\ud7af]/g) || []).length;
  const zhRatio = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  if (krRatio > zhRatio && krRatio > jaRatio) {
    return '한국어로 생각하세요. 한국어로만 사고하세요.';
  }
  if (jaRatio > zhRatio) {
    return '日本語で思考してください。必ず日本語のみで思考してください。';
  }
  return '请用中文进行思考。你必须全程使用中文思考，绝对不要切换到英文。';
}

/**
 * Markers used to detect whether a user-message string already carries a
 * persisted thinking-language hint. Used by the legacy in-memory
 * fallback in `injectThinkingLanguageHintUnified` to avoid double-
 * appending and breaking byte stability across rounds.
 */
export const THINKING_LANGUAGE_HINT_MARKERS = [
  '请用中文进行思考',
  '한국어로 생각하세요',
  '日本語で思考してください',
] as const;

/**
 * Build per-request synthetic content block to inject into the last user message.
 * Modeled after oh-my-opencode's experimental.chat.messages.transform hook
 * which inserts synthetic parts into user messages for dynamic per-turn context.
 *
 * Exported so the persistence layer (`persistStreamUserMessage`) can compute
 * the same block at write time and store it as a `synthetic: true` text part.
 * That keeps Anthropic / OpenAI prompt-cache prefixes byte-stable across turns
 * — see `injectSyntheticRequestContextUnified` for the legacy in-memory
 * fallback used when older sessions lack a persisted synthetic part.
 */
export function buildSyntheticRequestContextBlock(input: SyntheticRequestContext): string | null {
  const parts: string[] = [];
  if (input.injectedPrompt && input.injectedPrompt.trim().length > 0) {
    parts.push(input.injectedPrompt);
  }
  if (input.capabilityContext && input.capabilityContext.trim().length > 0) {
    parts.push(input.capabilityContext);
  }
  if (input.companionPrompt && input.companionPrompt.trim().length > 0) {
    parts.push(input.companionPrompt);
  }
  return parts.length > 0 ? parts.join('\n\n---\n\n') : null;
}

export interface RoundSystemMessagesInput {
  workspaceCtx: string | null;
  routeSystemPrompt?: string;
  lspGuidance?: string | null;
  dialogueModePrompt?: string | null;
  yoloModePrompt?: string | null;
  flatMcpToolsEnabled?: boolean;
  memoryBlock?: string | null;
  thinkingLanguagePrompt?: string | null;
  /** Dynamic agent prompt sections (delegation table, tool selection, etc.) for orchestrator agents */
  dynamicAgentPrompt?: string | null;
  /** Start-work context injected when ultrawork keyword is detected (plan info + boulder state) */
  startWorkContext?: string | null;
  /** Command template context injected when an active slash command is detected */
  commandContext?: string | null;
  /** 260515-team-phase-a · 7 层团队指令栈（stable 段，per session 内稳定） */
  teamInstructionStack?: string | null;
}

// ---------------------------------------------------------------------------
// Declarative system prompt chain (opencode pattern)
//
// Each element has a fixed position in the chain. No conditional array
// concatenation — all slots are always present, empty ones use placeholders
// for prompt cache stability.
// ---------------------------------------------------------------------------

export interface SystemPromptChainInput {
  workspaceCtx: string | null;
  routeSystemPrompt?: string | null;
  lspGuidance?: string | null;
  dialogueModePrompt?: string | null;
  yoloModePrompt?: string | null;
  flatMcpToolsEnabled?: boolean;
  memoryBlock?: string | null;
  thinkingLanguagePrompt?: string | null;
  dynamicAgentPrompt?: string | null;
  startWorkContext?: string | null;
  commandContext?: string | null;
  /**
   * Optional pinned skills section (PR3 of skill-workspace-selection spec).
   * Lives in the stable prefix because the snapshot is captured on session
   * creation and does not change mid-session.
   */
  pinnedSkillsPrompt?: string | null;
  /**
   * 260515-team-phase-a · T-06：7 层指令栈注入。
   * 包含 AGENTS / architecture / constitution / project-memory /
   * lessons-learned / user_memory / SOUL 拼接结果，已带 ForceApply
   * cache-breaker tag。属于 stable 段（per session 内稳定）。
   *
   * 由调用方通过 `buildTeamInstructionStack(...)` 在 session 创建
   * / round 起始时计算。空字符串视为未启用团队上下文。
   */
  teamInstructionStack?: string | null;
}

/**
 * Build a declarative system prompt chain.
 * Each element has a fixed position — no conditional array concatenation.
 * Returns string[] that can be mapped to UnifiedMessage system messages.
 *
 * Modeled after opencode's system[] array pattern where prompts are
 * composed declaratively and then joined or kept separate for caching.
 */
export function buildSystemPromptChain(input: SystemPromptChainInput): string[] {
  // Fixed-order chain: each slot is always present
  const chain: string[] = [
    // Slot 1: Route-level system prompt (highest priority, rarely changes)
    input.routeSystemPrompt ?? ROUTE_SYSTEM_PROMPT_PLACEHOLDER,
    // Slot 2: Workspace context (file tree, rules, AGENTS.md, README)
    input.workspaceCtx ?? WORKSPACE_CTX_PLACEHOLDER,
    // Slot 3: Dynamic agent prompt (orchestrator delegation tables)
    input.dynamicAgentPrompt ?? '',
    // Slot 4: Start-work context (ultrawork plan + boulder state)
    input.startWorkContext ?? '',
    // Slot 5: Command template context
    input.commandContext ?? '',
    // Slot 6: LSP tool guidance
    input.lspGuidance ?? LSP_GUIDANCE_PLACEHOLDER,
    // Slot 7: Dialogue mode prompt
    input.dialogueModePrompt ?? DIALOGUE_MODE_PLACEHOLDER,
    // Slot 8: YOLO mode prompt
    input.yoloModePrompt ?? YOLO_MODE_PLACEHOLDER,
    // Slot 9: Tool output reference strategy + 网络/代码搜索 路由策略
    TOOL_OUTPUT_REFERENCE_SYSTEM_PROMPT,
    buildWebSearchRoutingSystemPrompt({
      flatMcpToolsEnabled: input.flatMcpToolsEnabled,
    }),
    // Slot 10: Thinking language hint
    input.thinkingLanguagePrompt ?? THINKING_LANGUAGE_PLACEHOLDER,
    // Slot 11: Pinned skills section (PR3 of skill-workspace-selection spec)
    input.pinnedSkillsPrompt ?? '',
    // Slot 12: 260515-team-phase-a · 7 层团队指令栈
    input.teamInstructionStack ?? '',
  ];

  // Filter out empty strings (slots with no content and no placeholder)
  return chain.filter((s) => s.length > 0);
}

/**
 * Split the system prompt chain into a stable header + dynamic tail.
 *
 * Anthropic prompt caching keys on byte-identical prefixes. Mixing
 * dynamic per-round content (orchestrator delegation tables, start-work
 * boulder state, slash-command instructions) with stable session-level
 * content (route prompt, workspace context, LSP guidance, mode prompts,
 * tool-output reference, thinking-language hint) inside one big system
 * message means a single change in the dynamic part invalidates the
 * cache prefix for *all* upstream rounds in the session.
 *
 * Mirrors opencode's `[header, rest.join("\n")]` 2-segment structure
 * (`packages/opencode/src/session/llm.ts` ~lines 117–128) so the first
 * Anthropic system block — which always carries `cache_control` — only
 * contains the parts that change rarely.
 */
export function buildTwoPartSystemPrompts(input: SystemPromptChainInput): {
  stable: string;
  dynamic: string;
} {
  const stableSlots: string[] = [
    input.routeSystemPrompt ?? ROUTE_SYSTEM_PROMPT_PLACEHOLDER,
    input.workspaceCtx ?? WORKSPACE_CTX_PLACEHOLDER,
    input.lspGuidance ?? LSP_GUIDANCE_PLACEHOLDER,
    input.dialogueModePrompt ?? DIALOGUE_MODE_PLACEHOLDER,
    input.yoloModePrompt ?? YOLO_MODE_PLACEHOLDER,
    TOOL_OUTPUT_REFERENCE_SYSTEM_PROMPT,
    buildWebSearchRoutingSystemPrompt({
      flatMcpToolsEnabled: input.flatMcpToolsEnabled,
    }),
    input.thinkingLanguagePrompt ?? THINKING_LANGUAGE_PLACEHOLDER,
    // Pinned skills section: stable for the lifetime of a session because
    // the snapshot is captured at session start. Empty string is filtered
    // below so absence does not affect cache shape.
    input.pinnedSkillsPrompt ?? '',
    // 260515-team-phase-a · 7 层团队指令栈（含 cache-breaker tag）
    input.teamInstructionStack ?? '',
  ];

  const dynamicSlots: string[] = [
    input.dynamicAgentPrompt ?? '',
    input.startWorkContext ?? '',
    input.commandContext ?? '',
  ];

  return {
    stable: stableSlots.filter((s) => s.length > 0).join('\n\n'),
    dynamic: dynamicSlots.filter((s) => s.length > 0).join('\n\n'),
  };
}

/**
 * Build 2-part system messages optimized for prompt caching.
 *
 * Part 1 (stable prefix): content that rarely changes within a session.
 * Part 2 (dynamic suffix): content that changes per round (memory block).
 *
 * Compaction summary is now injected into the conversation flow as
 * user+assistant message pair (opencode pattern), not as a system message.
 * Per-request dynamic content (injectedPrompt, capabilityContext, companionPrompt)
 * is injected via injectSyntheticRequestContext() instead.
 */
export function buildRoundSystemMessages(input: RoundSystemMessagesInput) {
  // Part 1: Stable prefix — high cache hit rate
  const stableParts = [
    input.workspaceCtx ?? WORKSPACE_CTX_PLACEHOLDER,
    input.routeSystemPrompt ?? ROUTE_SYSTEM_PROMPT_PLACEHOLDER,
    input.lspGuidance ?? LSP_GUIDANCE_PLACEHOLDER,
    input.dialogueModePrompt ?? DIALOGUE_MODE_PLACEHOLDER,
    input.yoloModePrompt ?? YOLO_MODE_PLACEHOLDER,
    TOOL_OUTPUT_REFERENCE_SYSTEM_PROMPT,
    buildWebSearchRoutingSystemPrompt({
      flatMcpToolsEnabled: input.flatMcpToolsEnabled,
    }),
    input.thinkingLanguagePrompt ?? THINKING_LANGUAGE_PLACEHOLDER,
    // 260515-team-phase-a · 7 层团队指令栈（stable 段，含 ForceApply cache breaker）
    input.teamInstructionStack ?? '',
    input.dynamicAgentPrompt,
    input.startWorkContext,
    input.commandContext,
  ].filter((part): part is string => typeof part === 'string' && part.length > 0);

  // Part 2: Dynamic suffix — changes per round
  const dynamicContent = input.memoryBlock ?? MEMORY_BLOCK_PLACEHOLDER;

  return [
    { role: 'system' as const, content: stableParts.join('\n\n') },
    { role: 'system' as const, content: dynamicContent },
  ];
}

/**
 * Inject per-request dynamic context into the last user message in the conversation.
 * This follows the oh-my-opencode pattern of using synthetic parts in user messages
 * for content that changes every turn, keeping the system prompt stable for caching.
 *
 * Content is wrapped in <system-reminder> tags to distinguish it from user input,
 * similar to Claude Code's prependUserContext pattern.
 *
 * Note: production callers use `injectSyntheticRequestContextUnified`
 * (UnifiedMessage-aware variant in `routes/stream-model-round.ts`). This
 * legacy `{role, content}` overload is kept for compatibility only and
 * mirrors the same idempotency guard so any future revival path stays
 * byte-stable across rounds.
 */
export function injectSyntheticRequestContext<T extends { role: string; content: string | null }>(
  messages: T[],
  context: SyntheticRequestContext,
): T[] {
  const block = buildSyntheticRequestContextBlock(context);
  if (!block) return messages;

  const result = messages.map((msg) => ({ ...msg }));
  for (let i = result.length - 1; i >= 0; i--) {
    const msg = result[i]!;
    if (msg.role === 'user' && msg.content && !('tool_call_id' in msg)) {
      // Skip injection when the persisted user content already carries the
      // `<system-reminder>` envelope (post-fix sessions) — re-prepending
      // would invalidate the upstream prompt-cache prefix on every round.
      if (msg.content.startsWith('<system-reminder>\n')) {
        break;
      }
      msg.content = `<system-reminder>\n${block}\n</system-reminder>\n\n${msg.content}`;
      break;
    }
  }
  return result;
}
