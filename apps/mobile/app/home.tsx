import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { createSessionsClient } from '@openAwork/web-client';
import { Screen } from '../src/components/Screen';
import { PageHeader, SectionLabel, StatusBadge, SurfaceCard } from '../src/components/ui';
import { useBottomNavContentInset } from '../src/layout/use-bottom-nav-inset';
import { listSessions, type LocalSession } from '../src/db/session-store';
import { useAuthStore } from '../src/store/auth';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';

const QUICK_ACTIONS: Array<{
  id: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: string;
  color: string;
  bg: string;
  border: string;
}> = [
  {
    id: 'new-chat',
    title: '新会话',
    icon: 'chatbubble-ellipses-outline',
    href: '/sessions/new',
    color: colors.accent,
    bg: colors.accentMuted,
    border: colors.accentBorder,
  },
  {
    id: 'tasks',
    title: 'Agent 任务',
    icon: 'hardware-chip-outline',
    href: '/agent-tasks',
    color: colors.contrast,
    bg: colors.contrastMuted,
    border: colors.contrastBorder,
  },
  {
    id: 'image',
    title: '图片工作台',
    icon: 'image-outline',
    href: '/image-workspace',
    color: colors.aux,
    bg: colors.auxMuted,
    border: colors.auxBorder,
  },
  {
    id: 'settings',
    title: '设置',
    icon: 'settings-outline',
    href: '/settings',
    color: colors.textDefault,
    bg: colors.surface2,
    border: colors.lineDefault,
  },
];

function formatRelative(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 60_000) return '刚刚';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function sessionMark(title: string | null): string {
  const t = (title ?? '会话').trim();
  return (t[0] ?? 'S').toUpperCase();
}

/** S00: 工作台首页 — 登录/重开落地页 */
export default function HomeWorkbenchScreen() {
  const { gatewayUrl, accessToken } = useAuthStore();
  const bottomInset = useBottomNavContentInset();
  const [recent, setRecent] = useState<LocalSession[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  const loadRecent = useCallback(async () => {
    setLoadingRecent(true);
    try {
      const local = await listSessions();
      setRecent(local.slice(0, 3));
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  async function openSession(sessionId: string) {
    router.push(`/chat/${sessionId}`);
  }

  async function createSession() {
    if (!accessToken) {
      router.push('/sessions/new');
      return;
    }
    try {
      const session = await createSessionsClient(gatewayUrl).create(accessToken);
      router.push(`/chat/${session.id}`);
    } catch {
      router.push('/sessions/new');
    }
  }

  return (
    <Screen>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
      >
        <PageHeader
          title="工作台"
          subtitle="下午好 · 继续会话、任务与网关状态"
          style={styles.pageHeader}
          action={
            <View style={styles.headerRight}>
              <View style={[styles.connPill, !accessToken && styles.connPillOff]}>
                <View style={[styles.connDot, !accessToken && styles.connDotOff]} />
                <Text style={[styles.connText, !accessToken && styles.connTextOff]}>
                  {accessToken ? '已连接' : '未连接'}
                </Text>
              </View>
            </View>
          }
        />

        <SurfaceCard variant="default" radius="lg" style={styles.gatewayCard}>
          <View style={styles.gatewayTop}>
            <View style={styles.gatewayLeft}>
              <View style={styles.gatewayIcon}>
                <Ionicons name="server-outline" size={16} color={colors.accent} />
              </View>
              <View style={styles.gatewayText}>
                <Text style={styles.gatewayTitle}>本地网关</Text>
                <Text style={styles.gatewayMeta} numberOfLines={1}>
                  {gatewayUrl || '尚未配置网关'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => router.push(accessToken ? '/settings' : '/connection')}
            >
              <Text style={styles.gatewayAction}>{accessToken ? '切换' : '连接'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.metricsRow}>
            <View style={styles.metricCell}>
              <Text style={[styles.metricValue, { color: colors.success }]}>
                {accessToken ? '在线' : '—'}
              </Text>
              <Text style={styles.metricLabel}>状态</Text>
            </View>
            <View style={styles.metricCell}>
              <Text style={[styles.metricValue, { color: colors.accent }]}>{recent.length}</Text>
              <Text style={styles.metricLabel}>最近</Text>
            </View>
            <View style={styles.metricCell}>
              <Text style={[styles.metricValue, { color: colors.contrast }]}>任务</Text>
              <Text style={styles.metricLabel}>入口</Text>
            </View>
          </View>
        </SurfaceCard>

        <SectionLabel title="常用功能" inset style={styles.section} />
        <View style={styles.quickGrid}>
          {QUICK_ACTIONS.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.quickCard, { backgroundColor: item.bg, borderColor: item.border }]}
              activeOpacity={0.75}
              onPress={() => {
                if (item.id === 'new-chat') {
                  void createSession();
                  return;
                }
                router.push(item.href);
              }}
            >
              <View style={styles.quickIcon}>
                <Ionicons name={item.icon} size={16} color={item.color} />
              </View>
              <Text style={styles.quickTitle}>{item.title}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <SectionLabel
          title="继续上次"
          actionLabel="全部会话"
          onActionPress={() => router.push('/sessions')}
          style={styles.section}
        />
        <SurfaceCard variant="default" radius="lg" padding={0} style={styles.listCard}>
          {loadingRecent ? (
            <View style={styles.emptyBox}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : recent.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>暂无会话</Text>
              <Text style={styles.emptyDesc}>创建第一条会话，开始协作。</Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => void createSession()}>
                <Text style={styles.emptyBtnText}>新建会话</Text>
              </TouchableOpacity>
            </View>
          ) : (
            recent.map((session, index) => (
              <View key={session.id}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <TouchableOpacity
                  style={styles.sessionRow}
                  activeOpacity={0.7}
                  onPress={() => void openSession(session.id)}
                >
                  <View style={styles.sessionMark}>
                    <Text style={styles.sessionMarkText}>{sessionMark(session.title)}</Text>
                  </View>
                  <View style={styles.sessionText}>
                    <Text style={styles.sessionTitle} numberOfLines={1}>
                      {session.title?.trim() || '未命名会话'}
                    </Text>
                    <Text style={styles.sessionMeta} numberOfLines={1}>
                      最近活动 · {formatRelative(session.updated_at)}
                    </Text>
                  </View>
                  <StatusBadge tone="running" label="继续" />
                  <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </SurfaceCard>

        <SectionLabel
          title="进行中的任务"
          actionLabel="查看全部"
          onActionPress={() => router.push('/agent-tasks')}
          style={styles.section}
        />
        <SurfaceCard variant="default" radius="lg" style={styles.taskCard}>
          <View style={styles.taskTop}>
            <View style={styles.taskLeft}>
              <View style={styles.taskIcon}>
                <Ionicons name="hardware-chip-outline" size={14} color={colors.contrast} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.taskTitle}>Agent 任务</Text>
                <Text style={styles.taskMeta}>查看运行中任务与产物</Text>
              </View>
            </View>
            <StatusBadge tone="running" label="入口" />
          </View>
          <View style={styles.taskActions}>
            <TouchableOpacity
              style={styles.taskSecondary}
              onPress={() => router.push('/agent-tasks')}
            >
              <Text style={styles.taskSecondaryText}>查看详情</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.taskPrimary} onPress={() => router.push('/sessions')}>
              <Text style={styles.taskPrimaryText}>打开会话</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.white} />
            </TouchableOpacity>
          </View>
        </SurfaceCard>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { paddingBottom: 24 },
  pageHeader: { marginBottom: 4 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  connPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.successMuted,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  connPillOff: {
    backgroundColor: colors.surface2,
    borderColor: colors.lineDefault,
  },
  connDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  connDotOff: { backgroundColor: colors.textMuted },
  connText: { ...textPresets.caption, color: colors.success, fontWeight: '700' },
  connTextOff: { color: colors.textMuted },
  gatewayCard: {
    marginHorizontal: 16,
    gap: 12,
  },
  gatewayTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  gatewayLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  gatewayIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.accentMuted,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gatewayText: { flex: 1, gap: 2 },
  gatewayTitle: { ...textPresets.body, color: colors.textStrong, fontWeight: '700' },
  gatewayMeta: { ...textPresets.caption, color: colors.textMuted, fontFamily: 'monospace' },
  gatewayAction: { ...textPresets.label, color: colors.accent, fontWeight: '700' },
  metricsRow: { flexDirection: 'row', gap: 8 },
  metricCell: {
    flex: 1,
    backgroundColor: colors.surfaceSoft,
    borderRadius: radii.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  metricValue: { ...textPresets.body, fontWeight: '700' },
  metricLabel: { ...textPresets.caption, color: colors.textMuted },
  section: { marginTop: 8 },
  quickGrid: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 8,
  },
  quickCard: {
    flex: 1,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  quickIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.surface1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickTitle: { ...textPresets.caption, color: colors.textStrong, fontWeight: '700' },
  listCard: { marginHorizontal: 16, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.lineSubtle },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  sessionMark: {
    width: 34,
    height: 34,
    borderRadius: radii.md,
    backgroundColor: colors.accentMuted,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionMarkText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  sessionText: { flex: 1, gap: 2, minWidth: 0 },
  sessionTitle: { ...textPresets.body, color: colors.textStrong, fontWeight: '700' },
  sessionMeta: { ...textPresets.caption, color: colors.textMuted },
  emptyBox: {
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { ...textPresets.subheading, color: colors.textStrong },
  emptyDesc: { ...textPresets.bodySmall, color: colors.textMuted, textAlign: 'center' },
  emptyBtn: {
    marginTop: 6,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  emptyBtnText: { ...textPresets.label, color: colors.white, fontWeight: '700' },
  taskCard: { marginHorizontal: 16, gap: 12 },
  taskTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  taskLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  taskIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.contrastMuted,
    borderWidth: 1,
    borderColor: colors.contrastBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskTitle: { ...textPresets.body, color: colors.textStrong, fontWeight: '700' },
  taskMeta: { ...textPresets.caption, color: colors.textMuted },
  taskActions: { flexDirection: 'row', gap: 8 },
  taskSecondary: {
    flex: 1,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskSecondaryText: { ...textPresets.label, color: colors.textDefault, fontWeight: '700' },
  taskPrimary: {
    flex: 1,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  taskPrimaryText: { ...textPresets.label, color: colors.white, fontWeight: '700' },
});
