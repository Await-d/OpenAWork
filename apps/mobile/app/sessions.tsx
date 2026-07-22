import { useState, useEffect, useCallback } from 'react';
import { createSessionsClient } from '@openAwork/web-client';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TextInput,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../src/store/auth';
import { listSessions, upsertSession } from '../src/db/session-store';
import type { LocalSession } from '../src/db/session-store';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';

type FilterKey = 'active' | 'draft' | 'synced' | 'pinned';

const FILTERS: Array<{ key: FilterKey; label: string; color: string; bg: string; border: string }> =
  [
    {
      key: 'active',
      label: '进行中',
      color: colors.accent,
      bg: colors.accentMuted,
      border: colors.accentBorder,
    },
    {
      key: 'draft',
      label: '草稿',
      color: colors.contrast,
      bg: colors.contrastMuted,
      border: colors.contrastBorder,
    },
    {
      key: 'synced',
      label: '已同步',
      color: colors.aux,
      bg: colors.auxMuted,
      border: colors.auxBorder,
    },
    {
      key: 'pinned',
      label: '置顶',
      color: colors.textMuted,
      bg: colors.surface2,
      border: colors.lineDefault,
    },
  ];

/** Status badge for session cards. */
function StatusBadge({ status }: { status: 'running' | 'draft' | 'done' }) {
  if (status === 'running') {
    return (
      <View
        style={[
          badgeStyles.badge,
          { backgroundColor: colors.successMuted, borderColor: colors.successBorder },
        ]}
      >
        <Text style={[badgeStyles.text, { color: colors.success }]}>运行中</Text>
      </View>
    );
  }
  if (status === 'draft') {
    return (
      <View
        style={[
          badgeStyles.badge,
          { backgroundColor: colors.surface2, borderColor: colors.lineDefault },
        ]}
      >
        <Text style={[badgeStyles.text, { color: colors.textMuted }]}>草稿</Text>
      </View>
    );
  }
  return null;
}

const badgeStyles = StyleSheet.create({
  badge: {
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  text: { ...textPresets.caption, fontWeight: '600' },
});

/** S3: 会话列表 */
export default function SessionsScreen() {
  const { accessToken, gatewayUrl, logout } = useAuthStore();
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterKey | null>('active');

  const fetchSessions = useCallback(async () => {
    const local = await listSessions();
    if (local.length > 0) {
      setSessions(local);
      setLoading(false);
    }

    if (!accessToken) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      let remote: Array<{
        id: string;
        title: string | null;
        created_at: string;
        updated_at: string;
      }> = [];
      try {
        remote = (await createSessionsClient(gatewayUrl).list(
          accessToken ?? '',
        )) as unknown as typeof remote;
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('401')) {
          await logout();
          router.replace('/login');
          return;
        }
        throw e;
      }

      await Promise.all(
        remote.map((s) =>
          upsertSession({
            id: s.id,
            title: s.title,
            messages_json: '[]',
            draft: '',
            created_at: new Date(s.created_at).getTime(),
            updated_at: new Date(s.updated_at).getTime(),
          }),
        ),
      );
      setSessions(await listSessions());
    } catch {
      if (local.length === 0) Alert.alert('错误', '加载会话列表失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken, gatewayUrl, logout]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  async function createSession() {
    if (!accessToken) return;
    try {
      const session = await createSessionsClient(gatewayUrl).create(accessToken ?? '');
      router.push(`/chat/${session.id}`);
    } catch {
      Alert.alert('错误', '创建会话失败');
    }
  }

  function formatRelative(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return '刚刚';
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
    return new Date(iso).toLocaleDateString();
  }

  function getInitial(title: string | null): string {
    const t = (title ?? '').trim();
    if (!t) return '?';
    // Use first letter, or first CJK character
    return t.charAt(0).toUpperCase();
  }

  const filteredSessions = sessions.filter((s) => {
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (s.title ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>会话</Text>
        <TouchableOpacity onPress={() => void createSession()} style={styles.newBtn}>
          <Ionicons name="add" size={16} color={colors.accent} />
          <Text style={styles.newBtnText}>新建</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.headerSubtitle}>把进行中、草稿、已同步任务收进同一入口。</Text>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={19} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="搜索会话、标题、消息或任务"
          placeholderTextColor={colors.textSubtle}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const isActive = activeFilter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.filterChip,
                isActive && { backgroundColor: f.bg, borderColor: f.border },
              ]}
              onPress={() => setActiveFilter(isActive ? null : f.key)}
            >
              <Text style={[styles.filterText, isActive && { color: f.color }]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Section header */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>最近会话</Text>
        <TouchableOpacity>
          <Text style={styles.sectionManage}>管理</Text>
        </TouchableOpacity>
      </View>

      {/* Session list */}
      <FlatList
        data={filteredSessions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          filteredSessions.length === 0 ? styles.emptyContainer : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void fetchSessions();
            }}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={40} color={colors.textSubtle} />
            <Text style={styles.emptyText}>暂无会话</Text>
            <Text style={styles.emptySubtext}>点击 + 新建开始对话</Text>
          </View>
        }
        ListFooterComponent={
          filteredSessions.length > 0 ? (
            <View style={styles.hintCard}>
              <Ionicons name="time-outline" size={17} color={colors.textMuted} />
              <Text style={styles.hintText}>下拉可查看归档、失败与已删除会话。</Text>
            </View>
          ) : null
        }
        renderItem={({ item, index }) => {
          const isFirst = index === 0;
          const initial = getInitial(item.title);
          return (
            <TouchableOpacity
              style={[styles.sessionCard, isFirst && styles.sessionCardActive]}
              onPress={() => router.push(`/chat/${item.id}`)}
              activeOpacity={0.7}
            >
              {/* Icon */}
              <View style={[styles.sessionIcon, isFirst && styles.sessionIconActive]}>
                <Text style={[styles.sessionIconText, isFirst && styles.sessionIconTextActive]}>
                  {initial}
                </Text>
              </View>

              {/* Text */}
              <View style={styles.sessionTextWrap}>
                <Text style={styles.sessionTitle} numberOfLines={1}>
                  {item.title ?? '未命名会话'}
                </Text>
                <Text style={styles.sessionMeta}>
                  {item.draft ? '草稿' : '会话'} ·{' '}
                  {formatRelative(new Date(item.updated_at).toISOString())}
                </Text>
              </View>

              {/* Status badge */}
              <StatusBadge status={isFirst ? 'running' : item.draft ? 'draft' : 'done'} />

              <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bgBase,
  },

  /* header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  headerTitle: { ...textPresets.title, color: colors.textStrong },
  headerSubtitle: {
    ...textPresets.bodySmall,
    color: colors.textMuted,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accentMuted,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  newBtnText: { ...textPresets.label, color: colors.accent },

  /* search */
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 44,
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    ...textPresets.body,
    color: colors.textStrong,
    padding: 0,
  },

  /* filters */
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  filterChip: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    backgroundColor: colors.surface2,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  filterText: { ...textPresets.caption, color: colors.textMuted, fontWeight: '600' },

  /* section header */
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  sectionTitle: { ...textPresets.subheading, color: colors.textStrong },
  sectionManage: { ...textPresets.label, color: colors.accent },

  /* list */
  listContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 100 },

  /* session card */
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 66,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingHorizontal: 12,
  },
  sessionCardActive: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accentBorder,
  },
  sessionIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.md,
    backgroundColor: colors.accentMuted,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionIconActive: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accentBorder,
  },
  sessionIconText: {
    ...textPresets.subheading,
    color: colors.accent,
  },
  sessionIconTextActive: {
    color: colors.accent,
  },
  sessionTextWrap: {
    flex: 1,
    gap: 2,
  },
  sessionTitle: {
    ...textPresets.cardTitle,
    color: colors.textStrong,
  },
  sessionMeta: {
    ...textPresets.cardDescription,
    color: colors.textMuted,
  },

  /* empty */
  emptyContainer: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 120, gap: 8 },
  emptyText: { ...textPresets.subheading, color: colors.textStrong },
  emptySubtext: { ...textPresets.body, color: colors.textMuted },

  /* hint */
  hintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 48,
    backgroundColor: colors.surfaceSoft,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineSubtle,
    paddingHorizontal: 14,
    marginTop: 8,
  },
  hintText: { ...textPresets.bodySmall, color: colors.textMuted },
});
