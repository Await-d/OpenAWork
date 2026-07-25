import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { createChannelsClient } from '@openAwork/web-client';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';
import { useAuthStore } from '../src/store/auth';

interface ChannelItem {
  id: string;
  name: string;
  platform: string;
  status: 'online' | 'offline' | 'error';
  sessions: number;
  lastActive: string;
}

const PLATFORM_CONFIG: Record<
  string,
  { icon: keyof typeof Ionicons.glyphMap; label: string; color: string }
> = {
  feishu: { icon: 'chatbubbles-outline', label: '飞书', color: colors.aux },
  telegram: { icon: 'paper-plane-outline', label: 'Telegram', color: colors.accent },
  dingtalk: { icon: 'mail-outline', label: '钉钉', color: colors.contrast },
  slack: { icon: 'logo-slack', label: 'Slack', color: colors.success },
  discord: { icon: 'logo-discord', label: 'Discord', color: colors.contrast },
  weixin: { icon: 'chatbubble-outline', label: '微信', color: colors.success },
  default: { icon: 'chatbubbles-outline', label: '未知', color: colors.textMuted },
};

const STATUS_CONFIG = {
  online: { label: '在线', color: colors.success },
  offline: { label: '离线', color: colors.textMuted },
  error: { label: '异常', color: colors.danger },
};

function resolvePlatform(raw: unknown): string {
  if (typeof raw === 'string') return raw.toLowerCase();
  return 'default';
}

function resolveStatus(raw: unknown): ChannelItem['status'] {
  if (typeof raw === 'string') {
    if (raw === 'online' || raw === 'active' || raw === 'running') return 'online';
    if (raw === 'error' || raw === 'failed') return 'error';
  }
  return 'offline';
}

const ADD_PLATFORMS = [
  { id: 'feishu', ...PLATFORM_CONFIG.feishu! },
  { id: 'telegram', ...PLATFORM_CONFIG.telegram! },
  { id: 'dingtalk', ...PLATFORM_CONFIG.dingtalk! },
  { id: 'slack', ...PLATFORM_CONFIG.slack! },
];

/** S31: 消息渠道总览 */
export default function ChannelOverviewScreen() {
  const { accessToken, gatewayUrl } = useAuthStore();
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    if (!accessToken || !gatewayUrl) {
      setError('请先登录并连接网关');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const client = createChannelsClient(gatewayUrl);
      const rawChannels = await client.list(accessToken);
      const mapped: ChannelItem[] = rawChannels.map((raw) => {
        const rec = raw;
        const platform = resolvePlatform(rec['platform'] ?? rec['type'] ?? rec['kind']);
        return {
          id: (rec['id'] as string) ?? '',
          name: (rec['name'] as string) ?? (rec['label'] as string) ?? '未命名渠道',
          platform,
          status: resolveStatus(rec['status'] ?? rec['state']),
          sessions: typeof rec['sessions'] === 'number' ? rec['sessions'] : 0,
          lastActive:
            typeof rec['lastActive'] === 'string'
              ? rec['lastActive']
              : typeof rec['updatedAt'] === 'string'
                ? rec['updatedAt']
                : '—',
        };
      });
      setChannels(mapped);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载渠道列表失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken, gatewayUrl]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  const onlineCount = channels.filter((c) => c.status === 'online').length;

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.container}>
        <ScreenHeader
          title="消息渠道"
          right={
            <TouchableOpacity style={styles.headerAction}>
              <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
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
                void loadChannels();
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
            {/* Overview bar */}
            <View style={styles.overviewBar}>
              <Ionicons name="radio-outline" size={16} color={colors.aux} />
              <Text style={styles.overviewText}>
                {onlineCount} / {channels.length} 渠道在线 ·{' '}
                {channels.reduce((s, c) => s + c.sessions, 0)} 个活跃会话
              </Text>
            </View>

            {/* Connected channels */}
            <Text style={styles.sectionTitle}>已接入</Text>
            <FlatList
              data={channels}
              keyExtractor={(c) => c.id}
              contentContainerStyle={styles.listContent}
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadChannels();
              }}
              ListEmptyComponent={
                <View style={styles.emptyBox}>
                  <Ionicons name="radio-outline" size={40} color={colors.textSubtle} />
                  <Text style={styles.emptyTitle}>暂无渠道</Text>
                  <Text style={styles.emptyDesc}>在桌面端配置消息渠道后将同步到这里</Text>
                </View>
              }
              renderItem={({ item }) => {
                const platformConfig = PLATFORM_CONFIG[item.platform] ?? PLATFORM_CONFIG.default!;
                const status = STATUS_CONFIG[item.status];
                return (
                  <TouchableOpacity
                    style={styles.channelCard}
                    onPress={() => router.push(`/channel/${item.id}` as never)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.channelIconWrap,
                        { backgroundColor: platformConfig.color + '1A' },
                      ]}
                    >
                      <Ionicons name={platformConfig.icon} size={20} color={platformConfig.color} />
                    </View>
                    <View style={styles.channelInfo}>
                      <Text style={styles.channelName}>{item.name}</Text>
                      <Text style={styles.channelMeta}>
                        {platformConfig.label} · {item.sessions} 会话 · {item.lastActive}
                      </Text>
                    </View>
                    <View style={[styles.statusDot, { backgroundColor: status.color }]} />
                    <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
                  </TouchableOpacity>
                );
              }}
            />

            {/* Add new */}
            <Text style={styles.sectionTitle}>添加新渠道</Text>
            <View style={styles.addGrid}>
              {ADD_PLATFORMS.map((p) => (
                <TouchableOpacity key={p.id} style={styles.addCard} activeOpacity={0.7}>
                  <Ionicons name={p.icon} size={24} color={p.color} />
                  <Text style={styles.addLabel}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}
      </View>
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

  overviewBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: colors.auxMuted,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.auxBorder,
    padding: 10,
  },
  overviewText: { ...textPresets.label, color: colors.aux },

  sectionTitle: {
    ...textPresets.subheading,
    color: colors.textStrong,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  listContent: { paddingHorizontal: 16, gap: 8, marginBottom: 4 },

  emptyBox: { alignItems: 'center', gap: 8, paddingTop: 40 },
  emptyTitle: { ...textPresets.subheading, color: colors.textStrong },
  emptyDesc: { ...textPresets.body, color: colors.textMuted, textAlign: 'center' },

  channelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 14,
  },
  channelIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelInfo: { flex: 1, gap: 2 },
  channelName: { ...textPresets.cardTitle, color: colors.textStrong },
  channelMeta: { ...textPresets.cardDescription, color: colors.textMuted },
  statusDot: { width: 8, height: 8, borderRadius: 4 },

  addGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  addCard: {
    width: '47%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 72,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
  },
  addLabel: { ...textPresets.label, color: colors.textDefault },
});
