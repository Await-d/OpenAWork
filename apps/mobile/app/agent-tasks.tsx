import { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { createSessionsClient, type SessionTask } from '@openAwork/web-client';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';
import { useAuthStore } from '../src/store/auth';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';

interface TaskItem {
  id: string;
  name: string;
  agent: string;
  status: 'running' | 'done' | 'error';
  output?: string;
  artifacts: number;
  sessionId?: string;
}

const STATUS_MAP = {
  running: { label: '运行中', color: colors.aux, icon: 'sync-outline' as const },
  done: { label: '已完成', color: colors.success, icon: 'checkmark-circle-outline' as const },
  error: { label: '失败', color: colors.danger, icon: 'alert-circle-outline' as const },
};

function mapTaskStatus(raw: string): TaskItem['status'] {
  switch (raw) {
    case 'running':
    case 'in_progress':
    case 'pending':
      return 'running';
    case 'completed':
    case 'done':
      return 'done';
    case 'failed':
    case 'error':
    case 'cancelled':
      return 'error';
    default:
      return 'running';
  }
}

/** S08: Agent 任务与产物 */
export default function AgentTasksScreen() {
  const { accessToken, gatewayUrl } = useAuthStore();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    if (!accessToken || !gatewayUrl) {
      setError('请先登录并连接网关');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const sessionsClient = createSessionsClient(gatewayUrl);
      const sessions = await sessionsClient.list(accessToken, { excludeTeam: true });
      const recentSessions = sessions.slice(0, 10);
      const results = await Promise.all(
        recentSessions.map(async (s) => {
          try {
            const sessionTasks = await sessionsClient.getTasks(accessToken, s.id);
            return sessionTasks.map(
              (t: SessionTask): TaskItem => ({
                id: t.id,
                name: t.title,
                agent: t.assignedAgent ?? 'agent',
                status: mapTaskStatus(t.status),
                output: t.result ?? t.errorMessage,
                artifacts: 0,
                sessionId: s.id,
              }),
            );
          } catch {
            return [];
          }
        }),
      );
      const merged = results.flat().slice(0, 50);
      setTasks(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载任务列表失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken, gatewayUrl]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const runningCount = tasks.filter((t) => t.status === 'running').length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;

  return (
    <Screen>
      <ScreenHeader
        title="Agent 任务"
        right={
          <TouchableOpacity
            style={styles.headerAction}
            onPress={() => {
              setRefreshing(true);
              void loadTasks();
            }}
          >
            <Ionicons name="refresh-outline" size={18} color={colors.accent} />
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
              void loadTasks();
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
          {/* Summary */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Ionicons name="sync-outline" size={16} color={colors.aux} />
              <Text style={styles.summaryValue}>{runningCount}</Text>
              <Text style={styles.summaryLabel}>运行中</Text>
            </View>
            <View style={styles.summaryCard}>
              <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
              <Text style={styles.summaryValue}>{doneCount}</Text>
              <Text style={styles.summaryLabel}>已完成</Text>
            </View>
            <View style={styles.summaryCard}>
              <Ionicons name="cube-outline" size={16} color={colors.contrast} />
              <Text style={styles.summaryValue}>{tasks.length}</Text>
              <Text style={styles.summaryLabel}>总计</Text>
            </View>
          </View>

          <FlatList
            data={tasks}
            keyExtractor={(t) => t.id}
            contentContainerStyle={styles.listContent}
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadTasks();
            }}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Ionicons name="hardware-chip-outline" size={40} color={colors.textSubtle} />
                <Text style={styles.emptyTitle}>暂无任务</Text>
                <Text style={styles.emptyDesc}>在会话中分配 Agent 任务后将出现在这里</Text>
              </View>
            }
            renderItem={({ item }) => {
              const status = STATUS_MAP[item.status];
              const isExpanded = expandedId === item.id;
              return (
                <TouchableOpacity
                  style={styles.taskCard}
                  onPress={() => setExpandedId(isExpanded ? null : item.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.taskHeader}>
                    <Ionicons name={status.icon} size={18} color={status.color} />
                    <View style={styles.taskInfo}>
                      <Text style={styles.taskName}>{item.name}</Text>
                      <Text style={styles.taskMeta}>
                        @{item.agent} · {status.label}
                      </Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: status.color + '1A' }]}>
                      <Text style={[styles.statusText, { color: status.color }]}>
                        {status.label}
                      </Text>
                    </View>
                  </View>

                  {item.output ? <Text style={styles.taskOutput}>{item.output}</Text> : null}

                  {isExpanded && item.sessionId ? (
                    <View style={styles.artifactRow}>
                      <Ionicons name="chatbubble-outline" size={14} color={colors.accent} />
                      <Text style={styles.artifactText}>所属会话</Text>
                      <TouchableOpacity
                        onPress={() => router.push(`/chat/${item.sessionId}` as never)}
                      >
                        <Text style={styles.viewLink}>打开</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
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

  loadingBox: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  loadingText: { ...textPresets.caption, color: colors.textMuted },

  errorBox: { marginHorizontal: 16, marginBottom: 12, gap: 8, alignItems: 'center' },
  errorText: { ...textPresets.body, color: colors.danger, textAlign: 'center' },
  retryLink: { paddingHorizontal: 12, paddingVertical: 6 },
  retryLinkText: { ...textPresets.label, color: colors.accent },

  summaryRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 16 },
  summaryCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 10,
  },
  summaryValue: { ...textPresets.subheading, color: colors.textStrong },
  summaryLabel: { ...textPresets.caption, color: colors.textMuted },

  emptyBox: { alignItems: 'center', gap: 8, paddingTop: 40 },
  emptyTitle: { ...textPresets.subheading, color: colors.textStrong },
  emptyDesc: { ...textPresets.body, color: colors.textMuted, textAlign: 'center' },

  listContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 32 },
  taskCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 12,
    gap: 8,
  },
  taskHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  taskInfo: { flex: 1, gap: 2 },
  taskName: { ...textPresets.body, color: colors.textStrong, fontWeight: '600' },
  taskMeta: { ...textPresets.caption, color: colors.textMuted },
  statusBadge: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { ...textPresets.caption, fontWeight: '600' },
  taskOutput: { ...textPresets.bodySmall, color: colors.textDefault, marginLeft: 28 },
  artifactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.lineSubtle,
  },
  artifactText: { ...textPresets.caption, color: colors.textMuted, flex: 1 },
  viewLink: { ...textPresets.label, color: colors.accent },
});
