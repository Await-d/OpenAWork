import type { DialogueMode } from '../../../pages/chat-page/mode/dialogue-mode.js';
import type { ReasoningEffort } from '../../conversation-runtime/messages/support.js';

export interface PromptOptimizationContextInput {
  readonly dialogueMode: DialogueMode;
  readonly providerId: string;
  readonly providerType?: string;
  readonly modelId: string;
  readonly input: string;
  readonly imageGenerationMode: boolean;
  readonly imageGenerationBackground?: string;
  readonly imageGenerationOutputFormat?: string;
  readonly imageGenerationQuality?: string;
  readonly imageGenerationSize?: string;
  readonly webSearchEnabled: boolean;
  readonly thinkingEnabled: boolean;
  readonly reasoningEffort: ReasoningEffort;
  readonly attachmentCount: number;
  readonly hasAgentOverride: boolean;
  readonly hasSlashCommands: boolean;
  readonly hasMentions: boolean;
  readonly hasSelectedImageReference: boolean;
}

const DIALOGUE_MODE_LABELS: Record<DialogueMode, string> = {
  clarify: '需求澄清',
  coding: '代码协作',
  programmer: '工程实现',
};

const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最大',
};

function hasComposerSlashCommand(text: string): boolean {
  return /(^|[\s\n])\/[^\s/]/u.test(text);
}

function hasComposerMention(text: string): boolean {
  return /(^|[\s\n])@[^\s@]/u.test(text);
}

export function buildPromptOptimizationContext(input: PromptOptimizationContextInput): string {
  const providerLabel = input.providerType?.trim() || input.providerId.trim() || '未命名提供商';
  const modelLabel = input.modelId.trim() || '未命名模型';
  const modeLabel = input.imageGenerationMode ? '图片生成提示词' : '标准聊天提示词';
  const thinkingLabel = input.thinkingEnabled
    ? `开启（${REASONING_EFFORT_LABELS[input.reasoningEffort]}）`
    : '关闭';
  const availableAssist: string[] = [];
  const usedAssist: string[] = [];

  if (input.hasSlashCommands) {
    availableAssist.push('/ 命令');
  }
  if (input.hasMentions) {
    availableAssist.push('@ 文件');
  }
  if (hasComposerSlashCommand(input.input)) {
    usedAssist.push('/ 命令');
  }
  if (hasComposerMention(input.input)) {
    usedAssist.push('@ 文件');
  }

  return [
    'AI 对话输入优化',
    `目标场景：${modeLabel}`,
    `对话模式：${DIALOGUE_MODE_LABELS[input.dialogueMode]}`,
    `当前模型：${providerLabel} / ${modelLabel}`,
    `联网搜索：${input.webSearchEnabled ? '开启' : '关闭'}`,
    `思考模式：${thinkingLabel}`,
    `代理协作：${input.hasAgentOverride ? '已指定 Agent' : '跟随默认 Agent'}`,
    `附件数量：${input.attachmentCount}`,
    availableAssist.length > 0 ? `可用输入辅助：${availableAssist.join('、')}` : null,
    usedAssist.length > 0 ? `当前草稿已显式使用：${usedAssist.join('、')}` : null,
    input.imageGenerationMode
      ? `出图参数：${input.imageGenerationSize ?? '默认尺寸'} / ${input.imageGenerationQuality ?? '默认质量'} / ${input.imageGenerationOutputFormat ?? '默认格式'} / ${input.imageGenerationBackground ?? '默认背景'}`
      : null,
    input.imageGenerationMode
      ? `参考图片：${input.hasSelectedImageReference ? '已选择' : '未选择'}`
      : null,
    '保留用户原意，优先提升可执行性、上下文完整度与输出约束清晰度。',
  ]
    .filter((item): item is string => item !== null)
    .join('；');
}
