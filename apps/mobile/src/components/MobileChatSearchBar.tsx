import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme/colors';
import { radii } from '../theme/radii';

interface MobileChatSearchBarProps {
  activePosition: number;
  matchCount: number;
  query: string;
  onChangeQuery: (query: string) => void;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
}

export function MobileChatSearchBar({
  activePosition,
  matchCount,
  query,
  onChangeQuery,
  onClose,
  onNext,
  onPrevious,
}: MobileChatSearchBarProps) {
  const countLabel = query.trim()
    ? matchCount > 0
      ? `${activePosition + 1}/${matchCount}`
      : '无结果'
    : '输入关键词';

  return (
    <View style={styles.searchBar}>
      <TextInput
        style={styles.searchInput}
        value={query}
        onChangeText={onChangeQuery}
        placeholder="搜索当前对话…"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.searchCount}>{countLabel}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="上一个搜索结果"
        disabled={matchCount === 0}
        onPress={onPrevious}
        style={[styles.searchNavButton, matchCount === 0 && styles.searchNavButtonDisabled]}
      >
        <Text style={styles.searchNavText}>↑</Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="下一个搜索结果"
        disabled={matchCount === 0}
        onPress={onNext}
        style={[styles.searchNavButton, matchCount === 0 && styles.searchNavButtonDisabled]}
      >
        <Text style={styles.searchNavText}>↓</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="关闭搜索" onPress={onClose}>
        <Text style={styles.closeText}>关闭</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSubtle,
    backgroundColor: colors.bgBase,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    minHeight: 36,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    backgroundColor: colors.surface1,
    color: colors.textStrong,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchCount: { minWidth: 52, color: colors.textMuted, fontSize: 11, textAlign: 'center' },
  searchNavButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.lineDefault,
  },
  searchNavButtonDisabled: { opacity: 0.38 },
  searchNavText: { color: colors.textDefault, fontSize: 14, fontWeight: '800' },
  closeText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
});
