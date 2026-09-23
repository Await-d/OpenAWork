import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { radii } from '../theme/radii';
import { textPresets } from '../theme/typography';

export interface RollbackNoticeProps {
  onDismiss: () => void;
  /** 「查看变更」入口（跳转快照恢复页）；缺省时不渲染。 */
  onOpenSnapshots?: () => void;
  text: string;
}

/**
 * 回退 / 重新生成成功后的轻量提示条。
 *
 * 移动端没有全局 toast 设施：用一条在流内、可手动关闭的提示替代，
 * 既保证「回退不得静默完成」，也不打断正在进行的流式渲染。
 */
export function RollbackNotice({ onDismiss, onOpenSnapshots, text }: RollbackNoticeProps) {
  return (
    <View accessibilityRole="alert" style={styles.root}>
      <Text style={styles.text}>{text}</Text>
      <View style={styles.actions}>
        {onOpenSnapshots ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="查看变更"
            onPress={onOpenSnapshots}
            style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
          >
            <Text style={styles.actionText}>查看变更</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭回退提示"
          onPress={onDismiss}
          style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
        >
          <Text style={styles.dismissText}>关闭</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    backgroundColor: colors.surface1,
  },
  text: {
    ...textPresets.bodySmall,
    flex: 1,
    color: colors.textDefault,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  action: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  actionPressed: {
    backgroundColor: colors.accentMuted,
  },
  actionText: {
    ...textPresets.label,
    color: colors.accent,
  },
  dismissText: {
    ...textPresets.label,
    color: colors.textMuted,
  },
});
