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
import { textPresets } from '../../theme/typography';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  minHeight?: number;
  disabled?: boolean;
}

/** Icon + title/meta + trailing row used in lists and settings cards. */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  style,
  minHeight = 54,
  disabled,
}: ListRowProps) {
  const content = (
    <View style={[styles.row, { minHeight }, style]}>
      {leading}
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    ...textPresets.cardTitle,
    color: colors.textStrong,
  },
  subtitle: {
    ...textPresets.cardDescription,
    color: colors.textMuted,
  },
});
