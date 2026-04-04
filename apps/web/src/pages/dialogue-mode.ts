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
    description: '先基于已知事实厘清目标、约束和验收条件，再进入方案或实现。',
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
