export type DialogueMode = 'clarify' | 'coding' | 'programmer';

export interface DialogueModeOption {
  value: DialogueMode;
  label: string;
  description: string;
}

export const DIALOGUE_MODE_OPTIONS: DialogueModeOption[] = [
  {
    value: 'clarify',
    label: '澄清',
    description: '先识别目标和约束，必要时优先补充问题与边界。',
  },
  {
    value: 'coding',
    label: '编程',
    description: '更偏直接产出代码与示例，快速进入编写阶段。',
  },
  {
    value: 'programmer',
    label: '程序员',
    description: '直接站在程序员视角，优先给实现、修改、调试和代码建议。',
  },
];

export function buildDialogueModePrompt(mode: DialogueMode): string {
  switch (mode) {
    case 'clarify':
      return [
        '【对话模式：澄清】',
        '如果用户目标、约束、环境或验收条件不清晰，请先澄清关键缺口，再给出后续建议。',
        '优先帮助用户厘清问题，而不是直接跳到实现。',
      ].join('\n');
    case 'programmer':
      return [
        '【对话模式：程序员】',
        '请以程序员协作模式回答，优先给出实现思路、代码修改建议、调试步骤和可执行方案。',
        '默认面向工程实现，不必先做泛泛解释。',
      ].join('\n');
    case 'coding':
      return [
        '【对话模式：编程】',
        '请优先直接给出代码、函数、命令、脚本或最小可运行实现。',
        '除非必要，不要先给大段泛化背景。',
      ].join('\n');
    default:
      return '';
  }
}

export function applyDialogueModeToMessage(mode: DialogueMode, text: string): string {
  const prompt = buildDialogueModePrompt(mode);
  return prompt ? `${prompt}\n\n${text}` : text;
}

export function buildYoloModePrompt(enabled: boolean): string {
  if (!enabled) {
    return '';
  }
  return ['【YOLO 模式】', '优先少确认、快执行、直达结果；除非明显缺信息，否则不要反复征询。'].join(
    '\n',
  );
}

export function applyChatModesToMessage(
  dialogueMode: DialogueMode,
  yoloMode: boolean,
  text: string,
): string {
  const parts = [buildDialogueModePrompt(dialogueMode), buildYoloModePrompt(yoloMode)].filter(
    Boolean,
  );
  return parts.length > 0 ? `${parts.join('\n\n')}\n\n${text}` : text;
}
