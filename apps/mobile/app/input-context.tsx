import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';

interface ContextItem {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  color: string;
  type: 'file' | 'symbol' | 'history' | 'reference';
}

const CONTEXT_ITEMS: ContextItem[] = [
  {
    id: '1',
    icon: 'document-text-outline',
    label: 'auth.ts',
    description: '认证模块 — 当前编辑文件',
    color: colors.accent,
    type: 'file',
  },
  {
    id: '2',
    icon: 'document-text-outline',
    label: 'gateway-client.ts',
    description: 'WebSocket 客户端 — 上下文引用',
    color: colors.aux,
    type: 'file',
  },
  {
    id: '3',
    icon: 'code-slash-outline',
    label: 'MobileGatewayClient',
    description: '类 · gateway-client.ts:57',
    color: colors.contrast,
    type: 'symbol',
  },
  {
    id: '4',
    icon: 'code-slash-outline',
    label: 'useAuthStore',
    description: 'Hook · store/auth.ts:43',
    color: colors.contrast,
    type: 'symbol',
  },
  {
    id: '5',
    icon: 'chatbubble-outline',
    label: '上一轮对话',
    description: '关于 Token 刷新间隔的讨论',
    color: colors.textMuted,
    type: 'history',
  },
  {
    id: '6',
    icon: 'link-outline',
    label: 'WebSocket 协议文档',
    description: 'RFC 6455 参考',
    color: colors.success,
    type: 'reference',
  },
];

const TYPE_LABELS = {
  file: '文件',
  symbol: '符号',
  history: '历史',
  reference: '引用',
};

/** S30: 输入聚焦与上下文 */
export default function InputContextScreen() {
  return (
    <Screen>
      <ScreenHeader
        title="上下文管理"
        right={
          <TouchableOpacity style={styles.headerAction}>
            <Ionicons name="options-outline" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        }
      />

      <Text style={styles.title}>当前上下文</Text>
      <Text style={styles.subtitle}>管理发送给 AI 的上下文信息，控制对话范围。</Text>

      {/* Context stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>6</Text>
          <Text style={styles.statLabel}>上下文项</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>2.4K</Text>
          <Text style={styles.statLabel}>Token 估算</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>128K</Text>
          <Text style={styles.statLabel}>模型上限</Text>
        </View>
      </View>

      {/* Context items */}
      <Text style={styles.sectionTitle}>上下文项</Text>
      <FlatList
        data={CONTEXT_ITEMS}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.contextCard}>
            <View style={[styles.contextIconWrap, { backgroundColor: item.color + '1A' }]}>
              <Ionicons name={item.icon} size={16} color={item.color} />
            </View>
            <View style={styles.contextInfo}>
              <Text style={styles.contextLabel}>{item.label}</Text>
              <Text style={styles.contextDesc}>{item.description}</Text>
            </View>
            <View style={[styles.typeBadge, { borderColor: item.color + '52' }]}>
              <Text style={[styles.typeText, { color: item.color }]}>{TYPE_LABELS[item.type]}</Text>
            </View>
            <TouchableOpacity style={styles.removeBtn}>
              <Ionicons name="close-circle-outline" size={18} color={colors.textSubtle} />
            </TouchableOpacity>
          </View>
        )}
      />

      {/* Add context */}
      <TouchableOpacity style={styles.addBtn}>
        <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
        <Text style={styles.addText}>添加上下文</Text>
      </TouchableOpacity>
    </Screen>
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
    marginBottom: 8,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...textPresets.cardTitle, color: colors.textStrong },
  headerAction: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  title: { ...textPresets.title, color: colors.textStrong, paddingHorizontal: 16, fontSize: 22 },
  subtitle: {
    ...textPresets.body,
    color: colors.textMuted,
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 16,
  },

  statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 16 },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 12,
    alignItems: 'center',
    gap: 2,
  },
  statValue: { ...textPresets.subheading, color: colors.textStrong, fontSize: 18 },
  statLabel: { ...textPresets.caption, color: colors.textMuted },

  sectionTitle: {
    ...textPresets.subheading,
    color: colors.textStrong,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  listContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 16 },
  contextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 10,
  },
  contextIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextInfo: { flex: 1, gap: 1 },
  contextLabel: { ...textPresets.bodySmall, color: colors.textStrong, fontWeight: '600' },
  contextDesc: { ...textPresets.caption, color: colors.textMuted },
  typeBadge: {
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  typeText: { ...textPresets.caption, fontWeight: '600' },
  removeBtn: { padding: 4 },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 16,
    height: 44,
    backgroundColor: colors.accentMuted,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  addText: { ...textPresets.label, color: colors.accent },
});
