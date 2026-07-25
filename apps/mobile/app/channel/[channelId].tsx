import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { createChannelsClient, type ChannelDiagnostics } from '@openAwork/web-client';
import { colors } from '../../src/theme/colors';
import { radii } from '../../src/theme/radii';
import { textPresets } from '../../src/theme/typography';
import { Screen } from '../../src/components/Screen';
import { ScreenHeader } from '../../src/components/ui';
import { useAuthStore } from '../../src/store/auth';

/** S32: 渠道配置与安全 */
export default function ChannelConfigScreen() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const { accessToken, gatewayUrl } = useAuthStore();
  const [groupTrigger, setGroupTrigger] = useState(true);
  const [safeMode, setSafeMode] = useState(true);
  const [contentFilter, setContentFilter] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ChannelDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDiagnostics = useCallback(async () => {
    if (!accessToken || !gatewayUrl || !channelId) {
      setError('缺少渠道信息');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const client = createChannelsClient(gatewayUrl);
      const diag = await client.diagnostics(accessToken, channelId);
      setDiagnostics(diag);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载渠道诊断失败');
    } finally {
      setLoading(false);
    }
  }, [accessToken, gatewayUrl, channelId]);

  useEffect(() => {
    void loadDiagnostics();
  }, [loadDiagnostics]);

  const isRunning = diagnostics?.running ?? false;
  const lastError = diagnostics?.lastError ?? null;
  const lastReadyAt = diagnostics?.lastReadyAt;

  function formatReadyTime(ts: number | undefined): string {
    if (!ts) return '—';
    try {
      const diff = Date.now() - ts;
      if (diff < 60_000) return '刚刚';
      if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
      return `${Math.floor(diff / 3_600_000)} 小时前`;
    } catch {
      return '—';
    }
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <ScreenHeader title="渠道配置" />

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryLink}
              onPress={() => {
                setLoading(true);
                void loadDiagnostics();
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

        {!loading ? (
          <>
            {/* Status bar */}
            <View
              style={[
                styles.statusBar,
                !isRunning && lastError
                  ? { backgroundColor: colors.dangerMuted, borderColor: colors.dangerBorder }
                  : !isRunning
                    ? { backgroundColor: colors.surface2, borderColor: colors.lineDefault }
                    : {},
              ]}
            >
              <Ionicons
                name={
                  isRunning
                    ? 'checkmark-circle'
                    : lastError
                      ? 'alert-circle-outline'
                      : 'pause-circle-outline'
                }
                size={16}
                color={isRunning ? colors.success : lastError ? colors.danger : colors.textMuted}
              />
              <Text
                style={[
                  styles.statusText,
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
                  ? `渠道运行正常 · 上次就绪 ${formatReadyTime(lastReadyAt)}`
                  : lastError
                    ? `渠道异常：${lastError}`
                    : '渠道未运行'}
              </Text>
            </View>

            {/* Config tabs */}
            <View style={styles.tabRow}>
              <View style={[styles.tab, styles.tabActive]}>
                <Text style={styles.tabTextActive}>基本</Text>
              </View>
              <View style={styles.tab}>
                <Text style={styles.tabText}>高级</Text>
              </View>
              <View style={styles.tab}>
                <Text style={styles.tabText}>日志</Text>
              </View>
            </View>

            {/* Group targets */}
            <Text style={styles.sectionTitle}>群组目标</Text>
            <View style={styles.card}>
              <View style={styles.groupRow}>
                <Ionicons name="people-outline" size={16} color={colors.accent} />
                <Text style={styles.groupName}>{channelId ?? '未知渠道'}</Text>
                <Text style={styles.groupCount}>{diagnostics?.lastDispatchType ?? '—'}</Text>
              </View>
            </View>

            {/* Group message trigger */}
            <View style={styles.card}>
              <View style={styles.switchRow}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>群消息触发</Text>
                  <Text style={styles.switchDesc}>收到群消息时自动回复</Text>
                </View>
                <Switch
                  value={groupTrigger}
                  onValueChange={setGroupTrigger}
                  trackColor={{ true: colors.accent }}
                />
              </View>
            </View>

            {/* Security */}
            <Text style={styles.sectionTitle}>安全边界</Text>
            <View style={styles.card}>
              <View style={styles.switchRow}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>安全模式</Text>
                  <Text style={styles.switchDesc}>限制敏感操作的远程执行</Text>
                </View>
                <Switch
                  value={safeMode}
                  onValueChange={setSafeMode}
                  trackColor={{ true: colors.accent }}
                />
              </View>
              <View style={styles.divider} />
              <View style={styles.switchRow}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchLabel}>内容过滤</Text>
                  <Text style={styles.switchDesc}>过滤不当内容和指令注入</Text>
                </View>
                <Switch
                  value={contentFilter}
                  onValueChange={setContentFilter}
                  trackColor={{ true: colors.accent }}
                />
              </View>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.linkRow}
                activeOpacity={0.7}
                onPress={() => router.push(`/channel/diagnostics?channelId=${channelId}` as never)}
              >
                <Ionicons name="shield-outline" size={16} color={colors.accent} />
                <Text style={styles.linkText}>查看安全策略详情</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textSubtle} />
              </TouchableOpacity>
            </View>

            {/* Diagnostics entry */}
            <TouchableOpacity
              style={styles.diagCard}
              activeOpacity={0.7}
              onPress={() => router.push(`/channel/diagnostics?channelId=${channelId}` as never)}
            >
              <Ionicons name="pulse-outline" size={18} color={colors.accent} />
              <View style={styles.diagInfo}>
                <Text style={styles.diagTitle}>运行诊断</Text>
                <Text style={styles.diagDesc}>查看连接状态、响应时间、错误日志</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
            </TouchableOpacity>

            {/* Session history entry */}
            <TouchableOpacity
              style={styles.diagCard}
              activeOpacity={0.7}
              onPress={() => router.push('/sessions')}
            >
              <Ionicons name="chatbubbles-outline" size={18} color={colors.aux} />
              <View style={styles.diagInfo}>
                <Text style={styles.diagTitle}>会话历史</Text>
                <Text style={styles.diagDesc}>查看该渠道的所有历史会话</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
            </TouchableOpacity>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { padding: 16, paddingBottom: 32 },

  loadingBox: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  loadingText: { ...textPresets.caption, color: colors.textMuted },

  errorBox: { marginBottom: 12, gap: 8, alignItems: 'center' },
  errorText: { ...textPresets.body, color: colors.danger, textAlign: 'center' },
  retryLink: { paddingHorizontal: 12, paddingVertical: 6 },
  retryLinkText: { ...textPresets.label, color: colors.accent },

  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.successMuted,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.successBorder,
    padding: 10,
    marginBottom: 12,
  },
  statusText: { ...textPresets.label, color: colors.success, flex: 1 },

  tabRow: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: colors.surface2,
    borderRadius: radii.md,
    padding: 3,
    marginBottom: 16,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radii.sm },
  tabActive: { backgroundColor: colors.surface1 },
  tabText: { ...textPresets.label, color: colors.textMuted },
  tabTextActive: { ...textPresets.label, color: colors.accent, fontWeight: '700' },

  sectionTitle: { ...textPresets.subheading, color: colors.textStrong, marginBottom: 10 },

  card: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 12,
    marginBottom: 12,
  },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupName: { ...textPresets.body, color: colors.textStrong, fontWeight: '600', flex: 1 },
  groupCount: { ...textPresets.caption, color: colors.textMuted },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  switchInfo: { flex: 1, gap: 2 },
  switchLabel: { ...textPresets.body, color: colors.textStrong, fontWeight: '600' },
  switchDesc: { ...textPresets.cardDescription, color: colors.textMuted },
  divider: { height: 1, backgroundColor: colors.lineSubtle, marginVertical: 8 },

  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  linkText: { ...textPresets.bodySmall, color: colors.accent, flex: 1 },

  diagCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface2,
    borderRadius: radii.lg,
    padding: 14,
    marginBottom: 10,
  },
  diagInfo: { flex: 1, gap: 2 },
  diagTitle: { ...textPresets.body, color: colors.textStrong, fontWeight: '600' },
  diagDesc: { ...textPresets.cardDescription, color: colors.textMuted },
});
