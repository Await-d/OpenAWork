import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

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
        placeholderTextColor="#64748b"
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
    borderBottomColor: '#1e293b',
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    minHeight: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#020617',
    color: '#f8fafc',
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchCount: { minWidth: 52, color: '#94a3b8', fontSize: 11, textAlign: 'center' },
  searchNavButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#1e293b',
  },
  searchNavButtonDisabled: { opacity: 0.38 },
  searchNavText: { color: '#e2e8f0', fontSize: 14, fontWeight: '800' },
  closeText: { color: '#818cf8', fontSize: 12, fontWeight: '700' },
});
