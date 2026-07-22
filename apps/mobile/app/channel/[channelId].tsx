import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../src/theme/colors';
import { radii } from '../../src/theme/radii';
import { textPresets } from '../../src/theme/typography';

/** S32: 渠道配置与安全 */
export default function ChannelConfigScreen() {
  const [groupTrigger, setGroupTrigger] = useState(true);
  const [safeMode, setSafeMode] = useState(true);
  const [contentFilter, setContentFilter] = useState(false);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={18} color={colors.textDefault} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>渠道配置</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Status bar */}
      <View style={styles.statusBar}>
        <Ionicons name="checkmark-circle" size={16} color={colors.success} />
        <Text style={styles.statusText}>渠道运行正常 · 上次同步 3 分钟前</Text>
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
          <Text style={styles.groupName}>产品团队</Text>
          <Text style={styles.groupCount}>12 成员</Text>
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
        <TouchableOpacity style={styles.linkRow}>
          <Ionicons name="shield-outline" size={16} color={colors.accent} />
          <Text style={styles.linkText}>查看安全策略详情</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textSubtle} />
        </TouchableOpacity>
      </View>

      {/* Diagnostics entry */}
      <TouchableOpacity style={styles.diagCard} activeOpacity={0.7}>
        <Ionicons name="pulse-outline" size={18} color={colors.accent} />
        <View style={styles.diagInfo}>
          <Text style={styles.diagTitle}>运行诊断</Text>
          <Text style={styles.diagDesc}>查看连接状态、响应时间、错误日志</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
      </TouchableOpacity>

      {/* Session history entry */}
      <TouchableOpacity style={styles.diagCard} activeOpacity={0.7}>
        <Ionicons name="chatbubbles-outline" size={18} color={colors.aux} />
        <View style={styles.diagInfo}>
          <Text style={styles.diagTitle}>会话历史</Text>
          <Text style={styles.diagDesc}>查看该渠道的所有历史会话</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { padding: 16, paddingBottom: 100 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    marginBottom: 12,
    marginTop: 16,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...textPresets.cardTitle, color: colors.textStrong },

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
  statusText: { ...textPresets.label, color: colors.success },

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
