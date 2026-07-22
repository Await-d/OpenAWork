import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { radii } from '../theme/radii';
import { textPresets } from '../theme/typography';

interface UserMessageActionsProps {
  visible: string | null;
  onDismiss: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onResend: () => void;
}

/** S22: 用户消息操作 — 长按弹出的操作菜单 */
export function UserMessageActions({
  visible,
  onDismiss,
  onCopy,
  onEdit,
  onResend,
}: UserMessageActionsProps) {
  if (!visible) return null;

  const actions = [
    {
      icon: 'copy-outline' as const,
      label: '复制文本',
      color: colors.textDefault,
      onPress: onCopy,
    },
    {
      icon: 'create-outline' as const,
      label: '编辑并重新发送',
      color: colors.accent,
      onPress: onEdit,
    },
    { icon: 'send-outline' as const, label: '再次发送', color: colors.aux, onPress: onResend },
  ];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onDismiss}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onDismiss}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>用户消息</Text>
          {actions.map((a) => (
            <TouchableOpacity
              key={a.label}
              style={styles.actionRow}
              onPress={() => {
                a.onPress();
                onDismiss();
              }}
            >
              <Ionicons name={a.icon} size={20} color={a.color} />
              <Text style={styles.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.cancelBtn} onPress={onDismiss}>
            <Text style={styles.cancelText}>取消</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: 16,
    paddingBottom: 32,
    gap: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineDefault,
    alignSelf: 'center',
    marginBottom: 8,
  },
  title: { ...textPresets.subheading, color: colors.textStrong, marginBottom: 8 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 44,
    paddingHorizontal: 4,
  },
  actionLabel: { ...textPresets.body, color: colors.textStrong },
  cancelBtn: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.lineDefault,
  },
  cancelText: { ...textPresets.body, color: colors.textMuted },
});
