import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../../theme/colors';
import { radii } from '../../theme/radii';
import { textPresets } from '../../theme/typography';

export type ChipTone = 'default' | 'accent' | 'aux' | 'contrast' | 'success' | 'danger';

const TONE: Record<
  ChipTone,
  {
    bg: string;
    border: string;
    text: string;
    activeBg: string;
    activeBorder: string;
    activeText: string;
  }
> = {
  default: {
    bg: colors.surface2,
    border: colors.lineDefault,
    text: colors.textMuted,
    activeBg: colors.surface2,
    activeBorder: colors.lineDefault,
    activeText: colors.textDefault,
  },
  accent: {
    bg: colors.surface2,
    border: colors.lineDefault,
    text: colors.textMuted,
    activeBg: colors.accentMuted,
    activeBorder: colors.accentBorder,
    activeText: colors.accent,
  },
  aux: {
    bg: colors.surface2,
    border: colors.lineDefault,
    text: colors.textMuted,
    activeBg: colors.auxMuted,
    activeBorder: colors.auxBorder,
    activeText: colors.aux,
  },
  contrast: {
    bg: colors.surface2,
    border: colors.lineDefault,
    text: colors.textMuted,
    activeBg: colors.contrastMuted,
    activeBorder: colors.contrastBorder,
    activeText: colors.contrast,
  },
  success: {
    bg: colors.surface2,
    border: colors.lineDefault,
    text: colors.textMuted,
    activeBg: colors.successMuted,
    activeBorder: colors.successBorder,
    activeText: colors.success,
  },
  danger: {
    bg: colors.surface2,
    border: colors.lineDefault,
    text: colors.textMuted,
    activeBg: colors.dangerMuted,
    activeBorder: colors.dangerBorder,
    activeText: colors.danger,
  },
};

export interface ChipProps {
  label: string;
  selected?: boolean;
  tone?: ChipTone;
  onPress?: () => void;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

/** Pill chip for filters and quick actions. */
export function Chip({
  label,
  selected = false,
  tone = 'accent',
  onPress,
  icon,
  style,
  disabled,
}: ChipProps) {
  const t = TONE[tone];
  return (
    <TouchableOpacity
      style={[
        styles.chip,
        {
          backgroundColor: selected ? t.activeBg : t.bg,
          borderColor: selected ? t.activeBorder : t.border,
        },
        disabled ? styles.disabled : null,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || !onPress}
      activeOpacity={0.7}
    >
      {icon}
      <Text style={[styles.label, { color: selected ? t.activeText : t.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  label: {
    ...textPresets.caption,
    fontWeight: '600',
  },
  disabled: { opacity: 0.45 },
});
