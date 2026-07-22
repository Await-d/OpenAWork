import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { radii } from '../theme/radii';
import { textPresets } from '../theme/typography';

interface AssistantMessageActionsProps {
  visible: boolean;
  onDismiss: () => void;
  onCopy: () => void;
  onRetry: () => void;
  onShare: () => void;
}

/** S16: 助手消息操作 — 长按弹出的操作菜单 */
export function AssistantMessageActions({
  visible,
  onDismiss,
  onCopy,
  onRetry,
  onShare,
}: AssistantMessageActionsProps) {
  const actions = [
    {
      icon: 'copy-outline' as const,
      label: '复制文本',
      color: colors.textDefault,
      onPress: onCopy,
    },
    { icon: 'refresh-outline' as const, label: '重新生成', color: colors.accent, onPress: onRetry },
    { icon: 'share-outline' as const, label: '分享', color: colors.aux, onPress: onShare },
    {
      icon: 'bookmark-outline' as const,
      label: '收藏',
      color: colors.contrast,
      onPress: onDismiss,
    },
    {
      icon: 'code-slash-outline' as const,
      label: '查看代码',
      color: colors.textMuted,
      onPress: onDismiss,
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onDismiss}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>助手回复</Text>
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
