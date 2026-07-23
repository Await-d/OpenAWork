import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { radii } from '../../theme/radii';
import { textPresets } from '../../theme/typography';

export interface HintCardProps {
  text: string;
  icon?: keyof typeof Ionicons.glyphMap;
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Soft footer / tip strip. */
export function HintCard({ text, icon = 'time-outline', trailing, style }: HintCardProps) {
  return (
    <View style={[styles.card, style]}>
      <Ionicons name={icon} size={17} color={colors.textMuted} />
      <Text style={styles.text}>{text}</Text>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    backgroundColor: colors.surfaceSoft,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineSubtle,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  text: {
    ...textPresets.bodySmall,
    color: colors.textMuted,
    flex: 1,
  },
});
