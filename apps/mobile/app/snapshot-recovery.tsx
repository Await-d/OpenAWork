import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  createSessionsClient,
  createSnapshotTreesClient,
  type SnapshotTreeEntry,
} from '@openAwork/web-client';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';
import { useAuthStore } from '../src/store/auth';

interface SnapshotItem {
  id: string;
  label: string;
  time: string;
  changes: number;
  type: 'auto' | 'manual' | 'checkpoint';
  treeHash: string;
}

const TYPE_MAP = {
  auto: { icon: 'time-outline' as const, color: colors.textMuted },
  manual: { icon: 'bookmark-outline' as const, color: colors.aux },
  checkpoint: { icon: 'flag-outline' as const, color: colors.accent },
};

function mapScopeKind(
  scopeKind: string,
): SnapshotItem['type'] {
  if (scopeKind === 'manual') return 'manual';
  if (scopeKind === 'baseline' || scopeKind === 'restore') return 'checkpoint';
  return 'auto';
}

function formatTime(createdAt: string): string {
  try {
    const date = new Date(createdAt);
    const diff = Date.now() - date.getTime();
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return `${Math.floor(diff / 86_400_000)} 天前`;
  } catch {
    return createdAt;
  }
}

/** S29: 快照恢复预览 */
export default function SnapshotRecoveryScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const { accessToken, gatewayUrl } = useAuthStore();
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [previewResult, setPreviewResult] = useState<string | null>(null);

  const loadSnapshots = useCallback(async () => {
    if (!accessToken || !gatewayUrl) {
      setError('请先登录并连接网关');
      setLoading(false);
      return;
    }
    if (!sessionId) {
      setError('缺少会话 ID，请从聊天页面进入快照恢复');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const snapshotClient = createSnapshotTreesClient(gatewayUrl);
      const resp = await snapshotClient.list(accessToken, sessionId);
      const trees = resp.trees ?? [];
      const mapped: SnapshotItem[] = trees.map((t: SnapshotTreeEntry) => ({
        id: t.treeHash,
        label:
          t.scopeKind === 'manual'
            ? '手动快照'
            : t.scopeKind === 'baseline'
              ? '初始状态'
              : t.toolName
                ? `${t.toolName} 快照`
                : '自动快照',
        time: formatTime(t.createdAt),
        changes: t.filesChanged,
        type: mapScopeKind(t.scopeKind),
        treeHash: t.treeHash,
      }));
      setSnapshots(mapped);
    } catch (e) {
      // 回退到 sessions API 的 listSnapshots
      try {
        const sessionsClient = createSessionsClient(gatewayUrl);
        const sessionSnapshots = await sessionsClient.listSnapshots(accessToken, sessionId);
        const mapped: SnapshotItem[] = sessionSnapshots.map((s) => ({
          id: s.snapshotRef,
          label:
            s.scopeKind === 'backup'
              ? '自动备份'
              : s.scopeKind === 'scope'
                ? '范围快照'
                : '请求快照',
          time: formatTime(s.createdAt),
          changes: s.summary.files,
          type: s.scopeKind === 'backup' ? 'auto' : 'manual',
          treeHash: s.snapshotRef,
        }));
        setSnapshots(mapped);
      } catch (e2) {
        setError(
          e2 instanceof Error ? e2.message : '加载快照列表失败',
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken, gatewayUrl, sessionId]);

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

  async function handlePreview() {
    if (!selectedId || !sessionId || !accessToken || !gatewayUrl) {
      Alert.alert('提示', '请先选择一个快照');
      return;
    }
    const snapshot = snapshots.find((s) => s.id === selectedId);
    if (!snapshot) return;

    setRestoring(true);
    setPreviewResult(null);
    try {
      const snapshotClient = createSnapshotTreesClient(gatewayUrl);
      const result = await snapshotClient.restoreToTree(accessToken, sessionId, {
        treeHash: snapshot.treeHash,
        mode: 'preview',
      });
      if (result.mode === 'preview') {
        const changed = result.summary.changed;
        const additions = result.summary.additions;
        const deletions = result.summary.deletions;
        setPreviewResult(
          `预览：${changed} 个文件将变更 · +${additions} 行 · -${deletions} 行`,
        );
      }
    } catch (e) {
      Alert.alert('预览失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setRestoring(false);
    }
  }

  async function handleRestore() {
    if (!selectedId || !sessionId || !accessToken || !gatewayUrl) {
      Alert.alert('提示', '请先选择一个快照');
      return;
    }
    const snapshot = snapshots.find((s) => s.id === selectedId);
    if (!snapshot) return;

    Alert.alert('确认恢复', `将恢复到「${snapshot.label}」？当前未保存的变更将丢失。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '恢复',
        style: 'destructive',
        onPress: async () => {
          setRestoring(true);
          try {
            const snapshotClient = createSnapshotTreesClient(gatewayUrl);
            const result = await snapshotClient.restoreToTree(accessToken, sessionId, {
              treeHash: snapshot.treeHash,
              mode: 'apply',
            });
            if (result.mode === 'apply') {
              Alert.alert('恢复成功', `已恢复 ${result.changed} 个文件`, [
                {
                  text: '返回聊天',
                  onPress: () => router.replace(`/chat/${sessionId}`),
                },
              ]);
            }
          } catch (e) {
            Alert.alert('恢复失败', e instanceof Error ? e.message : '请稍后重试');
          } finally {
            setRestoring(false);
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <ScreenHeader
        title="快照恢复"
        right={
          <TouchableOpacity
            style={styles.headerAction}
            onPress={() => {
              setRefreshing(true);
              void loadSnapshots();
            }}
          >
            <Ionicons name="refresh-outline" size={18} color={colors.aux} />
          </TouchableOpacity>
        }
      />

      <Text style={styles.title}>选择恢复点</Text>
      <Text style={styles.subtitle}>将工作区恢复到某个历史快照状态。</Text>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryLink}
            onPress={() => {
              setLoading(true);
              void loadSnapshots();
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

      {!loading && !error ? (
        <FlatList
          data={snapshots}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void loadSnapshots();
          }}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="camera-outline" size={40} color={colors.textSubtle} />
              <Text style={styles.emptyTitle}>暂无快照</Text>
              <Text style={styles.emptyDesc}>在会话中产生文件变更后将自动创建快照</Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const isSelected = selectedId === item.id;
            const typeInfo = TYPE_MAP[item.type];
            return (
              <TouchableOpacity
                style={[styles.snapshotCard, isSelected && styles.snapshotCardActive]}
                onPress={() => {
                  setSelectedId(item.id);
                  setPreviewResult(null);
                }}
                activeOpacity={0.7}
              >
                {/* Timeline dot */}
                <View style={styles.timelineCol}>
                  <View style={[styles.timelineDot, { backgroundColor: typeInfo.color }]} />
                  {index < snapshots.length - 1 ? <View style={styles.timelineLine} /> : null}
                </View>

                <View style={styles.snapshotContent}>
                  <View style={styles.snapshotHeader}>
                    <Ionicons name={typeInfo.icon} size={16} color={typeInfo.color} />
                    <Text style={styles.snapshotLabel}>{item.label}</Text>
                  </View>
                  <Text style={styles.snapshotMeta}>
                    {item.time} · {item.changes} 个文件变更
                  </Text>
                </View>

                {isSelected ? (
                  <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                ) : null}
              </TouchableOpacity>
            );
          }}
        />
      ) : null}

      {previewResult ? (
        <View style={styles.previewResultBox}>
          <Ionicons name="eye-outline" size={14} color={colors.accent} />
          <Text style={styles.previewResultText}>{previewResult}</Text>
        </View>
      ) : null}

      {/* Action bar */}
      <View style={styles.actionBar}>
        <TouchableOpacity
          style={[styles.previewBtn, (!selectedId || restoring) && { opacity: 0.45 }]}
          onPress={() => void handlePreview()}
          disabled={!selectedId || restoring}
        >
          {restoring ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <>
              <Ionicons name="eye-outline" size={16} color={colors.accent} />
              <Text style={styles.previewText}>预览差异</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.restoreBtn, (!selectedId || restoring) && { opacity: 0.45 }]}
          onPress={() => void handleRestore()}
          disabled={!selectedId || restoring}
        >
          <Ionicons name="arrow-undo-outline" size={16} color={colors.white} />
          <Text style={styles.restoreText}>恢复快照</Text>
        </TouchableOpacity>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  headerAction: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  title: { ...textPresets.title, color: colors.textStrong, paddingHorizontal: 16, fontSize: 22 },
  subtitle: {
    ...textPresets.body,
    color: colors.textMuted,
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 16,
  },

  loadingBox: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  loadingText: { ...textPresets.caption, color: colors.textMuted },

  errorBox: { marginHorizontal: 16, marginBottom: 12, gap: 8, alignItems: 'center' },
  errorText: { ...textPresets.body, color: colors.danger, textAlign: 'center' },
  retryLink: { paddingHorizontal: 12, paddingVertical: 6 },
  retryLinkText: { ...textPresets.label, color: colors.accent },

  emptyBox: { alignItems: 'center', gap: 8, paddingTop: 40 },
  emptyTitle: { ...textPresets.subheading, color: colors.textStrong },
  emptyDesc: { ...textPresets.body, color: colors.textMuted, textAlign: 'center' },

  listContent: { paddingHorizontal: 16, paddingBottom: 120 },
  snapshotCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
  },
  snapshotCardActive: {},

  timelineCol: { alignItems: 'center', width: 20 },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: colors.lineDefault,
    marginTop: 4,
    minHeight: 20,
  },

  snapshotContent: { flex: 1, gap: 4 },
  snapshotHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  snapshotLabel: { ...textPresets.body, color: colors.textStrong, fontWeight: '600', flex: 1 },
  snapshotMeta: { ...textPresets.caption, color: colors.textMuted },

  previewResultBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.accentMuted,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    padding: 10,
  },
  previewResultText: { ...textPresets.caption, color: colors.accent, flex: 1 },

  actionBar: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.lineDefault,
    backgroundColor: colors.surface1,
  },
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
  },
  previewText: { ...textPresets.body, color: colors.accent, fontWeight: '600' },
  restoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
  },
  restoreText: { ...textPresets.body, color: colors.white, fontWeight: '700' },
});
