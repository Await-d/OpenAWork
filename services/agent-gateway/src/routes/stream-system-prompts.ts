import { KeywordDetectorImpl } from '@openAwork/agent-core';
import type { DialogueMode } from '@openAwork/shared';
import { isFlatMcpToolsDisabled } from '../mcp/mcp-tool-naming.js';
import {
  AGENTDOCS_PLAN_HANDOFF_SYSTEM_PROMPT,
  DIALOGUE_MODE_INSTRUCTION_PRIORITY_SYSTEM_PROMPT,
  DIALOGUE_MODE_SYSTEM_PROMPTS,
  EXECUTABLE_MODE_COMMON_DISCIPLINE_SYSTEM_PROMPT,
  MODE_REFERRAL_SYSTEM_PROMPT,
} from './dialogue-mode-prompts/index.js';

export const TOOL_OUTPUT_REFERENCE_SYSTEM_PROMPT =
  '当历史中出现 [tool_output_reference] 时，表示先前工具输出的完整结果仍然保存在当前会话里，但为了避免上下文膨胀，没有把全文重新塞进提示词。此时不要基于引用猜测细节；如果后续推理需要真实内容，优先调用 read_tool_output，并尽量直接传 toolCallId 配合 lineStart/lineCount、jsonPath 或 itemStart/itemCount 做定向读取。只有在当前会话历史里确实出现了 [tool_output_reference] 且拿不到 toolCallId 时，才允许使用 useLatestReferenced=true。单纯复制/粘贴 UI 上的提示、命令或片段，不等于拥有当前会话里的引用依据。';

/**
 * 工具调用纪律（对齐参考库基础提示词的 `Prefer parallelizing independent
 * tool calls.`）。
 *
 * 本仓的成本大头是「轮数 × 上下文」：把可并行的独立调用拆成多轮，会让同一段
 * 历史被重复计入 input。这里显式要求同轮并行 / 用 `batch` 批量提交，并提醒
 * 折叠工具先查目录再调用。
 */
export const HARNESS_TOOL_CALL_DISCIPLINE_SYSTEM_PROMPT = [
  '工具调用纪律：',
  '- 互不依赖的工具调用应尽量在**同一条回复里一起发出**（原生并行），或使用 `batch` 工具批量提交；不要为可并行的调用单开一轮。',
  '- 只有下一步确实依赖上一步结果时才串行等待；信息收集阶段优先并行。',
  '- 折叠工具（见「可折叠工具目录」）先用 `tool_search` 查准参数再 `tool_invoke`，不要凭记忆猜参数。',
].join('\n');

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

export {
  AGENTDOCS_PLAN_HANDOFF_SYSTEM_PROMPT,
  DIALOGUE_MODE_INSTRUCTION_PRIORITY_SYSTEM_PROMPT,
  DIALOGUE_MODE_SYSTEM_PROMPTS,
  EXECUTABLE_MODE_COMMON_DISCIPLINE_SYSTEM_PROMPT,
  MODE_REFERRAL_SYSTEM_PROMPT,
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
  /**
   * 用户长期记忆块（`<user-memory>`）。
   *
   * 放在**最后一条用户消息**而不是 system 尾段：记忆会在对话中被
   * `autoExtractMemoriesForRequest` / `memory_manage` 更新，若挂在 system
   * 尾段，任何一次更新都会让「system + 全部历史」的 prompt-cache 前缀整段失效。
   * 挂到用户消息上时，一次更新只会影响该消息之后的**新增后缀**（本来就要重算）。
   */
  memoryBlock?: string | null;
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
  if (input.memoryBlock && input.memoryBlock.trim().length > 0) {
    parts.push(input.memoryBlock);
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
  /**
   * 工具折叠目录（仅折叠启用时非空）。对齐参考库把 Code Mode 目录放进
   * instructions 的做法，注入 stable 段；目录在会话内字节稳定。
   */
  toolCatalogPrompt?: string | null;
  /**
   * 能力目录（agents / skills / MCP / 工具名 / commands）。
   *
   * 对齐参考库 instructions 的形状：注入 stable 段而不是挂在每条用户消息上，
   * 让同一会话内的字节保持稳定（缓存友好），能力变化时下一轮整段刷新。
   */
  capabilityCatalogPrompt?: string | null;
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
    // Slot 9: Tool output reference strategy + 工具调用纪律 + 网络/代码搜索 路由策略
    TOOL_OUTPUT_REFERENCE_SYSTEM_PROMPT,
    HARNESS_TOOL_CALL_DISCIPLINE_SYSTEM_PROMPT,
    buildWebSearchRoutingSystemPrompt({
      flatMcpToolsEnabled: input.flatMcpToolsEnabled,
    }),
    // Slot 10: Thinking language hint
    input.thinkingLanguagePrompt ?? THINKING_LANGUAGE_PLACEHOLDER,
    // Slot 11: Pinned skills section (PR3 of skill-workspace-selection spec)
    input.pinnedSkillsPrompt ?? '',
    // Slot 12: 260515-team-phase-a · 7 层团队指令栈
    input.teamInstructionStack ?? '',
    // Slot 13: 工具折叠目录（对齐参考库 instructions 中的 Code Mode 目录）
    input.toolCatalogPrompt ?? '',
    // Slot 14: 能力目录（instructions 式；stable 段字节稳定）
    input.capabilityCatalogPrompt ?? '',
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
    HARNESS_TOOL_CALL_DISCIPLINE_SYSTEM_PROMPT,
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
    // 工具折叠目录（对齐参考库 instructions 中的 Code Mode 目录）
    input.toolCatalogPrompt ?? '',
    // 能力目录（instructions 式；stable 段字节稳定）
    input.capabilityCatalogPrompt ?? '',
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
