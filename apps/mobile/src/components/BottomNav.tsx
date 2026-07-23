import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { radii } from '../theme/radii';
import { textPresets } from '../theme/typography';
import {
  BOTTOM_NAV_BAR_HEIGHT,
  BOTTOM_NAV_OUTER_MARGIN,
  MIN_HOME_INDICATOR_INSET,
} from '../layout/metrics';

export type BottomNavTab = 'home' | 'sessions' | 'settings';

interface BottomNavProps {
  active: BottomNavTab;
  onNavigate: (tab: BottomNavTab) => void;
}

const TABS: Array<{
  key: BottomNavTab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
}> = [
  { key: 'home', label: '首页', icon: 'home-outline', iconActive: 'home' },
  { key: 'sessions', label: '会话', icon: 'mail-outline', iconActive: 'mail' },
  { key: 'settings', label: '设置', icon: 'settings-outline', iconActive: 'settings' },
];

export function BottomNav({ active, onNavigate }: BottomNavProps) {
  const insets = useSafeAreaInsets();
  const bottomOffset = Math.max(insets.bottom, MIN_HOME_INDICATOR_INSET) + BOTTOM_NAV_OUTER_MARGIN;

  return (
    <View pointerEvents="box-none" style={[styles.wrapper, { bottom: bottomOffset }]}>
      <View style={styles.container}>
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.tab}
              onPress={() => onNavigate(tab.key)}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <Ionicons
                name={isActive ? tab.iconActive : tab.icon}
                size={20}
                color={isActive ? colors.accent : colors.textSubtle}
              />
              <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 20,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    height: BOTTOM_NAV_BAR_HEIGHT,
    backgroundColor: colors.surface1,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingHorizontal: 24,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minWidth: 60,
  },
  label: {
    ...textPresets.caption,
    color: colors.textMuted,
    fontWeight: '500',
  },
  labelActive: {
    color: colors.accent,
    fontWeight: '600',
  },
});
