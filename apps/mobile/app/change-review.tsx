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
import { Ionicons } from '@expo/vector-icons';
import { createWorkspaceClient, type WorkspaceReviewChange } from '@openAwork/web-client';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';
import { useAuthStore } from '../src/store/auth';

interface FileChangeItem {
  id: string;
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
  preview: string;
}

const STATUS_MAP = {
  added: { label: '新增', color: colors.success, icon: 'add-circle-outline' as const },
  modified: { label: '修改', color: colors.warning, icon: 'create-outline' as const },
  deleted: { label: '删除', color: colors.danger, icon: 'trash-outline' as const },
};

function mapChangeStatus(raw: string): keyof typeof STATUS_MAP {
  if (raw === 'added' || raw === 'untracked' || raw === 'new') return 'added';
  if (raw === 'deleted' || raw === 'removed') return 'deleted';
  return 'modified';
}

function extractAdditions(change: WorkspaceReviewChange): number {
  const val = change['additions'];
  return typeof val === 'number' ? val : 0;
}

function extractDeletions(change: WorkspaceReviewChange): number {
  const val = change['deletions'];
  return typeof val === 'number' ? val : 0;
}

function extractPreview(change: WorkspaceReviewChange): string {
  const val = change['preview'];
  if (typeof val === 'string' && val.length > 0) return val;
  return '—';
}

/** S25: 变更审阅与还原 */
export default function ChangeReviewScreen() {
  const { accessToken, gatewayUrl } = useAuthStore();
  const [changes, setChanges] = useState<FileChangeItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reverting, setReverting] = useState(false);

  const loadChanges = useCallback(async () => {
    if (!accessToken || !gatewayUrl) {
      setError('请先登录并连接网关');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const workspaceClient = createWorkspaceClient(gatewayUrl);
      const roots = await workspaceClient.listRoots(accessToken);
      if (roots.length === 0) {
        setChanges([]);
        setLoading(false);
        return;
      }
      const rootPath = roots[0]!;
      const rawChanges = await workspaceClient.reviewStatus(accessToken, rootPath);
      const mapped: FileChangeItem[] = rawChanges.map((raw, index) => {
        const status = mapChangeStatus(raw.status ?? 'modified');
        return {
          id: `${index}-${raw.path}`,
          path: raw.path,
          status,
          additions: extractAdditions(raw),
          deletions: extractDeletions(raw),
          preview: extractPreview(raw),
        };
      });
      setChanges(mapped);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载变更列表失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken, gatewayUrl]);

  useEffect(() => {
    void loadChanges();
  }, [loadChanges]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleRevert() {
    if (selected.size === 0) {
      Alert.alert('提示', '请先选择要还原的文件');
      return;
    }
    if (!accessToken || !gatewayUrl) return;
    Alert.alert('确认还原', `将还原 ${selected.size} 个文件的变更？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '还原',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setReverting(true);
            try {
              const workspaceClient = createWorkspaceClient(gatewayUrl);
              const roots = await workspaceClient.listRoots(accessToken);
              const rootPath = roots[0] ?? '';
              const selectedPaths = changes.filter((c) => selected.has(c.id)).map((c) => c.path);
              await Promise.all(
                selectedPaths.map((filePath) =>
                  workspaceClient.reviewRevert(accessToken, rootPath, filePath),
                ),
              );
              setSelected(new Set());
              setRefreshing(true);
              await loadChanges();
              Alert.alert('成功', `已还原 ${selectedPaths.length} 个文件`);
            } catch (e) {
              Alert.alert('还原失败', e instanceof Error ? e.message : '请稍后重试');
            } finally {
              setReverting(false);
            }
          })();
        },
      },
    ]);
  }

  return (
    <Screen>
      <ScreenHeader
        title="变更审阅"
        right={
          <TouchableOpacity
            onPress={() => setSelected(new Set(changes.map((c) => c.id)))}
            disabled={changes.length === 0}
          >
            <Text style={[styles.selectAll, changes.length === 0 && { opacity: 0.4 }]}>全选</Text>
          </TouchableOpacity>
        }
      />

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryLink}
            onPress={() => {
              setLoading(true);
              void loadChanges();
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
        <>
          {/* Summary bar */}
          <View style={styles.summaryBar}>
            <Ionicons name="git-compare-outline" size={16} color={colors.accent} />
            <Text style={styles.summaryText}>
              {changes.length} 个文件变更 · {changes.reduce((s, c) => s + c.additions, 0)} 行新增 ·{' '}
              {changes.reduce((s, c) => s + c.deletions, 0)} 行删除
            </Text>
          </View>

          <FlatList
            data={changes}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.listContent}
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadChanges();
            }}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Ionicons name="git-compare-outline" size={40} color={colors.textSubtle} />
                <Text style={styles.emptyTitle}>暂无变更</Text>
                <Text style={styles.emptyDesc}>工作区没有未提交的文件改动</Text>
              </View>
            }
            renderItem={({ item }) => {
              const isSelected = selected.has(item.id);
              const status = STATUS_MAP[item.status];
              return (
                <TouchableOpacity
                  style={[styles.changeCard, isSelected && styles.changeCardSelected]}
                  onPress={() => toggleSelect(item.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.changeHeader}>
                    <Ionicons
                      name={isSelected ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={isSelected ? colors.accent : colors.textSubtle}
                    />
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor: status.color + '1A',
                          borderColor: status.color + '52',
                        },
                      ]}
                    >
                      <Ionicons name={status.icon} size={12} color={status.color} />
                      <Text style={[styles.statusText, { color: status.color }]}>
                        {status.label}
                      </Text>
                    </View>
                    <Text style={styles.filePath} numberOfLines={1}>
                      {item.path}
                    </Text>
                  </View>
                  <Text style={styles.preview}>{item.preview}</Text>
                  <View style={styles.statsRow}>
                    <Text style={styles.additions}>+{item.additions}</Text>
                    <Text style={styles.deletions}>-{item.deletions}</Text>
                  </View>
                </TouchableOpacity>
              );
            }}
          />

          {/* Action bar */}
          {selected.size > 0 ? (
            <View style={styles.actionBar}>
              <TouchableOpacity
                style={[styles.revertBtn, reverting && { opacity: 0.6 }]}
                disabled={reverting}
                onPress={() => void handleRevert()}
              >
                {reverting ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <>
                    <Ionicons name="arrow-undo-outline" size={16} color={colors.white} />
                    <Text style={styles.revertText}>还原 {selected.size} 个文件</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  selectAll: { ...textPresets.label, color: colors.accent },

  loadingBox: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  loadingText: { ...textPresets.caption, color: colors.textMuted },

  errorBox: { marginHorizontal: 16, marginBottom: 12, gap: 8, alignItems: 'center' },
  errorText: { ...textPresets.body, color: colors.danger, textAlign: 'center' },
  retryLink: { paddingHorizontal: 12, paddingVertical: 6 },
  retryLinkText: { ...textPresets.label, color: colors.accent },

  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.accentMuted,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    padding: 10,
  },
  summaryText: { ...textPresets.label, color: colors.accent },

  emptyBox: { alignItems: 'center', gap: 8, paddingTop: 40 },
  emptyTitle: { ...textPresets.subheading, color: colors.textStrong },
  emptyDesc: { ...textPresets.body, color: colors.textMuted, textAlign: 'center' },

  listContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 32 },
  changeCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 12,
    gap: 6,
  },
  changeCardSelected: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentMuted,
  },
  changeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusText: { ...textPresets.caption, fontWeight: '600' },
  filePath: {
    ...textPresets.bodySmall,
    color: colors.textStrong,
    flex: 1,
    fontFamily: 'monospace',
  },
  preview: { ...textPresets.bodySmall, color: colors.textMuted, marginLeft: 28 },
  statsRow: { flexDirection: 'row', gap: 8, marginLeft: 28 },
  additions: { ...textPresets.caption, color: colors.success, fontWeight: '700' },
  deletions: { ...textPresets.caption, color: colors.danger, fontWeight: '700' },

  actionBar: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.lineDefault,
    backgroundColor: colors.surface1,
  },
  revertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    backgroundColor: colors.danger,
    borderRadius: radii.lg,
  },
  revertText: { ...textPresets.body, color: colors.white, fontWeight: '700' },
});
