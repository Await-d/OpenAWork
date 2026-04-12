import { useState } from 'react';
import type { DialogueMode } from '@openAwork/shared';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TouchableWithoutFeedback,
} from 'react-native';

export type { DialogueMode };

interface DialogueModeDefinition {
  value: DialogueMode;
  label: string;
  icon: string;
  desc: string;
}

const DIALOGUE_MODE_DEFINITIONS = [
  {
    value: 'clarify',
    label: '澄清',
    icon: '◎',
    desc: '渐进式需求澄清与方案设计，只读分析、交互式提问',
  },
  {
    value: 'coding',
    label: '编程',
    icon: '⟨/⟩',
    desc: '优先直接产出代码、命令和最小可运行实现',
  },
  {
    value: 'programmer',
    label: '程序员',
    icon: '⌨',
    desc: '以工程协作视角处理实现、修改、调试和验证',
  },
] satisfies readonly DialogueModeDefinition[];

export const DIALOGUE_MODES: { value: DialogueMode; label: string; icon: string; desc: string }[] =
  DIALOGUE_MODE_DEFINITIONS.map(({ value, label, icon, desc }) => ({ value, label, icon, desc }));

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
