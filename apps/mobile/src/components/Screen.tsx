import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { useBottomNavContentInset } from '../layout/use-bottom-nav-inset';

export type ScreenEdges = Edge[];

export interface ScreenProps {
  children: ReactNode;
  /**
   * Safe-area edges to respect. Default keeps content clear of notch / status
   * bar / side cutouts. Bottom is usually handled by the floating nav or the
   * page's own composer.
   */
  edges?: ScreenEdges;
  /** Extra bottom padding for the floating bottom nav. */
  withBottomNav?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /** Override background; defaults to design-system base. */
  backgroundColor?: string;
}

/**
 * Page shell that applies device safe areas (notch / Dynamic Island / home
 * indicator) so full-screen layouts don't collide with system chrome.
 */
export function Screen({
  children,
  edges = ['top', 'left', 'right'],
  withBottomNav = false,
  style,
  contentStyle,
  backgroundColor = colors.bgBase,
}: ScreenProps) {
  const bottomNavInset = useBottomNavContentInset();

  return (
    <SafeAreaView edges={edges} style={[styles.safe, { backgroundColor }, style]}>
      <View
        style={[
          styles.content,
          withBottomNav ? { paddingBottom: bottomNavInset } : null,
          contentStyle,
        ]}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
