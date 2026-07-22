import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';

interface QuickCommand {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
  color: string;
  category: 'coding' | 'image' | 'research' | 'workspace';
}

const COMMANDS: QuickCommand[] = [
  {
    id: 'fix',
    icon: 'bug-outline',
    title: '修复这段代码',
    desc: '分析错误并提供修复方案',
    color: colors.danger,
    category: 'coding',
  },
  {
    id: 'explain',
    icon: 'book-outline',
    title: '解释这段代码',
    desc: '逐行解析代码逻辑',
    color: colors.aux,
    category: 'coding',
  },
  {
    id: 'test',
    icon: 'flask-outline',
    title: '编写单元测试',
    desc: '为当前代码生成测试用例',
    color: colors.success,
    category: 'coding',
  },
  {
    id: 'refactor',
    icon: 'git-branch-outline',
    title: '重构优化',
    desc: '改善代码结构和可读性',
    color: colors.contrast,
    category: 'coding',
  },
  {
    id: 'generate-image',
    icon: 'image-outline',
    title: '生成图片',
    desc: '用 AI 生成创意图片',
    color: colors.contrast,
    category: 'image',
  },
  {
    id: 'edit-image',
    icon: 'color-wand-outline',
    title: '编辑图片',
    desc: '修改已有图片的风格或内容',
    color: colors.accent,
    category: 'image',
  },
  {
    id: 'summarize',
    icon: 'document-text-outline',
    title: '总结文档',
    desc: '提取文档的关键信息',
    color: colors.aux,
    category: 'research',
  },
  {
    id: 'translate',
    icon: 'language-outline',
    title: '翻译内容',
    desc: '多语言翻译与本地化',
    color: colors.success,
    category: 'research',
  },
  {
    id: 'git-status',
    icon: 'git-commit-outline',
    title: '查看 Git 状态',
    desc: '检查工作区变更',
    color: colors.accent,
    category: 'workspace',
  },
  {
    id: 'run-tests',
    icon: 'play-circle-outline',
    title: '运行测试',
    desc: '执行项目测试套件',
    color: colors.success,
    category: 'workspace',
  },
];

const CATEGORIES = [
  { key: 'coding' as const, label: '编程协作', color: colors.accent },
  { key: 'image' as const, label: '图片创作', color: colors.contrast },
  { key: 'research' as const, label: '研究分析', color: colors.aux },
  { key: 'workspace' as const, label: '工作区', color: colors.success },
];

/** S28: 快捷命令与工作区能力 */
export default function QuickCommandsScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={18} color={colors.textDefault} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>快捷命令</Text>
        <View style={{ width: 36 }} />
      </View>

      <Text style={styles.title}>工作区能力</Text>
      <Text style={styles.subtitle}>一键触发常用操作，加速你的工作流。</Text>

      {/* Category filters */}
      <View style={styles.categoryRow}>
        {CATEGORIES.map((cat) => (
          <View key={cat.key} style={[styles.categoryChip, { borderColor: cat.color + '52' }]}>
            <View style={[styles.categoryDot, { backgroundColor: cat.color }]} />
            <Text style={[styles.categoryText, { color: cat.color }]}>{cat.label}</Text>
          </View>
        ))}
      </View>

      <FlatList
        data={COMMANDS}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.commandCard} activeOpacity={0.7}>
            <View style={[styles.commandIconWrap, { backgroundColor: item.color + '1A' }]}>
              <Ionicons name={item.icon} size={20} color={item.color} />
            </View>
            <View style={styles.commandTextWrap}>
              <Text style={styles.commandTitle}>{item.title}</Text>
              <Text style={styles.commandDesc}>{item.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
          </TouchableOpacity>
        )}
      />
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
    marginBottom: 8,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...textPresets.cardTitle, color: colors.textStrong },

  title: { ...textPresets.title, color: colors.textStrong, paddingHorizontal: 16 },
  subtitle: {
    ...textPresets.body,
    color: colors.textMuted,
    paddingHorizontal: 16,
    marginTop: 6,
    marginBottom: 16,
  },

  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  categoryDot: { width: 6, height: 6, borderRadius: 3 },
  categoryText: { ...textPresets.caption, fontWeight: '600' },

  listContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 100 },
  commandCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 14,
  },
  commandIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commandTextWrap: { flex: 1, gap: 2 },
  commandTitle: { ...textPresets.cardTitle, color: colors.textStrong },
  commandDesc: { ...textPresets.cardDescription, color: colors.textMuted },
});
