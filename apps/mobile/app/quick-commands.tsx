import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { createCommandsClient } from '@openAwork/web-client';
import type { CommandDescriptor } from '@openAwork/shared';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';
import { useAuthStore } from '../src/store/auth';

const CATEGORY_COLORS: Record<string, string> = {
  coding: colors.accent,
  image: colors.contrast,
  research: colors.aux,
  workspace: colors.success,
  default: colors.textMuted,
};

const FALLBACK_COMMANDS: Array<{
  id: string;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  category: string;
}> = [
  {
    id: 'fix',
    label: '修复这段代码',
    description: '分析错误并提供修复方案',
    icon: 'bug-outline',
    category: 'coding',
  },
  {
    id: 'explain',
    label: '解释这段代码',
    description: '逐行解析代码逻辑',
    icon: 'book-outline',
    category: 'coding',
  },
  {
    id: 'test',
    label: '编写单元测试',
    description: '为当前代码生成测试用例',
    icon: 'flask-outline',
    category: 'coding',
  },
  {
    id: 'refactor',
    label: '重构优化',
    description: '改善代码结构和可读性',
    icon: 'git-branch-outline',
    category: 'coding',
  },
  {
    id: 'summarize',
    label: '总结文档',
    description: '提取文档的关键信息',
    icon: 'document-text-outline',
    category: 'research',
  },
  {
    id: 'translate',
    label: '翻译内容',
    description: '多语言翻译与本地化',
    icon: 'language-outline',
    category: 'research',
  },
  {
    id: 'git-status',
    label: '查看 Git 状态',
    description: '检查工作区变更',
    icon: 'git-commit-outline',
    category: 'workspace',
  },
  {
    id: 'run-tests',
    label: '运行测试',
    description: '执行项目测试套件',
    icon: 'play-circle-outline',
    category: 'workspace',
  },
];

function inferCategory(cmd: CommandDescriptor): string {
  const id = cmd.id.toLowerCase();
  const label = cmd.label.toLowerCase();
  if (id.includes('image') || label.includes('图片')) return 'image';
  if (
    id.includes('git') ||
    id.includes('test') ||
    id.includes('workspace') ||
    label.includes('git') ||
    label.includes('测试')
  ) {
    return 'workspace';
  }
  if (
    id.includes('translate') ||
    id.includes('summarize') ||
    label.includes('翻译') ||
    label.includes('总结')
  ) {
    return 'research';
  }
  return 'coding';
}

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  coding: 'code-slash-outline',
  image: 'image-outline',
  research: 'document-text-outline',
  workspace: 'git-branch-outline',
  default: 'terminal-outline',
};

type CommandCardItem = {
  id: string;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  category: string;
  color: string;
  descriptor: CommandDescriptor | null;
};

/** S28: 快捷命令与工作区能力 */
export default function QuickCommandsScreen() {
  const { accessToken, gatewayUrl } = useAuthStore();
  const [commands, setCommands] = useState<CommandDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState<string | null>(null);

  const loadCommands = useCallback(async () => {
    if (!accessToken || !gatewayUrl) {
      setLoading(false);
      return;
    }
    try {
      const client = createCommandsClient(gatewayUrl);
      const list = await client.list(accessToken);
      const filtered = list.filter(
        (c) => c.contexts.includes('palette') || c.contexts.includes('composer'),
      );
      setCommands(filtered.length > 0 ? filtered : []);
    } catch {
      // 命令列表加载失败时使用 fallback
      setCommands([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, gatewayUrl]);

  useEffect(() => {
    void loadCommands();
  }, [loadCommands]);

  const hasRealCommands = commands.length > 0;
  const displayItems: CommandCardItem[] = hasRealCommands
    ? commands.map((c) => ({
        id: c.id,
        label: c.label,
        description: c.description ?? '',
        icon: CATEGORY_ICONS[inferCategory(c)] ?? CATEGORY_ICONS.default!,
        category: inferCategory(c),
        color: CATEGORY_COLORS[inferCategory(c)] ?? CATEGORY_COLORS.default!,
        descriptor: c,
      }))
    : FALLBACK_COMMANDS.map((c) => ({
        ...c,
        color: CATEGORY_COLORS[c.category] ?? CATEGORY_COLORS.default!,
        descriptor: null,
      }));

  const categories = Array.from(new Set(displayItems.map((c) => c.category)));

  async function handleExecute(item: CommandCardItem) {
    if (!item.descriptor) {
      // fallback 命令——导航到新会话
      router.push('/sessions/new');
      return;
    }
    if (!accessToken || !gatewayUrl) {
      Alert.alert('提示', '请先登录');
      return;
    }
    setExecuting(item.id);
    try {
      // 命令需要 sessionId 才能执行，导航到会话列表让用户选择
      router.push('/sessions');
    } catch (e) {
      Alert.alert('执行失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setExecuting(null);
    }
  }

  return (
    <Screen>
      <ScreenHeader title="快捷命令" />

      <Text style={styles.title}>工作区能力</Text>
      <Text style={styles.subtitle}>一键触发常用操作，加速你的工作流。</Text>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>加载中…</Text>
        </View>
      ) : null}

      {/* Category filters */}
      <View style={styles.categoryRow}>
        {categories.map((cat) => {
          const color = CATEGORY_COLORS[cat] ?? colors.textMuted;
          return (
            <View key={cat} style={[styles.categoryChip, { borderColor: color + '52' }]}>
              <View style={[styles.categoryDot, { backgroundColor: color }]} />
              <Text style={[styles.categoryText, { color }]}>{cat}</Text>
            </View>
          );
        })}
      </View>

      <FlatList
        data={displayItems}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyBox}>
              <Ionicons name="terminal-outline" size={40} color={colors.textSubtle} />
              <Text style={styles.emptyTitle}>暂无快捷命令</Text>
              <Text style={styles.emptyDesc}>连接网关后将加载可用命令</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.commandCard}
            activeOpacity={0.7}
            disabled={executing === item.id}
            onPress={() => void handleExecute(item)}
          >
            <View style={[styles.commandIconWrap, { backgroundColor: item.color + '1A' }]}>
              {executing === item.id ? (
                <ActivityIndicator color={item.color} size="small" />
              ) : (
                <Ionicons name={item.icon} size={20} color={item.color} />
              )}
            </View>
            <View style={styles.commandTextWrap}>
              <Text style={styles.commandTitle}>{item.label}</Text>
              {item.description ? <Text style={styles.commandDesc}>{item.description}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
          </TouchableOpacity>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },

  title: { ...textPresets.title, color: colors.textStrong, paddingHorizontal: 16 },
  subtitle: {
    ...textPresets.body,
    color: colors.textMuted,
    paddingHorizontal: 16,
    marginTop: 6,
    marginBottom: 16,
  },

  loadingBox: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  loadingText: { ...textPresets.caption, color: colors.textMuted },

  emptyBox: { alignItems: 'center', gap: 8, paddingTop: 40 },
  emptyTitle: { ...textPresets.subheading, color: colors.textStrong },
  emptyDesc: { ...textPresets.body, color: colors.textMuted, textAlign: 'center' },

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

  listContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 32 },
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
