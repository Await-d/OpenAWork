import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../../theme/colors';
import { layoutSpacing } from '../../theme/spacing';
import { textPresets } from '../../theme/typography';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Large page title (28) with optional right action and muted subtitle. */
export function PageHeader({ title, subtitle, action, style }: PageHeaderProps) {
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.row}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {action}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: layoutSpacing.pageHorizontal,
    paddingTop: 8,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    ...textPresets.title,
    color: colors.textStrong,
    flexShrink: 1,
  },
  subtitle: {
    ...textPresets.bodySmall,
    color: colors.textMuted,
    marginBottom: 8,
  },
});
