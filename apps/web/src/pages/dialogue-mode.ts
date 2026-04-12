import type { DialogueMode } from '@openAwork/shared';

export type { DialogueMode };

export interface DialogueModeOption {
  value: DialogueMode;
  label: string;
  description: string;
}

interface DialogueModeDefinition extends DialogueModeOption {
  defaultAgent?: string;
}

const DIALOGUE_MODE_DEFINITIONS = [
  {
    value: 'clarify',
    label: '澄清',
    description: '渐进式需求澄清与方案设计，只读分析项目、交互式提问，产出方案后交由编程模式实现。',
  },
  {
    value: 'coding',
    label: '编程',
    description: '更偏直接产出代码、命令和最小可运行实现，减少铺垫。',
    defaultAgent: 'sisyphus-junior',
  },
  {
    value: 'programmer',
    label: '程序员',
    description: '以工程协作视角处理实现、修改、调试和验证。',
    defaultAgent: 'hephaestus',
  },
] satisfies readonly DialogueModeDefinition[];

export const DIALOGUE_MODE_OPTIONS: DialogueModeOption[] = DIALOGUE_MODE_DEFINITIONS.map(
  ({ value, label, description }) => ({ value, label, description }),
);

function getDialogueModeDefinition(mode: DialogueMode): DialogueModeDefinition {
  const definition = DIALOGUE_MODE_DEFINITIONS.find((item) => item.value === mode);
  if (!definition) {
    throw new Error(`Unsupported dialogue mode: ${mode}`);
  }
  return definition;
}

export function getDefaultAgentForDialogueMode(mode: DialogueMode): string | undefined {
  return getDialogueModeDefinition(mode).defaultAgent;
}
