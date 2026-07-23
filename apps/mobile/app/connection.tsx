import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/Screen';
import { Chip, PageHeader, SurfaceCard } from '../src/components/ui';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';

/** S1: 连接方式选择 */
export default function ConnectionScreen() {
  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <PageHeader
          title="连接你的工作台"
          subtitle="手机端连接已运行的桌面端、已有网关或云端工作区。"
          style={styles.pageHeader}
        />

        <Text style={styles.sectionTitle}>连接入口</Text>

        <SurfaceCard variant="default" radius="lg" padding={0} style={styles.entryGroup}>
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

          <View style={styles.divider} />

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

          <View style={styles.divider} />

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
        </SurfaceCard>

        <View style={styles.quickRow}>
          <Chip
            label="扫码连接"
            tone="default"
            selected
            icon={<Ionicons name="qr-code-outline" size={14} color={colors.textDefault} />}
            onPress={() => router.push('/onboarding/client')}
          />
          <Chip
            label="输入配对码"
            tone="default"
            selected
            icon={<Ionicons name="keypad-outline" size={14} color={colors.textDefault} />}
            onPress={() => router.push('/onboarding/client')}
          />
          <Chip
            label="手动填写网关"
            tone="default"
            selected
            icon={<Ionicons name="create-outline" size={14} color={colors.textDefault} />}
            onPress={() => router.push('/onboarding/gateway')}
          />
        </View>

        <SurfaceCard variant="soft" radius="md" style={styles.tipCard}>
          <TouchableOpacity
            style={styles.tipRow}
            activeOpacity={0.7}
            onPress={() => router.push('/onboarding/gateway')}
          >
            <Ionicons name="checkmark-circle-outline" size={18} color={colors.accent} />
            <View style={styles.tipTextWrap}>
              <Text style={styles.tipTitle}>先在电脑端启动网关</Text>
              <Text style={styles.tipDesc}>开启局域网访问后，用电脑 IP 或配对码连接。</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.accent} />
          </TouchableOpacity>
        </SurfaceCard>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { paddingBottom: 32, gap: 0 },
  pageHeader: { paddingHorizontal: 16, marginBottom: 8 },
  sectionTitle: {
    ...textPresets.subheading,
    color: colors.textStrong,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  entryGroup: {
    marginHorizontal: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.surface1,
  },
  modeCardRecommended: {
    backgroundColor: colors.accentMuted,
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
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.lineSubtle,
    marginLeft: 56,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  tipCard: {
    marginHorizontal: 16,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
