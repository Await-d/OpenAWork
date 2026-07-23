import type { ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors } from '../../theme/colors';
import { layoutSpacing } from '../../theme/spacing';
import { textPresets } from '../../theme/typography';

export interface SectionLabelProps {
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
  inset?: boolean;
}

/** Section title row with optional manage action. */
export function SectionLabel({
  title,
  actionLabel,
  onActionPress,
  action,
  style,
  inset = true,
}: SectionLabelProps) {
  return (
    <View style={[styles.row, inset ? styles.inset : null, style]}>
      <Text style={styles.title}>{title}</Text>
      {action}
      {!action && actionLabel ? (
        <TouchableOpacity onPress={onActionPress} activeOpacity={0.7}>
          <Text style={styles.action}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  inset: {
    paddingHorizontal: layoutSpacing.pageHorizontal,
  },
  title: {
    ...textPresets.subheading,
    color: colors.textStrong,
  },
  action: {
    ...textPresets.label,
    color: colors.accent,
  },
});
