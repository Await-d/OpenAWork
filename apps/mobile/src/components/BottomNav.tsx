import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { radii } from '../theme/radii';
import { textPresets } from '../theme/typography';

export type BottomNavTab = 'sessions' | 'chat' | 'settings';

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
  { key: 'sessions', label: '会话', icon: 'mail-outline', iconActive: 'mail' },
  { key: 'chat', label: 'Chat', icon: 'chatbubble-outline', iconActive: 'chatbubble' },
  { key: 'settings', label: '设置', icon: 'settings-outline', iconActive: 'settings' },
];

export function BottomNav({ active, onNavigate }: BottomNavProps) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.container}>
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.tab}
              onPress={() => onNavigate(tab.key)}
              activeOpacity={0.7}
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
    bottom: 16,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    height: 60,
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
