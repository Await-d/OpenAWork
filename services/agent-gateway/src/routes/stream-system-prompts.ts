import { KeywordDetectorImpl } from '@openAwork/agent-core';
import type { DialogueMode } from '@openAwork/shared';

export const TOOL_OUTPUT_REFERENCE_SYSTEM_PROMPT =
  '当历史中出现 [tool_output_reference] 时，表示先前工具输出的完整结果仍然保存在当前会话里，但为了避免上下文膨胀，没有把全文重新塞进提示词。此时不要基于引用猜测细节；如果后续推理需要真实内容，优先调用 read_tool_output，并尽量用 toolCallId 配合 lineStart/lineCount、jsonPath 或 itemStart/itemCount 做定向读取。';

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
    '- 禁止一次性给出完整方案。即使你能推断出答案，也必须分步确认。',
    '- 禁止跳过提问直接给结论。每一层信息都必须经过用户确认或选择。',
    '',
    '【子任务使用】',
    '- 可以使用 task/Agent 创建子任务，但仅用于信息获取和问题分析，不能用于修改文件或执行命令。',
    '- 子任务会继承澄清模式的工具限制，只能使用只读工具。',
    '- 适合用子任务进行：代码结构探索、依赖分析、影响面调查等，节省主对话 token。',
    '',
    '【渐进式提问原则】',
    '- 由浅入深，每轮只推进一个层级，不一次性回答完毕。',
    '- 当某个方向存在多种选择时，给出 2-4 个可选方向及各自利弊，让用户选择后再深入。',
    '- 每次提问聚焦一个维度，不要在一轮中堆叠过多问题。',
    '',
    '【浅层需求的展开路径】',
    '当用户只给出一句话需求（如"帮我创建一个XX应用"），按以下层级逐步展开：',
    '1. 应用方向：做什么？给谁用？解决什么问题？→ 给出可选方向让用户选择',
    '2. 技术路线：前端/后端/部署/集成方案 → 给出可选技术栈让用户选择',
    '3. 功能设计：核心功能、优先级、MVP 范围 → 列出功能清单让用户圈定',
    '4. 数据/接口设计：实体、API、存储 → 让用户确认',
    '5. 最终方案文档：汇总所有确认内容，输出结构化方案',
    '每一层都必须等用户回复后再进入下一层。',
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
  'LSP 只读工具使用策略（澄清模式）：',
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
  'LSP 工具使用策略：',
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
}

/**
 * Build per-request synthetic content block to inject into the last user message.
 * Modeled after oh-my-opencode's experimental.chat.messages.transform hook
 * which inserts synthetic parts into user messages for dynamic per-turn context.
 */
function buildSyntheticRequestContextBlock(input: SyntheticRequestContext): string | null {
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
  memoryBlock?: string | null;
  thinkingLanguagePrompt?: string | null;
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
    input.thinkingLanguagePrompt ?? THINKING_LANGUAGE_PLACEHOLDER,
  ];

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
      msg.content = `<system-reminder>\n${block}\n</system-reminder>\n\n${msg.content}`;
      break;
    }
  }
  return result;
}
