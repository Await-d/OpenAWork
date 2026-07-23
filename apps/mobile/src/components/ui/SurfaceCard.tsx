import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../../theme/colors';
import { radii } from '../../theme/radii';
import { layoutSpacing } from '../../theme/spacing';

export type SurfaceCardVariant = 'default' | 'soft' | 'accent' | 'aux' | 'transparent';

const VARIANT: Record<SurfaceCardVariant, { bg: string; border: string }> = {
  default: { bg: colors.surface1, border: colors.lineDefault },
  soft: { bg: colors.surfaceSoft, border: colors.lineSubtle },
  accent: { bg: colors.accentMuted, border: colors.accentBorder },
  aux: { bg: colors.auxMuted, border: colors.auxBorder },
  transparent: { bg: colors.transparent, border: colors.lineSubtle },
};

export interface SurfaceCardProps {
  children: ReactNode;
  variant?: SurfaceCardVariant;
  radius?: 'md' | 'lg' | 'xl' | 'pill';
  padding?: number;
  style?: StyleProp<ViewStyle>;
}

/** White / soft / accent surface card with pen border language. */
export function SurfaceCard({
  children,
  variant = 'default',
  radius = 'md',
  padding = layoutSpacing.cardPadding,
  style,
}: SurfaceCardProps) {
  const v = VARIANT[variant];
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: v.bg,
          borderColor: v.border,
          borderRadius: radii[radius],
          padding,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
  },
});
