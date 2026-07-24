import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  createChannelsClient,
  type ChannelConversationSummary,
  type ChannelDiagnostics,
} from '@openAwork/web-client';
import { colors } from '../../src/theme/colors';
import { radii } from '../../src/theme/radii';
import { textPresets } from '../../src/theme/typography';
import { Screen } from '../../src/components/Screen';
import { ScreenHeader } from '../../src/components/ui';
import { useAuthStore } from '../../src/store/auth';

const STATUS_MAP = {
  active: { label: '活跃', color: colors.success },
  resolved: { label: '已解决', color: colors.textMuted },
  pending: { label: '待处理', color: colors.warning },
};

function mapConvStatus(stateStatus: string): keyof typeof STATUS_MAP {
  if (stateStatus === 'active' || stateStatus === 'running' || stateStatus === 'idle') {
    return 'active';
  }
  if (stateStatus === 'resolved' || stateStatus === 'completed' || stateStatus === 'done') {
    return 'resolved';
  }
  return 'pending';
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

const BUILTIN_COMMANDS = [
  { cmd: '/help', desc: '查看帮助' },
  { cmd: '/status', desc: '查看状态' },
  { cmd: '/reset', desc: '重置会话' },
];

/** S33: 渠道会话与诊断 */
export default function ChannelDiagnosticsScreen() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const { accessToken, gatewayUrl } = useAuthStore();
  const [conversations, setConversations] = useState<ChannelConversationSummary[]>([]);
  const [diagnostics, setDiagnostics] = useState<ChannelDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadData = useCallback(async () => {
    if (!accessToken || !gatewayUrl) {
      setError('请先登录并连接网关');
      setLoading(false);
      return;
    }
    if (!channelId) {
      setError('缺少渠道 ID');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const client = createChannelsClient(gatewayUrl);
      const [diags, convs] = await Promise.all([
        client.diagnostics(accessToken, channelId).catch(() => null),
        client.listConversations(accessToken, channelId, { limit: 50 }).catch(() => []),
      ]);
      setDiagnostics(diags);
      setConversations(convs);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载渠道数据失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken, gatewayUrl, channelId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const isRunning = diagnostics?.running ?? false;
  const lastError = diagnostics?.lastError ?? null;
  const lastMessageAt = diagnostics?.lastMessageAt;

  const filteredConversations = conversations.filter(
    (c) => !search.trim() || c.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.container}>
        <ScreenHeader title="渠道会话" />

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryLink}
              onPress={() => {
                setLoading(true);
                void loadData();
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
            {/* Running status */}
            <View
              style={[
                styles.runningBar,
                !isRunning && lastError
                  ? { backgroundColor: colors.dangerMuted, borderColor: colors.dangerBorder }
                  : !isRunning
                    ? { backgroundColor: colors.surface2, borderColor: colors.lineDefault }
                    : {},
              ]}
            >
              <View
                style={[
                  styles.runningDot,
                  { backgroundColor: isRunning ? colors.success : lastError ? colors.danger : colors.textMuted },
                ]}
              />
              <Text
                style={[
                  styles.runningText,
                  {
                    color: isRunning
                      ? colors.success
                      : lastError
                        ? colors.danger
                        : colors.textMuted,
                  },
                ]}
              >
                {isRunning
                  ? `渠道运行正常${lastMessageAt ? ` · 最近消息 ${formatTime(new Date(lastMessageAt).toISOString())}` : ''}`
                  : lastError
                    ? `渠道异常：${lastError}`
                    : '渠道未运行'}
              </Text>
            </View>

            {/* Metrics */}
            <View style={styles.metricsRow}>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{conversations.length}</Text>
                <Text style={styles.metricLabel}>总会话</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>
                  {diagnostics?.lastHeartbeatAckAt
                    ? `${Math.max(1, Math.round((Date.now() - diagnostics.lastHeartbeatAckAt) / 1000))}s`
                    : '—'}
                </Text>
                <Text style={styles.metricLabel}>心跳</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>
                  {isRunning ? '✓' : '✗'}
                </Text>
                <Text style={styles.metricLabel}>状态</Text>
              </View>
            </View>

            {/* Session search */}
            <Text style={styles.sectionTitle}>渠道会话</Text>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="搜索会话…"
                placeholderTextColor={colors.textSubtle}
                value={search}
                onChangeText={setSearch}
              />
            </View>

            {/* Sessions */}
            <FlatList
              data={filteredConversations}
              keyExtractor={(s) => s.id}
              contentContainerStyle={styles.listContent}
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadData();
              }}
              ListEmptyComponent={
                <View style={styles.emptyBox}>
                  <Ionicons name="chatbubbles-outline" size={40} color={colors.textSubtle} />
                  <Text style={styles.emptyTitle}>暂无会话</Text>
                  <Text style={styles.emptyDesc}>渠道接收到的消息会话将出现在这里</Text>
                </View>
              }
              renderItem={({ item }) => {
                const status = STATUS_MAP[mapConvStatus(item.stateStatus)];
                return (
                  <TouchableOpacity style={styles.sessionCard} activeOpacity={0.7}>
                    <View style={styles.sessionInfo}>
                      <Text style={styles.sessionTitle} numberOfLines={1}>
                        {item.title || item.chatName || '未命名会话'}
                      </Text>
                      <Text style={styles.sessionMeta}>
                        {item.chatName ?? '—'} · {formatTime(item.updatedAt)} · {item.messageCount} 条消息
                      </Text>
                      {item.lastMessagePreview ? (
                        <Text style={styles.sessionPreview} numberOfLines={1}>
                          {item.lastMessagePreview}
                        </Text>
                      ) : null}
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor: status.color + '1A',
                          borderColor: status.color + '52',
                        },
                      ]}
                    >
                      <Text style={[styles.statusText, { color: status.color }]}>
                        {status.label}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
                  </TouchableOpacity>
                );
              }}
            />

            {/* Built-in commands */}
            <Text style={styles.sectionTitle}>渠道内置命令</Text>
            <View style={styles.cmdRow}>
              {BUILTIN_COMMANDS.map((c) => (
                <View key={c.cmd} style={styles.cmdChip}>
                  <Text style={styles.cmdText}>{c.cmd}</Text>
                  <Text style={styles.cmdDesc}>{c.desc}</Text>
                </View>
              ))}
            </View>

            {/* Error entry */}
            {lastError ? (
              <TouchableOpacity style={styles.errorEntry} activeOpacity={0.7}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                <View style={styles.errorInfo}>
                  <Text style={styles.errorTitle}>诊断错误日志</Text>
                  <Text style={styles.errorDesc}>{lastError}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
              </TouchableOpacity>
            ) : null}
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },

  loadingBox: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  loadingText: { ...textPresets.caption, color: colors.textMuted },

  errorBox: { marginHorizontal: 16, marginBottom: 12, gap: 8, alignItems: 'center' },
  errorText: { ...textPresets.body, color: colors.danger, textAlign: 'center' },
  retryLink: { paddingHorizontal: 12, paddingVertical: 6 },
  retryLinkText: { ...textPresets.label, color: colors.accent },

  runningBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.successMuted,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.successBorder,
    padding: 10,
  },
  runningDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  runningText: { ...textPresets.label, color: colors.success, flex: 1 },

  metricsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 16 },
  metricCard: {
    flex: 1,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 12,
    alignItems: 'center',
    gap: 2,
  },
  metricValue: { ...textPresets.subheading, color: colors.textStrong, fontSize: 18 },
  metricLabel: { ...textPresets.caption, color: colors.textMuted },

  sectionTitle: {
    ...textPresets.subheading,
    color: colors.textStrong,
    paddingHorizontal: 16,
    marginBottom: 10,
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 36,
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingHorizontal: 10,
  },
  searchInput: { flex: 1, ...textPresets.body, color: colors.textStrong, padding: 0 },

  emptyBox: { alignItems: 'center', gap: 8, paddingTop: 40 },
  emptyTitle: { ...textPresets.subheading, color: colors.textStrong },
  emptyDesc: { ...textPresets.body, color: colors.textMuted, textAlign: 'center' },

  listContent: { paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 12,
  },
  sessionInfo: { flex: 1, gap: 2 },
  sessionTitle: { ...textPresets.body, color: colors.textStrong, fontWeight: '600' },
  sessionMeta: { ...textPresets.caption, color: colors.textMuted },
  sessionPreview: { ...textPresets.caption, color: colors.textSubtle },
  statusBadge: {
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: { ...textPresets.caption, fontWeight: '600' },

  cmdRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  cmdChip: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 8,
    gap: 2,
  },
  cmdText: { ...textPresets.label, color: colors.accent, fontFamily: 'monospace' },
  cmdDesc: { ...textPresets.caption, color: colors.textMuted },

  errorEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 100,
    backgroundColor: colors.dangerMuted,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    padding: 14,
  },
  errorInfo: { flex: 1, gap: 2 },
  errorTitle: { ...textPresets.body, color: colors.danger, fontWeight: '600' },
  errorDesc: { ...textPresets.cardDescription, color: colors.textMuted },
});
