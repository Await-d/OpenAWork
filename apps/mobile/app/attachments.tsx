import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { createArtifactsClient, createSessionsClient } from '@openAwork/web-client';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';
import { useAuthStore } from '../src/store/auth';

interface AssetItem {
  id: string;
  name: string;
  type: 'image' | 'file' | 'code';
  size: string;
  sessionId?: string;
}

const SOURCE_TABS = [
  { id: 'recent', label: '最近', icon: 'time-outline' as const },
  { id: 'gallery', label: '相册', icon: 'images-outline' as const },
  { id: 'files', label: '文件', icon: 'folder-outline' as const },
  { id: 'code', label: '代码', icon: 'code-slash-outline' as const },
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

function inferAssetType(name: string): AssetItem['type'] {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp' || ext === 'gif') {
    return 'image';
  }
  if (
    ext === 'ts' ||
    ext === 'tsx' ||
    ext === 'js' ||
    ext === 'jsx' ||
    ext === 'py' ||
    ext === 'go' ||
    ext === 'rs'
  ) {
    return 'code';
  }
  return 'file';
}

function formatSize(bytes: unknown): string {
  if (typeof bytes === 'number' && bytes > 0) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return '—';
}

/** S12: 附件与素材选择 */
export default function AttachmentPickerScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const { accessToken, gatewayUrl } = useAuthStore();
  const [activeTab, setActiveTab] = useState('recent');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const loadAssets = useCallback(async () => {
    if (!accessToken || !gatewayUrl) {
      setLoading(false);
      return;
    }
    try {
      const sessionsClient = createSessionsClient(gatewayUrl);
      const sessions = await sessionsClient.list(accessToken, { excludeTeam: true });
      const artifactsClient = createArtifactsClient(gatewayUrl);
      const recentSessions = sessions.slice(0, 10);
      const results = await Promise.all(
        recentSessions.map(async (s) => {
          try {
            const resp = await artifactsClient.listForSession(accessToken, s.id);
            const rawArtifacts = resp.contentArtifacts ?? [];
            return rawArtifacts.map((raw): AssetItem => {
              const rec = raw;
              const name = (rec['title'] as string) ?? (rec['name'] as string) ?? '未命名';
              return {
                id: (rec['id'] as string) ?? `${s.id}-${name}`,
                name,
                type: inferAssetType(name),
                size: formatSize(rec['sizeBytes'] ?? rec['size']),
                sessionId: s.id,
              };
            });
          } catch {
            return [];
          }
        }),
      );
      setAssets(results.flat().slice(0, 50));
    } catch {
      // 静默处理——空列表即可
    } finally {
      setLoading(false);
    }
  }, [accessToken, gatewayUrl]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function readFileAsBase64(uri: string): Promise<string> {
    const result = await FileSystem.readAsStringAsync(uri, {
      encoding: 'base64' as const,
    });
    return result;
  }

  async function handlePickDocument() {
    if (!accessToken || !gatewayUrl || !sessionId) {
      // 没有关联会话时，仅打开文件选择器并导航回聊天
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        router.back();
      }
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets) return;

    setUploading(true);
    try {
      const artifactsClient = createArtifactsClient(gatewayUrl);
      for (const asset of result.assets) {
        const base64 = await readFileAsBase64(asset.uri);
        await artifactsClient.uploadToSession(accessToken, sessionId, {
          name: asset.name,
          mimeType: asset.mimeType,
          sizeBytes: asset.size,
          contentBase64: base64,
        });
      }
      Alert.alert('成功', `已上传 ${result.assets.length} 个文件`);
      await loadAssets();
    } catch (err) {
      Alert.alert('上传失败', err instanceof Error ? err.message : '请稍后重试');
    } finally {
      setUploading(false);
    }
  }

  async function handlePickImage() {
    if (!accessToken || !gatewayUrl || !sessionId) {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        router.back();
      }
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      type: 'image/*',
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets) return;

    setUploading(true);
    try {
      const artifactsClient = createArtifactsClient(gatewayUrl);
      for (const asset of result.assets) {
        const base64 = await readFileAsBase64(asset.uri);
        await artifactsClient.uploadToSession(accessToken, sessionId, {
          name: asset.name,
          mimeType: asset.mimeType,
          sizeBytes: asset.size,
          contentBase64: base64,
        });
      }
      Alert.alert('成功', `已上传 ${result.assets.length} 张图片`);
      await loadAssets();
    } catch (err) {
      Alert.alert('上传失败', err instanceof Error ? err.message : '请稍后重试');
    } finally {
      setUploading(false);
    }
  }

  const filteredAssets = assets.filter(
    (a) => !search.trim() || a.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Screen>
      <ScreenHeader
        title="选择附件"
        right={
          <Text style={styles.selectedCount}>
            {selected.size > 0 ? `已选 ${selected.size}` : ''}
          </Text>
        }
      />

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
        <TouchableOpacity
          style={styles.quickBtn}
          onPress={() => void handlePickImage()}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <>
              <Ionicons name="camera-outline" size={18} color={colors.accent} />
              <Text style={styles.quickText}>拍照</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickBtn}
          onPress={() => void handlePickDocument()}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator color={colors.aux} size="small" />
          ) : (
            <>
              <Ionicons name="document-attach-outline" size={18} color={colors.aux} />
              <Text style={styles.quickText}>浏览文件</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Asset list */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>加载中…</Text>
        </View>
      ) : (
        <FlatList
          data={filteredAssets}
          keyExtractor={(a) => a.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="attach-outline" size={40} color={colors.textSubtle} />
              <Text style={styles.emptyTitle}>暂无附件</Text>
              <Text style={styles.emptyDesc}>通过拍照或浏览文件上传附件</Text>
            </View>
          }
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
      )}
    </Screen>
  );
}

// 需要导入 useLocalSearchParams 和 Alert — 已在文件顶部导入

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
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

  loadingBox: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  loadingText: { ...textPresets.caption, color: colors.textMuted },

  emptyBox: { alignItems: 'center', gap: 8, paddingTop: 40 },
  emptyTitle: { ...textPresets.subheading, color: colors.textStrong },
  emptyDesc: { ...textPresets.body, color: colors.textMuted, textAlign: 'center' },

  listContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 32 },
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
