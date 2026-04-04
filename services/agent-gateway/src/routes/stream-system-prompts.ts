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

interface RequestScopedPromptOptions {
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

  return [detection.injectedPrompt, capabilityContext, dialogueModePrompt, yoloModePrompt].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
}

export function buildRoundSystemMessages(input: {
  workspaceCtx: string | null;
  routeSystemPrompt?: string;
  requestSystemPrompts: string[];
  shouldGuideToolOutputReadback: boolean;
}) {
  return [
    ...(input.workspaceCtx ? [{ role: 'system' as const, content: input.workspaceCtx }] : []),
    ...(input.routeSystemPrompt
      ? [{ role: 'system' as const, content: input.routeSystemPrompt }]
      : []),
    ...input.requestSystemPrompts.map((content) => ({ role: 'system' as const, content })),
    ...(input.shouldGuideToolOutputReadback
      ? [{ role: 'system' as const, content: TOOL_OUTPUT_REFERENCE_SYSTEM_PROMPT }]
      : []),
  ];
}
