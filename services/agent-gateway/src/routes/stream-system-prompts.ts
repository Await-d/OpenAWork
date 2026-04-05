import { KeywordDetectorImpl } from '@openAwork/agent-core';
import type { DialogueMode } from '@openAwork/shared';

export const TOOL_OUTPUT_REFERENCE_SYSTEM_PROMPT =
  '当历史中出现 [tool_output_reference] 时，表示先前工具输出的完整结果仍然保存在当前会话里，但为了避免上下文膨胀，没有把全文重新塞进提示词。此时不要基于引用猜测细节；如果后续推理需要真实内容，优先调用 read_tool_output，并尽量用 toolCallId 配合 lineStart/lineCount、jsonPath 或 itemStart/itemCount 做定向读取。';

const DIALOGUE_MODE_SYSTEM_PROMPTS: Record<DialogueMode, string> = {
  clarify: [
    'OpenAWork 对话模式提醒：clarify（澄清）',
    '在给方案、代码或结论前，先确认用户目标、约束、环境与验收条件是否已经足够明确。',
    '先基于当前上下文总结已知事实，再指出真正缺失的关键信息；不要泛泛追问。',
    '如果需求仍有歧义，优先提出高价值澄清问题，并说明这些问题会影响什么决策。',
    '当信息已经足够时，再给下一步建议、计划或实现路径。',
  ].join('\n'),
  coding: [
    'OpenAWork 对话模式提醒：coding（编程）',
    '优先直接产出代码、命令、补丁思路或最小可运行实现。',
    '说明尽量短，除非会影响落地，否则不要先铺陈大段背景。',
    '如有必要假设，请明确写出假设并继续给出实现。',
    '默认目标是尽快把事情做成，而不是停留在泛化讨论。',
  ].join('\n'),
  programmer: [
    'OpenAWork 对话模式提醒：programmer（程序员）',
    '以工程协作模式回答，优先给实现思路、修改点、调试步骤、验证方式和风险提醒。',
    '优先结合现有代码结构、调用链和影响面给出建议，而不是只讲抽象概念。',
    '可以简短说明取舍，但结论必须面向落地。',
    '如果任务有多个步骤，用简明步骤组织输出。',
  ].join('\n'),
};

const YOLO_MODE_SYSTEM_PROMPT = [
  'OpenAWork 执行偏好提醒：yolo',
  '优先少确认、快执行、直达结果；除非明显缺信息，否则不要反复征询。',
].join('\n');

const LSP_TOOL_GUIDANCE_SYSTEM_PROMPT = [
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

  return [
    detection.injectedPrompt,
    capabilityContext,
    options.companionPrompt,
    LSP_TOOL_GUIDANCE_SYSTEM_PROMPT,
    dialogueModePrompt,
    yoloModePrompt,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

export function buildRoundSystemMessages(input: {
  workspaceCtx: string | null;
  routeSystemPrompt?: string;
  requestSystemPrompts: string[];
  shouldGuideToolOutputReadback: boolean;
  memoryBlock?: string | null;
}) {
  return [
    ...(input.workspaceCtx ? [{ role: 'system' as const, content: input.workspaceCtx }] : []),
    ...(input.routeSystemPrompt
      ? [{ role: 'system' as const, content: input.routeSystemPrompt }]
      : []),
    ...input.requestSystemPrompts.map((content) => ({ role: 'system' as const, content })),
    ...(input.memoryBlock ? [{ role: 'system' as const, content: input.memoryBlock }] : []),
    ...(input.shouldGuideToolOutputReadback
      ? [{ role: 'system' as const, content: TOOL_OUTPUT_REFERENCE_SYSTEM_PROMPT }]
      : []),
  ];
}
