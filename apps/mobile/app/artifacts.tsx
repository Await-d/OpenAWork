import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createArtifactsClient, createSessionsClient } from '@openAwork/web-client';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';
import { useAuthStore } from '../src/store/auth';

interface ArtifactItem {
  id: string;
  name: string;
  type: 'code' | 'image' | 'file' | 'html';
  size: string;
  time: string;
}

const TYPE_ICONS: Record<ArtifactItem['type'], keyof typeof Ionicons.glyphMap> = {
  code: 'code-slash-outline',
  image: 'image-outline',
  html: 'globe-outline',
  file: 'document-outline',
};

const TYPE_COLORS: Record<ArtifactItem['type'], string> = {
  code: colors.accent,
  image: colors.contrast,
  html: colors.aux,
  file: colors.textMuted,
};

function inferArtifactType(name: string, rawType: unknown): ArtifactItem['type'] {
  if (typeof rawType === 'string') {
    if (rawType.includes('image') || rawType.includes('png') || rawType.includes('jpeg')) {
      return 'image';
    }
    if (rawType.includes('html')) return 'html';
    if (rawType.includes('code') || rawType.includes('text')) return 'code';
  }
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp' || ext === 'gif') {
    return 'image';
  }
  if (ext === 'html' || ext === 'htm') return 'html';
  if (
    ext === 'ts' ||
    ext === 'tsx' ||
    ext === 'js' ||
    ext === 'jsx' ||
    ext === 'py' ||
    ext === 'go' ||
    ext === 'rs' ||
    ext === 'java'
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

function formatTime(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    const date = new Date(value);
    const diff = Date.now() - date.getTime();
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return `${Math.floor(diff / 86_400_000)} 天前`;
  }
  return '—';
}

/** S24: 浏览器与产物预览 */
export default function ArtifactPreviewScreen() {
  const { accessToken, gatewayUrl } = useAuthStore();
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadArtifacts = useCallback(async () => {
    if (!accessToken || !gatewayUrl) {
      setError('请先登录并连接网关');
      setLoading(false);
      return;
    }
    setError(null);
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
            return rawArtifacts.map((raw): ArtifactItem => {
              const rec = raw;
              const name = (rec['title'] as string) ?? (rec['name'] as string) ?? '未命名';
              return {
                id: (rec['id'] as string) ?? `${s.id}-${name}`,
                name,
                type: inferArtifactType(name, rec['type']),
                size: formatSize(rec['sizeBytes'] ?? rec['size']),
                time: formatTime(rec['createdAt'] ?? rec['updatedAt']),
              };
            });
          } catch {
            return [];
          }
        }),
      );
      const merged = results.flat().slice(0, 50);
      setArtifacts(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载产物列表失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken, gatewayUrl]);

  useEffect(() => {
    void loadArtifacts();
  }, [loadArtifacts]);

  return (
    <Screen>
      <ScreenHeader
        title="产物预览"
        right={
          <TouchableOpacity
            style={styles.headerAction}
            onPress={() => {
              setRefreshing(true);
              void loadArtifacts();
            }}
          >
            <Ionicons name="refresh-outline" size={18} color={colors.aux} />
          </TouchableOpacity>
        }
      />

      {/* Preview area */}
      <View style={styles.previewArea}>
        {selectedId ? (
          (() => {
            const item = artifacts.find((a) => a.id === selectedId);
            return item ? (
              <>
                <Ionicons name={TYPE_ICONS[item.type]} size={48} color={TYPE_COLORS[item.type]} />
                <Text style={styles.previewName}>{item.name}</Text>
                <Text style={styles.previewMeta}>
                  {item.size} · {item.time}
                </Text>
              </>
            ) : null;
          })()
        ) : (
          <>
            <Ionicons name="document-outline" size={48} color={colors.textSubtle} />
            <Text style={styles.previewHint}>选择一个产物查看预览</Text>
          </>
        )}
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryLink}
            onPress={() => {
              setLoading(true);
              void loadArtifacts();
            }}
          >
            <Text style={styles.retryLinkText}>重试</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>加载中…</Text>
        </View>
      ) : null}

      {/* Artifact list */}
      {!loading && !error ? (
        <>
          <Text style={styles.sectionTitle}>已生成产物 · {artifacts.length} 个</Text>
          <FlatList
            data={artifacts}
            keyExtractor={(a) => a.id}
            contentContainerStyle={styles.listContent}
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadArtifacts();
            }}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Ionicons name="cube-outline" size={40} color={colors.textSubtle} />
                <Text style={styles.emptyTitle}>暂无产物</Text>
                <Text style={styles.emptyDesc}>在会话中生成代码或图片后将出现在这里</Text>
              </View>
            }
            renderItem={({ item }) => {
              const isSelected = selectedId === item.id;
              return (
                <TouchableOpacity
                  style={[styles.artifactCard, isSelected && styles.artifactCardActive]}
                  onPress={() => setSelectedId(item.id)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[styles.iconWrap, { backgroundColor: TYPE_COLORS[item.type] + '1A' }]}
                  >
                    <Ionicons
                      name={TYPE_ICONS[item.type]}
                      size={18}
                      color={TYPE_COLORS[item.type]}
                    />
                  </View>
                  <View style={styles.infoWrap}>
                    <Text style={styles.artifactName}>{item.name}</Text>
                    <Text style={styles.artifactMeta}>
                      {item.size} · {item.time}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  headerAction: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  previewArea: {
    height: 200,
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  previewHint: { ...textPresets.body, color: colors.textMuted },
  previewName: { ...textPresets.subheading, color: colors.textStrong },
  previewMeta: { ...textPresets.caption, color: colors.textMuted },

  loadingBox: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  loadingText: { ...textPresets.caption, color: colors.textMuted },

  errorBox: { marginHorizontal: 16, marginBottom: 12, gap: 8, alignItems: 'center' },
  errorText: { ...textPresets.body, color: colors.danger, textAlign: 'center' },
  retryLink: { paddingHorizontal: 12, paddingVertical: 6 },
  retryLinkText: { ...textPresets.label, color: colors.accent },

  sectionTitle: {
    ...textPresets.subheading,
    color: colors.textStrong,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  listContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 32 },

  emptyBox: { alignItems: 'center', gap: 8, paddingTop: 40 },
  emptyTitle: { ...textPresets.subheading, color: colors.textStrong },
  emptyDesc: { ...textPresets.body, color: colors.textMuted, textAlign: 'center' },

  artifactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 12,
  },
  artifactCardActive: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentMuted,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoWrap: { flex: 1, gap: 2 },
  artifactName: { ...textPresets.body, color: colors.textStrong, fontWeight: '600' },
  artifactMeta: { ...textPresets.caption, color: colors.textMuted },
});
