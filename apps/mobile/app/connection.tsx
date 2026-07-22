import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';

/** S1: 连接方式选择 */
export default function ConnectionScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>连接你的工作台</Text>
      <Text style={styles.subtitle}>手机端连接已运行的桌面端、已有网关或云端工作区。</Text>

      <Text style={styles.sectionTitle}>连接入口</Text>

      {/* 连接桌面端 — recommended */}
      <TouchableOpacity
        style={[styles.modeCard, styles.modeCardRecommended]}
        onPress={() => router.push('/onboarding/client')}
        activeOpacity={0.7}
      >
        <View style={[styles.modeIconWrap, { backgroundColor: colors.accent }]}>
          <Ionicons name="desktop-outline" size={20} color={colors.white} />
        </View>
        <View style={styles.modeTextWrap}>
          <Text style={styles.modeTitle}>连接桌面端</Text>
          <Text style={styles.modeDesc}>扫码或输入配对码 · 推荐</Text>
        </View>
        <View style={styles.recommendBadge}>
          <Text style={styles.recommendText}>推荐</Text>
        </View>
      </TouchableOpacity>

      {/* 连接已有网关 */}
      <TouchableOpacity
        style={styles.modeCard}
        onPress={() => router.push('/onboarding/gateway')}
        activeOpacity={0.7}
      >
        <View style={[styles.modeIconWrap, { backgroundColor: colors.contrast }]}>
          <Ionicons name="globe-outline" size={20} color={colors.white} />
        </View>
        <View style={styles.modeTextWrap}>
          <Text style={styles.modeTitle}>连接已有网关</Text>
          <Text style={styles.modeDesc}>输入局域网或远程 Gateway 地址</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
      </TouchableOpacity>

      {/* 登录云端工作区 */}
      <TouchableOpacity
        style={styles.modeCard}
        onPress={() => router.push('/login')}
        activeOpacity={0.7}
      >
        <View style={[styles.modeIconWrap, { backgroundColor: colors.aux }]}>
          <Ionicons name="cloud-outline" size={20} color={colors.white} />
        </View>
        <View style={styles.modeTextWrap}>
          <Text style={styles.modeTitle}>登录云端工作区</Text>
          <Text style={styles.modeDesc}>使用账号登录后直接开始对话</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
      </TouchableOpacity>

      {/* 快捷操作 pills */}
      <View style={styles.quickRow}>
        <TouchableOpacity
          style={styles.quickPill}
          onPress={() => router.push('/onboarding/client')}
        >
          <Ionicons name="qr-code-outline" size={14} color={colors.textDefault} />
          <Text style={styles.quickPillText}>扫码连接</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickPill}
          onPress={() => router.push('/onboarding/client')}
        >
          <Ionicons name="keypad-outline" size={14} color={colors.textDefault} />
          <Text style={styles.quickPillText}>输入配对码</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickPill}
          onPress={() => router.push('/onboarding/gateway')}
        >
          <Ionicons name="create-outline" size={14} color={colors.textDefault} />
          <Text style={styles.quickPillText}>手动填写网关</Text>
        </TouchableOpacity>
      </View>

      {/* 桌面端准备提示 */}
      <View style={styles.tipCard}>
        <View style={styles.tipIconWrap}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.accent} />
        </View>
        <View style={styles.tipTextWrap}>
          <Text style={styles.tipTitle}>先在电脑端启动网关</Text>
          <Text style={styles.tipDesc}>开启局域网访问后，用电脑 IP 或配对码连接。</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.accent} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { padding: 16, paddingBottom: 100 },
  title: {
    ...textPresets.title,
    color: colors.textStrong,
    marginTop: 16,
  },
  subtitle: {
    ...textPresets.bodySmall,
    color: colors.textMuted,
    marginTop: 6,
    marginBottom: 20,
  },
  sectionTitle: {
    ...textPresets.subheading,
    color: colors.textStrong,
    marginBottom: 12,
  },

  /* mode cards */
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 58,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineSubtle,
    backgroundColor: colors.transparent,
    marginBottom: 8,
  },
  modeCardRecommended: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accentBorder,
  },
  modeIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTextWrap: {
    flex: 1,
    gap: 2,
  },
  modeTitle: {
    ...textPresets.cardTitle,
    color: colors.textStrong,
  },
  modeDesc: {
    ...textPresets.cardDescription,
    color: colors.textMuted,
  },
  recommendBadge: {
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  recommendText: {
    ...textPresets.caption,
    color: colors.white,
  },

  /* quick pills */
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    marginBottom: 16,
  },
  quickPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  quickPillText: {
    ...textPresets.caption,
    color: colors.textDefault,
  },

  /* tip card */
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 78,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.lineSubtle,
  },
  tipIconWrap: {
    paddingTop: 4,
  },
  tipTextWrap: {
    flex: 1,
    gap: 4,
  },
  tipTitle: {
    ...textPresets.body,
    color: colors.textStrong,
    fontWeight: '700',
  },
  tipDesc: {
    ...textPresets.bodySmall,
    color: colors.textMuted,
  },
});
