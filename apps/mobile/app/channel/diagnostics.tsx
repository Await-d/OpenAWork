import { View, Text, TouchableOpacity, StyleSheet, TextInput, FlatList } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../src/theme/colors';
import { radii } from '../../src/theme/radii';
import { textPresets } from '../../src/theme/typography';

interface ChannelSession {
  id: string;
  title: string;
  user: string;
  time: string;
  status: 'active' | 'resolved' | 'pending';
}

const MOCK_SESSIONS: ChannelSession[] = [
  {
    id: '1',
    title: '产品需求讨论 - v0.8 路线图',
    user: '张三',
    time: '5 分钟前',
    status: 'active',
  },
  { id: '2', title: '发布通知 - v0.7.4 已上线', user: 'Bot', time: '1 小时前', status: 'resolved' },
  { id: '3', title: '设计评审 - 移动端 UI 还原', user: '李四', time: '3 小时前', status: 'active' },
  { id: '4', title: 'Bug 反馈 - 登录超时问题', user: '王五', time: '昨天', status: 'pending' },
];

const STATUS_MAP = {
  active: { label: '活跃', color: colors.success },
  resolved: { label: '已解决', color: colors.textMuted },
  pending: { label: '待处理', color: colors.warning },
};

const BUILTIN_COMMANDS = [
  { cmd: '/help', desc: '查看帮助' },
  { cmd: '/status', desc: '查看状态' },
  { cmd: '/reset', desc: '重置会话' },
];

/** S33: 渠道会话与诊断 */
export default function ChannelDiagnosticsScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={18} color={colors.textDefault} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>渠道会话</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Running status */}
      <View style={styles.runningBar}>
        <View style={styles.runningDot} />
        <Text style={styles.runningText}>渠道运行正常 · 响应 120ms · 今日 48 条消息</Text>
      </View>

      {/* Metrics */}
      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>48</Text>
          <Text style={styles.metricLabel}>今日消息</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>120ms</Text>
          <Text style={styles.metricLabel}>响应延迟</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>99.2%</Text>
          <Text style={styles.metricLabel}>成功率</Text>
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
        />
      </View>

      {/* Sessions */}
      <FlatList
        data={MOCK_SESSIONS}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const status = STATUS_MAP[item.status];
          return (
            <TouchableOpacity style={styles.sessionCard} activeOpacity={0.7}>
              <View style={styles.sessionInfo}>
                <Text style={styles.sessionTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.sessionMeta}>
                  {item.user} · {item.time}
                </Text>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: status.color + '1A', borderColor: status.color + '52' },
                ]}
              >
                <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
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
      <TouchableOpacity style={styles.errorEntry} activeOpacity={0.7}>
        <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
        <View style={styles.errorInfo}>
          <Text style={styles.errorTitle}>诊断错误日志</Text>
          <Text style={styles.errorDesc}>查看最近的错误和警告</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
      </TouchableOpacity>
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
  runningText: { ...textPresets.label, color: colors.success },

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
