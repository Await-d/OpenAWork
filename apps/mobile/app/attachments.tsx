import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, TextInput } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';

interface AssetItem {
  id: string;
  name: string;
  type: 'image' | 'file' | 'code';
  size: string;
  uri?: string;
}

const SOURCE_TABS = [
  { id: 'recent', label: '最近', icon: 'time-outline' as const },
  { id: 'gallery', label: '相册', icon: 'images-outline' as const },
  { id: 'files', label: '文件', icon: 'folder-outline' as const },
  { id: 'code', label: '代码', icon: 'code-slash-outline' as const },
];

const MOCK_ASSETS: AssetItem[] = [
  { id: '1', name: 'auth.ts', type: 'code', size: '2.4 KB' },
  { id: '2', name: 'screenshot.png', type: 'image', size: '340 KB' },
  { id: '3', name: 'README.md', type: 'file', size: '1.8 KB' },
  { id: '4', name: 'config.json', type: 'file', size: '512 B' },
  { id: '5', name: 'banner.jpg', type: 'image', size: '128 KB' },
];

const TYPE_ICONS: Record<AssetItem['type'], keyof typeof Ionicons.glyphMap> = {
  image: 'image-outline',
  file: 'document-outline',
  code: 'code-slash-outline',
};

const TYPE_COLORS: Record<AssetItem['type'], string> = {
  image: colors.contrast,
  file: colors.textMuted,
  code: colors.accent,
};

/** S12: 附件与素材选择 */
export default function AttachmentPickerScreen() {
  const [activeTab, setActiveTab] = useState('recent');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handlePickDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (!result.canceled) {
      // handle picked files
    }
  }

  async function handlePickImage() {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'image/*',
      copyToCacheDirectory: true,
    });
    if (!result.canceled) {
      // handle picked image
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={18} color={colors.textDefault} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>选择附件</Text>
        <Text style={styles.selectedCount}>{selected.size > 0 ? `已选 ${selected.size}` : ''}</Text>
      </View>

      {/* Search */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="搜索文件和素材…"
          placeholderTextColor={colors.textSubtle}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Source tabs */}
      <View style={styles.tabRow}>
        {SOURCE_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Ionicons
                name={tab.icon}
                size={14}
                color={isActive ? colors.accent : colors.textMuted}
              />
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Quick actions */}
      <View style={styles.quickRow}>
        <TouchableOpacity style={styles.quickBtn} onPress={() => void handlePickImage()}>
          <Ionicons name="camera-outline" size={18} color={colors.accent} />
          <Text style={styles.quickText}>拍照</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn} onPress={() => void handlePickDocument()}>
          <Ionicons name="document-attach-outline" size={18} color={colors.aux} />
          <Text style={styles.quickText}>浏览文件</Text>
        </TouchableOpacity>
      </View>

      {/* Asset list */}
      <FlatList
        data={MOCK_ASSETS.filter(
          (a) => !search.trim() || a.name.toLowerCase().includes(search.toLowerCase()),
        )}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const isSelected = selected.has(item.id);
          return (
            <TouchableOpacity
              style={[styles.assetCard, isSelected && styles.assetCardActive]}
              onPress={() => toggleSelect(item.id)}
              activeOpacity={0.7}
            >
              <View
                style={[styles.assetIconWrap, { backgroundColor: TYPE_COLORS[item.type] + '1A' }]}
              >
                <Ionicons name={TYPE_ICONS[item.type]} size={18} color={TYPE_COLORS[item.type]} />
              </View>
              <View style={styles.assetInfo}>
                <Text style={styles.assetName}>{item.name}</Text>
                <Text style={styles.assetSize}>{item.size}</Text>
              </View>
              <Ionicons
                name={isSelected ? 'checkbox' : 'square-outline'}
                size={20}
                color={isSelected ? colors.accent : colors.textSubtle}
              />
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...textPresets.cardTitle, color: colors.textStrong },
  selectedCount: { ...textPresets.label, color: colors.accent },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, ...textPresets.body, color: colors.textStrong, padding: 0 },

  tabRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tabActive: { backgroundColor: colors.accentMuted, borderColor: colors.accentBorder },
  tabText: { ...textPresets.caption, color: colors.textMuted, fontWeight: '600' },
  tabTextActive: { color: colors.accent },

  quickRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  quickBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
  },
  quickText: { ...textPresets.label, color: colors.textDefault },

  listContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 100 },
  assetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 12,
  },
  assetCardActive: { borderColor: colors.accentBorder, backgroundColor: colors.accentMuted },
  assetIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assetInfo: { flex: 1, gap: 2 },
  assetName: { ...textPresets.body, color: colors.textStrong, fontWeight: '600' },
  assetSize: { ...textPresets.caption, color: colors.textMuted },
});
