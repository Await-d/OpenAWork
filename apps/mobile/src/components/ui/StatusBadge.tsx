import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../../theme/colors';
import { radii } from '../../theme/radii';
import { textPresets } from '../../theme/typography';

export type StatusBadgeTone =
  'running' | 'draft' | 'done' | 'success' | 'warning' | 'danger' | 'muted';

const TONE: Record<StatusBadgeTone, { bg: string; border: string; text: string; label: string }> = {
  running: {
    bg: colors.successMuted,
    border: colors.successBorder,
    text: colors.success,
    label: '运行中',
  },
  draft: {
    bg: colors.surface2,
    border: colors.lineDefault,
    text: colors.textMuted,
    label: '草稿',
  },
  done: {
    bg: colors.auxMuted,
    border: colors.auxBorder,
    text: colors.aux,
    label: '完成',
  },
  success: {
    bg: colors.successMuted,
    border: colors.successBorder,
    text: colors.success,
    label: '成功',
  },
  warning: {
    bg: colors.warningMuted,
    border: colors.warningBorder,
    text: colors.warning,
    label: '警告',
  },
  danger: {
    bg: colors.dangerMuted,
    border: colors.dangerBorder,
    text: colors.danger,
    label: '错误',
  },
  muted: {
    bg: colors.surface2,
    border: colors.lineDefault,
    text: colors.textMuted,
    label: '',
  },
};

export interface StatusBadgeProps {
  tone?: StatusBadgeTone;
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function StatusBadge({ tone = 'muted', label, style }: StatusBadgeProps) {
  const t = TONE[tone];
  const text = label ?? t.label;
  if (!text) return null;
  return (
    <View style={[styles.badge, { backgroundColor: t.bg, borderColor: t.border }, style]}>
      <Text style={[styles.text, { color: t.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  text: {
    ...textPresets.caption,
    fontWeight: '600',
  },
});
