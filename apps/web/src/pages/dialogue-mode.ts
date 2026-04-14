import type { DialogueMode } from '@openAwork/shared';

export type { DialogueMode };

export interface DialogueModeOption {
  value: DialogueMode;
  label: string;
  description: string;
  details: readonly string[];
}

interface DialogueModeDefinition extends DialogueModeOption {
  defaultAgent?: string;
}

const DIALOGUE_MODE_DEFINITIONS = [
  {
    value: 'clarify',
    label: '澄清',
    description: '渐进式需求澄清与方案设计',
    details: [
      '只读分析项目现状，不修改任何代码',
      '通过交互式提问消除需求歧义',
      '定位影响范围，梳理涉及模块与接口',
      '产出可执行的方案文档（目标、约束、步骤、风险）',
      '方案完成后交由编程或程序员模式实现',
    ] as const,
  },
  {
    value: 'coding',
    label: '编程',
    description: '快速实现，产出最小可运行结果',
    details: [
      '先读后写，修改前必须先读相关代码',
      '最小变更优先，不做附带重构',
      '假设显式化，不默默假设并继续',
      '修改后执行测试或构建验证',
      '说明尽量短，代码优先',
    ] as const,
    defaultAgent: 'sisyphus-junior',
  },
  {
    value: 'programmer',
    label: '程序员',
    description: '工程协作，以软件工程最佳实践为准则',
    details: [
      '理解优先，动手前充分理解现有代码结构与调用链',
      '影响面驱动，任何修改必须先评估影响范围',
      '渐进式实现，大改动拆分为可验证的小步骤',
      '验证闭环，每步实现后必须有测试 / lint / 构建验证',
      '风险前置，提前识别兼容性、性能、安全风险',
    ] as const,
    defaultAgent: 'hephaestus',
  },
] satisfies readonly DialogueModeDefinition[];

export const DIALOGUE_MODE_OPTIONS: DialogueModeOption[] = DIALOGUE_MODE_DEFINITIONS.map(
  ({ value, label, description, details }) => ({ value, label, description, details }),
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
