import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TouchableWithoutFeedback,
} from 'react-native';

export type DialogueMode = 'clarify' | 'coding' | 'programmer';

export const DIALOGUE_MODES: { value: DialogueMode; label: string; icon: string; desc: string }[] =
  [
    { value: 'clarify', label: '澄清', icon: '◎', desc: '先识别目标和约束，优先补充问题与边界' },
    { value: 'coding', label: '编程', icon: '⟨/⟩', desc: '优先直接给出代码、函数和最小可运行实现' },
    {
      value: 'programmer',
      label: '程序员',
      icon: '⌨',
      desc: '以程序员协作模式，优先给实现思路和代码建议',
    },
  ];

export function buildDialogueModePrompt(mode: DialogueMode): string {
  switch (mode) {
    case 'clarify':
      return '【对话模式：澄清】\n如果用户目标、约束、环境或验收条件不清晰，请先澄清关键缺口，再给出后续建议。\n优先帮助用户厘清问题，而不是直接跳到实现。';
    case 'programmer':
      return '【对话模式：程序员】\n请以程序员协作模式回答，优先给出实现思路、代码修改建议、调试步骤和可执行方案。\n默认面向工程实现，不必先做泛泛解释。';
    case 'coding':
      return '【对话模式：编程】\n请优先直接给出代码、函数、命令、脚本或最小可运行实现。\n除非必要，不要先给大段泛化背景。';
    default:
      return '';
  }
}

export function applyDialogueModeToMessage(mode: DialogueMode, text: string): string {
  const prompt = buildDialogueModePrompt(mode);
  return prompt ? `${prompt}\n\n${text}` : text;
}

interface DialogueModeSelectorProps {
  mode: DialogueMode;
  onChange: (mode: DialogueMode) => void;
}

const MODE_COLOR: Record<DialogueMode, string> = {
  clarify: '#6366f1',
  coding: '#10b981',
  programmer: '#3b82f6',
};

export function DialogueModeSelector({ mode, onChange }: DialogueModeSelectorProps) {
  const [visible, setVisible] = useState(false);
  const current =
    DIALOGUE_MODES.find((m) => m.value === mode) ??
    (DIALOGUE_MODES[0] as NonNullable<(typeof DIALOGUE_MODES)[number]>);
  const color = MODE_COLOR[mode] ?? '#6366f1';

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, { borderColor: `${color}60`, backgroundColor: `${color}14` }]}
        onPress={() => setVisible(true)}
      >
        <Text style={[styles.triggerIcon, { color }]}>{current.icon}</Text>
        <Text style={[styles.triggerLabel, { color }]}>{current.label}</Text>
        <Text style={[styles.triggerChevron, { color }]}>▾</Text>
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setVisible(false)}>
          <View style={styles.overlay} />
        </TouchableWithoutFeedback>
        <View style={styles.popover}>
          <Text style={styles.popoverTitle}>对话模式</Text>
          {DIALOGUE_MODES.map((m) => {
            const mc = MODE_COLOR[m.value];
            const selected = m.value === mode;
            return (
              <TouchableOpacity
                key={m.value}
                style={[styles.option, selected && { borderColor: mc, backgroundColor: `${mc}12` }]}
                onPress={() => {
                  onChange(m.value);
                  setVisible(false);
                }}
              >
                <View style={[styles.optionIcon, { backgroundColor: `${mc}20` }]}>
                  <Text style={[styles.optionIconText, { color: mc }]}>{m.icon}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optionLabel, selected && { color: mc }]}>{m.label}</Text>
                  <Text style={styles.optionDesc}>{m.desc}</Text>
                </View>
                {selected ? <Text style={[styles.check, { color: mc }]}>✓</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 4,
  },
  triggerIcon: { fontSize: 11 },
  triggerLabel: { fontSize: 11, fontWeight: '700' },
  triggerChevron: { fontSize: 9 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  popover: {
    position: 'absolute',
    bottom: 80,
    left: 12,
    right: 12,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 12,
    gap: 8,
  },
  popoverTitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  optionIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconText: { fontSize: 12, fontWeight: '700' },
  optionLabel: { color: '#e2e8f0', fontSize: 13, fontWeight: '600' },
  optionDesc: { color: '#64748b', fontSize: 11, marginTop: 1, lineHeight: 15 },
  check: { fontSize: 16, fontWeight: '700' },
});
