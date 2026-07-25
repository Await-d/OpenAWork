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
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { createSessionsClient } from '@openAwork/web-client';
import type { SessionTodo } from '@openAwork/web-client';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';
import { useAuthStore } from '../src/store/auth';

interface ContextItem {
  id: string;
  label: string;
  description: string;
  type: 'todo' | 'message' | 'file' | 'reference';
}

const TYPE_ICONS: Record<ContextItem['type'], keyof typeof Ionicons.glyphMap> = {
  todo: 'checkbox-outline',
  message: 'chatbubble-outline',
  file: 'document-text-outline',
  reference: 'link-outline',
};

const TYPE_COLORS: Record<ContextItem['type'], string> = {
  todo: colors.accent,
  message: colors.aux,
  file: colors.contrast,
  reference: colors.success,
};

const TYPE_LABELS: Record<ContextItem['type'], string> = {
  todo: '待办',
  message: '消息',
  file: '文件',
  reference: '引用',
};

/** S30: 输入聚焦与上下文 */
export default function InputContextScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const { accessToken, gatewayUrl } = useAuthStore();
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadContext = useCallback(async () => {
    if (!accessToken || !gatewayUrl) {
      setError('请先登录并连接网关');
      setLoading(false);
      return;
    }
    if (!sessionId) {
      setError('缺少会话 ID，请从聊天页面进入');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const client = createSessionsClient(gatewayUrl);
      const [todos, session] = await Promise.all([
        client.getTodos(accessToken, sessionId).catch(() => [] as SessionTodo[]),
        client.get(accessToken, sessionId).catch(() => null),
      ]);
      const items: ContextItem[] = [];
      // 从 TODO 列表构建上下文项
      for (const todo of todos.slice(0, 10)) {
        items.push({
          id: `todo-${todo.content.slice(0, 20)}`,
          label: todo.content.slice(0, 60),
          description: `优先级：${todo.priority} · 状态：${todo.status}`,
          type: 'todo',
        });
      }
      // 从会话消息构建引用
      if (session?.messages && session.messages.length > 0) {
        const recentMessages = session.messages.slice(-3);
        for (const msg of recentMessages) {
          const textContent = msg.content?.find((c) => c.type === 'text');
          if (textContent && 'text' in textContent) {
            items.push({
              id: `msg-${msg.id ?? Math.random()}`,
              label: `${msg.role === 'user' ? '用户' : '助手'}消息`,
              description: textContent.text.slice(0, 80),
              type: 'message',
            });
          }
        }
      }
      setContextItems(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载上下文失败');
    } finally {
      setLoading(false);
    }
  }, [accessToken, gatewayUrl, sessionId]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  function handleRemove(id: string) {
    setContextItems((prev) => prev.filter((item) => item.id !== id));
  }

  function handleAdd() {
    Alert.alert('提示', '请从聊天页面选择文件或代码片段添加为上下文');
  }

  return (
    <Screen>
      <ScreenHeader
        title="上下文管理"
        right={
          <TouchableOpacity
            style={styles.headerAction}
            onPress={() => {
              setLoading(true);
              void loadContext();
            }}
          >
            <Ionicons name="refresh-outline" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        }
      />

      <Text style={styles.title}>当前上下文</Text>
      <Text style={styles.subtitle}>管理发送给 AI 的上下文信息，控制对话范围。</Text>

      {/* Context stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{contextItems.length}</Text>
          <Text style={styles.statLabel}>上下文项</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {contextItems.filter((c) => c.type === 'todo').length}
          </Text>
          <Text style={styles.statLabel}>待办</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {contextItems.filter((c) => c.type === 'message').length}
          </Text>
          <Text style={styles.statLabel}>消息</Text>
        </View>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryLink}
            onPress={() => {
              setLoading(true);
              void loadContext();
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

      {/* Context items */}
      {!loading ? (
        <>
          <Text style={styles.sectionTitle}>上下文项</Text>
          <FlatList
            data={contextItems}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Ionicons name="layers-outline" size={40} color={colors.textSubtle} />
                <Text style={styles.emptyTitle}>暂无上下文</Text>
                <Text style={styles.emptyDesc}>会话中的待办和消息将自动出现在这里</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.contextCard}>
                <View
                  style={[
                    styles.contextIconWrap,
                    { backgroundColor: TYPE_COLORS[item.type] + '1A' },
                  ]}
                >
                  <Ionicons name={TYPE_ICONS[item.type]} size={16} color={TYPE_COLORS[item.type]} />
                </View>
                <View style={styles.contextInfo}>
                  <Text style={styles.contextLabel} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text style={styles.contextDesc} numberOfLines={2}>
                    {item.description}
                  </Text>
                </View>
                <View style={[styles.typeBadge, { borderColor: TYPE_COLORS[item.type] + '52' }]}>
                  <Text style={[styles.typeText, { color: TYPE_COLORS[item.type] }]}>
                    {TYPE_LABELS[item.type]}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.removeBtn}
                  activeOpacity={0.6}
                  onPress={() => handleRemove(item.id)}
                >
                  <Ionicons name="close-circle-outline" size={18} color={colors.textSubtle} />
                </TouchableOpacity>
              </View>
            )}
          />

          {/* Add context */}
          <TouchableOpacity style={styles.addBtn} activeOpacity={0.7} onPress={handleAdd}>
            <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
            <Text style={styles.addText}>添加上下文</Text>
          </TouchableOpacity>
        </>
      ) : null}
    </Screen>
  );
}

// useLocalSearchParams 已在文件顶部导入

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  headerAction: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  title: { ...textPresets.title, color: colors.textStrong, paddingHorizontal: 16, fontSize: 22 },
  subtitle: {
    ...textPresets.body,
    color: colors.textMuted,
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 16,
  },

  loadingBox: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  loadingText: { ...textPresets.caption, color: colors.textMuted },

  errorBox: { marginHorizontal: 16, marginBottom: 12, gap: 8, alignItems: 'center' },
  errorText: { ...textPresets.body, color: colors.danger, textAlign: 'center' },
  retryLink: { paddingHorizontal: 12, paddingVertical: 6 },
  retryLinkText: { ...textPresets.label, color: colors.accent },

  emptyBox: { alignItems: 'center', gap: 8, paddingTop: 40 },
  emptyTitle: { ...textPresets.subheading, color: colors.textStrong },
  emptyDesc: { ...textPresets.body, color: colors.textMuted, textAlign: 'center' },

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
