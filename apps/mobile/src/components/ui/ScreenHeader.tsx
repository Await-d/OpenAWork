import type { ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '../../theme/colors';
import { textPresets } from '../../theme/typography';

export interface ScreenHeaderProps {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
  showBack?: boolean;
}

/** Compact back + title + optional right action used by chat side screens. */
export function ScreenHeader({ title, onBack, right, style, showBack = true }: ScreenHeaderProps) {
  return (
    <View style={[styles.row, style]}>
      {showBack ? (
        <TouchableOpacity
          onPress={onBack ?? (() => router.back())}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="返回"
        >
          <Ionicons name="arrow-back" size={18} color={colors.textDefault} />
        </TouchableOpacity>
      ) : (
        <View style={styles.backBtn} />
      )}
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.right}>{right ?? <View style={styles.backBtn} />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...textPresets.cardTitle,
    color: colors.textStrong,
    flex: 1,
    textAlign: 'center',
  },
  right: {
    minWidth: 36,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
