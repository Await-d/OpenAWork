import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';

interface Channel {
  id: string;
  name: string;
  platform: 'feishu' | 'telegram' | 'dingtalk' | 'slack';
  status: 'online' | 'offline' | 'error';
  sessions: number;
  lastActive: string;
}

const PLATFORM_CONFIG = {
  feishu: { icon: 'chatbubbles-outline' as const, label: '飞书', color: colors.aux },
  telegram: { icon: 'paper-plane-outline' as const, label: 'Telegram', color: colors.accent },
  dingtalk: { icon: 'mail-outline' as const, label: '钉钉', color: colors.contrast },
  slack: { icon: 'logo-slack' as const, label: 'Slack', color: colors.success },
};

const STATUS_CONFIG = {
  online: { label: '在线', color: colors.success },
  offline: { label: '离线', color: colors.textMuted },
  error: { label: '异常', color: colors.danger },
};

const MOCK_CHANNELS: Channel[] = [
  {
    id: '1',
    name: '产品团队',
    platform: 'feishu',
    status: 'online',
    sessions: 12,
    lastActive: '3 分钟前',
  },
  {
    id: '2',
    name: 'DevOps Bot',
    platform: 'telegram',
    status: 'online',
    sessions: 5,
    lastActive: '15 分钟前',
  },
  {
    id: '3',
    name: '全员通知',
    platform: 'dingtalk',
    status: 'offline',
    sessions: 3,
    lastActive: '2 小时前',
  },
];

const ADD_PLATFORMS = [
  { id: 'feishu', ...PLATFORM_CONFIG.feishu },
  { id: 'telegram', ...PLATFORM_CONFIG.telegram },
  { id: 'dingtalk', ...PLATFORM_CONFIG.dingtalk },
  { id: 'slack', ...PLATFORM_CONFIG.slack },
];

/** S31: 消息渠道总览 */
export default function ChannelOverviewScreen() {
  const onlineCount = MOCK_CHANNELS.filter((c) => c.status === 'online').length;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={18} color={colors.textDefault} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>消息渠道</Text>
        <TouchableOpacity style={styles.headerAction}>
          <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
        </TouchableOpacity>
      </View>

      {/* Overview bar */}
      <View style={styles.overviewBar}>
        <Ionicons name="radio-outline" size={16} color={colors.aux} />
        <Text style={styles.overviewText}>
          {onlineCount} / {MOCK_CHANNELS.length} 渠道在线 ·{' '}
          {MOCK_CHANNELS.reduce((s, c) => s + c.sessions, 0)} 个活跃会话
        </Text>
      </View>

      {/* Connected channels */}
      <Text style={styles.sectionTitle}>已接入</Text>
      <FlatList
        data={MOCK_CHANNELS}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const platform = PLATFORM_CONFIG[item.platform];
          const status = STATUS_CONFIG[item.status];
          return (
            <TouchableOpacity
              style={styles.channelCard}
              onPress={() => router.push(`/channel/${item.id}` as never)}
              activeOpacity={0.7}
            >
              <View style={[styles.channelIconWrap, { backgroundColor: platform.color + '1A' }]}>
                <Ionicons name={platform.icon} size={20} color={platform.color} />
              </View>
              <View style={styles.channelInfo}>
                <Text style={styles.channelName}>{item.name}</Text>
                <Text style={styles.channelMeta}>
                  {platform.label} · {item.sessions} 会话 · {item.lastActive}
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
  headerAction: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

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
    paddingBottom: 100,
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
