import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Switch,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  createMemoriesClient,
  createSettingsClient,
  createSkillsClient,
  createUsageClient,
} from '@openAwork/web-client';
import { Screen } from '../../src/components/Screen';
import { SurfaceCard } from '../../src/components/ui';
import { useBottomNavContentInset } from '../../src/layout/use-bottom-nav-inset';
import { useAuthStore } from '../../src/store/auth';
import { useOtaUpdate } from '../../src/hooks/useOtaUpdate';
import { colors } from '../../src/theme/colors';
import { radii } from '../../src/theme/radii';
import { textPresets } from '../../src/theme/typography';

type Row = {
  title: string;
  subtitle: string;
  trailing?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
};

type Group = {
  title: string;
  rows: Row[];
};

type SectionConfig = {
  title: string;
  subtitle: string;
  staticGroups?: Group[];
  deepLinks?: Array<{ label: string; href: string }>;
  live?: boolean;
};

const APP_VERSION = '0.8.4';

const SECTION_META: Record<string, SectionConfig> = {
  display: {
    title: '显示设置',
    subtitle: '对齐桌面 Display：主题、字号与阅读偏好。',
    staticGroups: [
      {
        title: '外观',
        rows: [
          { title: '主题模式', subtitle: '当前移动端固定浅色主题', trailing: '浅色' },
          { title: '字体大小', subtitle: '跟随系统字号', trailing: '系统' },
          { title: '紧凑布局', subtitle: '列表密度与卡片间距', trailing: '标准' },
        ],
      },
    ],
  },
  companion: {
    title: 'Buddy 伴侣',
    subtitle: '对齐桌面 Companion：人格、注入、语音与绑定。',
    staticGroups: [
      {
        title: '状态',
        rows: [
          { title: '伴侣能力', subtitle: '移动端可通过伴随助手面板使用', trailing: '可用' },
          { title: '入口', subtitle: '聊天内伴随助手叠加态', trailing: 'Chat' },
        ],
      },
    ],
    deepLinks: [{ label: '打开面板中心', href: '/panel-center' }],
  },
  memory: {
    title: '记忆管理',
    subtitle: '对齐桌面 Memory：长期记忆、检索与清理。',
    live: true,
  },
  agents: {
    title: '模板与智能体',
    subtitle: '对齐桌面 Templates / Agents。',
    staticGroups: [
      {
        title: '入口',
        rows: [
          { title: 'Agent 任务', subtitle: '运行中任务与产物', trailing: '可打开' },
          { title: '快捷命令', subtitle: '工作区命令能力', trailing: '可打开' },
        ],
      },
    ],
    deepLinks: [
      { label: 'Agent 任务', href: '/agent-tasks' },
      { label: '快捷命令', href: '/quick-commands' },
    ],
  },
  automation: {
    title: '工作流与定时',
    subtitle: '对齐桌面 Workflows / Schedules。',
    staticGroups: [
      {
        title: '移动端说明',
        rows: [
          {
            title: '自动化管理',
            subtitle: '完整编排请在桌面端设置中操作',
            trailing: '桌面优先',
          },
          { title: '相关入口', subtitle: '可通过快捷命令触发部分能力', trailing: '可用' },
        ],
      },
    ],
    deepLinks: [{ label: '快捷命令', href: '/quick-commands' }],
  },
  skills: {
    title: '技能库',
    subtitle: '对齐桌面 Skills：已安装技能列表。',
    live: true,
  },
  usage: {
    title: '用量与账单',
    subtitle: '对齐桌面 Usage：Token、费用与月报。',
    live: true,
  },
  security: {
    title: '安全与权限',
    subtitle: '对齐桌面 Security：权限规则与决策记录。',
    live: true,
  },
  workspace: {
    title: '工作区',
    subtitle: '对齐桌面 Workspace：路径、过滤与桌面控制。',
    staticGroups: [
      {
        title: '控制',
        rows: [
          { title: '桌面自动化', subtitle: '仅 Tauri 桌面端完整可用', trailing: '受限' },
          { title: '快照与审阅', subtitle: '移动端提供恢复与 diff 入口', trailing: '可用' },
        ],
      },
    ],
    deepLinks: [
      { label: '打开快照恢复', href: '/snapshot-recovery' },
      { label: '打开变更审阅', href: '/change-review' },
    ],
  },
  plugins: {
    title: '插件与资源',
    subtitle: '对齐桌面 Plugins / Resources。',
    live: true,
    deepLinks: [{ label: '管理 MCP 服务', href: '/settings/mcp' }],
  },
  devtools: {
    title: '开发者工具',
    subtitle: '对齐桌面 Devtools：日志、诊断。',
    live: true,
    deepLinks: [{ label: '网络与重连诊断', href: '/network' }],
  },
  about: {
    title: '关于',
    subtitle: '版本信息与检查更新。',
    live: true,
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function toneStyle(tone: Row['tone']) {
  switch (tone) {
    case 'success':
      return {
        bg: colors.successMuted,
        border: colors.successBorder,
        text: colors.success,
      };
    case 'warning':
      return {
        bg: colors.warningMuted,
        border: colors.warningBorder,
        text: colors.warning,
      };
    case 'danger':
      return {
        bg: colors.dangerMuted,
        border: colors.dangerBorder,
        text: colors.danger,
      };
    default:
      return {
        bg: colors.accentMuted,
        border: colors.accentBorder,
        text: colors.accent,
      };
  }
}

export default function SettingsSectionScreen() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const sectionKey = typeof section === 'string' ? section : '';
  const meta = SECTION_META[sectionKey];
  const bottomInset = useBottomNavContentInset();
  const { accessToken, gatewayUrl } = useAuthStore();
  const { state: otaState, checkAndApply, applyUpdate } = useOtaUpdate();

  const [loading, setLoading] = useState(Boolean(meta?.live));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>(meta?.staticGroups ?? []);

  const title = meta?.title ?? '设置';
  const subtitle = meta?.subtitle ?? '未知设置分区';

  const loadLive = useCallback(async () => {
    if (!meta?.live) {
      setGroups(meta?.staticGroups ?? []);
      setLoading(false);
      return;
    }
    if (!accessToken || !gatewayUrl) {
      setError('请先登录并连接网关');
      setGroups([
        {
          title: '状态',
          rows: [
            {
              title: '未连接',
              subtitle: '登录后可读取实时配置',
              trailing: '离线',
              tone: 'warning',
            },
          ],
        },
      ]);
      setLoading(false);
      return;
    }

    setError(null);
    try {
      if (sectionKey === 'usage') {
        const client = createUsageClient(gatewayUrl);
        const [records, breakdown] = await Promise.all([
          client.getRecords(accessToken),
          client.getBreakdown(accessToken),
        ]);
        const latest = records.records[records.records.length - 1];
        const totalTokens = (latest?.totalInputTokens ?? 0) + (latest?.totalOutputTokens ?? 0);
        setGroups([
          {
            title: '本月概览',
            rows: [
              {
                title: 'Token 消耗',
                subtitle: latest?.month ? `${latest.month} 输入+输出` : '最近月份',
                trailing: formatTokens(totalTokens),
              },
              {
                title: '预估费用',
                subtitle: '本月费用合计',
                trailing: formatUsd(breakdown.monthlyCostUsd || latest?.totalCostUsd || 0),
              },
              {
                title: '预算',
                subtitle: '账户预算额度',
                trailing: formatUsd(records.budgetUsd),
              },
            ],
          },
          {
            title: '按模型拆分',
            rows:
              breakdown.breakdown.length > 0
                ? breakdown.breakdown.slice(0, 6).map((item) => ({
                    title: item.modelName || '未知模型',
                    subtitle: `输入 ${formatUsd(item.inputCost)} · 输出 ${formatUsd(item.outputCost)}`,
                    trailing: formatUsd(item.totalCost),
                  }))
                : [{ title: '暂无拆分数据', subtitle: '本月还没有用量记录', trailing: '—' }],
          },
        ]);
        return;
      }

      if (sectionKey === 'memory') {
        const client = createMemoriesClient(gatewayUrl);
        const [statsRaw, listRaw, settingsRaw] = await Promise.all([
          client.getStats(accessToken).catch(() => null),
          client.list(accessToken).catch(() => null),
          client.getSettings(accessToken).catch(() => null),
        ]);
        const stats = asRecord(statsRaw) ?? {};
        const list = asArray(
          asRecord(listRaw)?.['items'] ?? asRecord(listRaw)?.['memories'] ?? listRaw,
        );
        const settings = asRecord(settingsRaw) ?? {};
        const total =
          typeof stats['total'] === 'number'
            ? stats['total']
            : typeof stats['count'] === 'number'
              ? stats['count']
              : list.length;
        const autoWrite =
          settings['autoWrite'] === true ||
          settings['enabled'] === true ||
          settings['autoExtract'] === true;
        setGroups([
          {
            title: '记忆库',
            rows: [
              {
                title: '长期记忆',
                subtitle: '跨会话可检索记忆条目',
                trailing: `${total} 条`,
              },
              {
                title: '自动写入',
                subtitle: '重要结论自动沉淀',
                trailing: autoWrite ? '开' : '关',
                tone: autoWrite ? 'success' : 'default',
              },
            ],
          },
          {
            title: '最近记忆',
            rows:
              list.length > 0
                ? list.slice(0, 5).map((item, index) => {
                    const rec = asRecord(item) ?? {};
                    const content =
                      typeof rec['content'] === 'string'
                        ? rec['content']
                        : typeof rec['text'] === 'string'
                          ? rec['text']
                          : typeof rec['summary'] === 'string'
                            ? rec['summary']
                            : '记忆条目';
                    return {
                      title: typeof rec['title'] === 'string' ? rec['title'] : `记忆 ${index + 1}`,
                      subtitle: content.slice(0, 80),
                    };
                  })
                : [{ title: '暂无记忆', subtitle: '对话沉淀后将出现在这里', trailing: '空' }],
          },
        ]);
        return;
      }

      if (sectionKey === 'security') {
        const client = createSettingsClient(gatewayUrl);
        const [rulesRaw, decisionsRaw] = await Promise.all([
          client.getPermissionRules(accessToken),
          client.getPermissionDecisions(accessToken),
        ]);
        const rulesObj = asRecord(rulesRaw) ?? {};
        const decisionsObj = asRecord(decisionsRaw) ?? {};
        const rules = asArray(rulesObj['rules']);
        const categories = asArray(rulesObj['categories']);
        const decisions = asArray(decisionsObj['decisions']);
        setGroups([
          {
            title: '权限规则',
            rows: [
              {
                title: '规则数量',
                subtitle: '工具与文件访问策略',
                trailing: `${rules.length} 条`,
              },
              {
                title: '分类',
                subtitle: '权限类别元数据',
                trailing: `${categories.length}`,
              },
            ],
          },
          {
            title: '最近决策',
            rows:
              decisions.length > 0
                ? decisions.slice(0, 6).map((item, index) => {
                    const rec = asRecord(item) ?? {};
                    const tool =
                      typeof rec['toolName'] === 'string'
                        ? rec['toolName']
                        : typeof rec['action'] === 'string'
                          ? rec['action']
                          : `决策 ${index + 1}`;
                    const decision =
                      typeof rec['decision'] === 'string'
                        ? rec['decision']
                        : typeof rec['result'] === 'string'
                          ? rec['result']
                          : '记录';
                    return {
                      title: tool,
                      subtitle:
                        typeof rec['createdAt'] === 'string' ? rec['createdAt'] : '权限审计记录',
                      trailing: decision,
                      tone:
                        decision.toLowerCase().includes('deny') || decision.includes('拒绝')
                          ? 'danger'
                          : 'success',
                    } satisfies Row;
                  })
                : [
                    {
                      title: '暂无审计记录',
                      subtitle: '高风险操作决策会显示在这里',
                      trailing: '空',
                    },
                  ],
          },
        ]);
        return;
      }

      if (sectionKey === 'skills') {
        const client = createSkillsClient(gatewayUrl);
        const installedRaw = await client.listInstalled(accessToken);
        const installed = asArray(
          asRecord(installedRaw)?.['skills'] ?? asRecord(installedRaw)?.['items'] ?? installedRaw,
        );
        setGroups([
          {
            title: '已安装技能',
            rows:
              installed.length > 0
                ? installed.slice(0, 12).map((item, index) => {
                    const rec = asRecord(item) ?? {};
                    const name =
                      typeof rec['name'] === 'string'
                        ? rec['name']
                        : typeof rec['id'] === 'string'
                          ? rec['id']
                          : `技能 ${index + 1}`;
                    const enabled = rec['enabled'] !== false;
                    return {
                      title: name,
                      subtitle:
                        typeof rec['description'] === 'string' ? rec['description'] : '已安装技能',
                      trailing: enabled ? '开' : '关',
                      tone: enabled ? 'success' : 'default',
                    } satisfies Row;
                  })
                : [{ title: '暂无已安装技能', subtitle: '可在桌面端安装后同步', trailing: '空' }],
          },
        ]);
        return;
      }

      if (sectionKey === 'plugins') {
        const client = createSettingsClient(gatewayUrl);
        const pluginsRaw = await client.getPlugins(accessToken);
        const pluginsObj = asRecord(pluginsRaw) ?? {};
        const plugins = asArray(
          pluginsObj['plugins'] ?? pluginsObj['items'] ?? pluginsObj['entries'] ?? pluginsRaw,
        );
        setGroups([
          {
            title: '插件',
            rows:
              plugins.length > 0
                ? plugins.slice(0, 12).map((item, index) => {
                    const rec = asRecord(item) ?? {};
                    const name =
                      typeof rec['name'] === 'string'
                        ? rec['name']
                        : typeof rec['id'] === 'string'
                          ? rec['id']
                          : `插件 ${index + 1}`;
                    const enabled = rec['enabled'] !== false;
                    return {
                      title: name,
                      subtitle:
                        typeof rec['description'] === 'string' ? rec['description'] : '插件配置',
                      trailing: enabled ? '开' : '关',
                      tone: enabled ? 'success' : 'default',
                    } satisfies Row;
                  })
                : [{ title: '暂无插件配置', subtitle: '可在桌面端管理插件', trailing: '空' }],
          },
        ]);
        return;
      }

      if (sectionKey === 'devtools') {
        const client = createSettingsClient(gatewayUrl);
        const diagnosticsRaw = await client.getDiagnostics(accessToken).catch(() => null);
        const diagnostics = asArray(
          asRecord(diagnosticsRaw)?.['items'] ??
            asRecord(diagnosticsRaw)?.['diagnostics'] ??
            diagnosticsRaw,
        );
        setGroups([
          {
            title: '观测',
            rows: [
              {
                title: '诊断记录',
                subtitle: '文件/会话诊断',
                trailing: `${diagnostics.length}`,
                tone: diagnostics.length > 0 ? 'warning' : 'success',
              },
              {
                title: '网关',
                subtitle: gatewayUrl,
                trailing: '已连接',
                tone: 'success',
              },
            ],
          },
          {
            title: '最近诊断',
            rows:
              diagnostics.length > 0
                ? diagnostics.slice(0, 6).map((item, index) => {
                    const rec = asRecord(item) ?? {};
                    return {
                      title:
                        typeof rec['message'] === 'string'
                          ? rec['message']
                          : typeof rec['filePath'] === 'string'
                            ? rec['filePath']
                            : `诊断 ${index + 1}`,
                      subtitle:
                        typeof rec['severity'] === 'string'
                          ? rec['severity']
                          : typeof rec['createdAt'] === 'string'
                            ? rec['createdAt']
                            : 'diagnostics',
                    };
                  })
                : [{ title: '暂无诊断', subtitle: '系统当前没有诊断条目', trailing: '健康' }],
          },
        ]);
        return;
      }

      if (sectionKey === 'about') {
        setGroups([
          {
            title: '应用',
            rows: [
              {
                title: '当前版本',
                subtitle: 'OpenAWork Mobile',
                trailing: `v${APP_VERSION}`,
              },
              {
                title: '检查更新',
                subtitle:
                  otaState.status === 'up-to-date'
                    ? '已是最新版本'
                    : otaState.status === 'ready'
                      ? '更新就绪，可重启应用'
                      : otaState.status === 'error'
                        ? (otaState.errorMessage ?? '检查失败')
                        : otaState.status === 'checking' || otaState.status === 'downloading'
                          ? '正在检查/下载…'
                          : 'OTA 更新通道',
                trailing:
                  otaState.status === 'ready'
                    ? '待重启'
                    : otaState.status === 'up-to-date'
                      ? '最新'
                      : otaState.status === 'error'
                        ? '错误'
                        : '可检查',
                tone:
                  otaState.status === 'error'
                    ? 'danger'
                    : otaState.status === 'ready'
                      ? 'warning'
                      : 'success',
              },
            ],
          },
          {
            title: '网关',
            rows: [
              {
                title: '当前网关',
                subtitle: gatewayUrl,
                trailing: accessToken ? '已登录' : '未登录',
                tone: accessToken ? 'success' : 'warning',
              },
            ],
          },
        ]);
        return;
      }

      setGroups(meta.staticGroups ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setGroups([
        {
          title: '加载失败',
          rows: [
            {
              title: '无法读取实时数据',
              subtitle: e instanceof Error ? e.message : '未知错误',
              trailing: '重试',
              tone: 'danger',
            },
          ],
        },
      ]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken, gatewayUrl, meta, otaState.errorMessage, otaState.status, sectionKey]);

  useEffect(() => {
    setLoading(Boolean(meta?.live));
    void loadLive();
  }, [loadLive, meta?.live]);

  const deepLinks = useMemo(() => meta?.deepLinks ?? [], [meta?.deepLinks]);

  if (!meta) {
    return (
      <Screen>
        <View style={styles.missingWrap}>
          <Text style={styles.missingTitle}>未找到该设置分区</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/settings')}>
            <Text style={styles.primaryBtnText}>返回设置</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
        refreshControl={
          meta.live ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadLive();
              }}
              tintColor={colors.accent}
            />
          ) : undefined
        }
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={20} color={colors.textDefault} />
          </TouchableOpacity>
          <Text style={styles.title}>{title}</Text>
        </View>
        <Text style={styles.subtitle}>{subtitle}</Text>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loadingText}>加载中…</Text>
          </View>
        ) : null}

        {error ? (
          <SurfaceCard variant="soft" radius="lg" style={styles.errorCard}>
            <Text style={styles.errorTitle}>实时数据不可用</Text>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => {
                setLoading(true);
                void loadLive();
              }}
            >
              <Text style={styles.secondaryBtnText}>重试</Text>
            </TouchableOpacity>
          </SurfaceCard>
        ) : null}

        {!loading
          ? groups.map((group) => (
              <View key={group.title} style={styles.group}>
                <Text style={styles.groupTitle}>{group.title}</Text>
                <SurfaceCard variant="default" radius="lg" padding={0} style={styles.card}>
                  {group.rows.map((row, index) => {
                    const tone = toneStyle(row.tone);
                    return (
                      <View key={`${group.title}-${row.title}-${index}`}>
                        {index > 0 ? <View style={styles.divider} /> : null}
                        <View style={styles.row}>
                          <View style={styles.rowText}>
                            <Text style={styles.rowTitle}>{row.title}</Text>
                            <Text style={styles.rowSubtitle}>{row.subtitle}</Text>
                          </View>
                          {row.trailing ? (
                            <View
                              style={[
                                styles.trailing,
                                { backgroundColor: tone.bg, borderColor: tone.border },
                              ]}
                            >
                              <Text style={[styles.trailingText, { color: tone.text }]}>
                                {row.trailing}
                              </Text>
                            </View>
                          ) : (
                            <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
                          )}
                        </View>
                      </View>
                    );
                  })}
                </SurfaceCard>
              </View>
            ))
          : null}

        {sectionKey === 'about' ? (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>更新操作</Text>
            <SurfaceCard variant="default" radius="lg" style={styles.actionCard}>
              {otaState.status === 'ready' ? (
                <TouchableOpacity style={styles.primaryBtn} onPress={() => void applyUpdate()}>
                  <Text style={styles.primaryBtnText}>重启以应用更新</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => void checkAndApply()}
                  disabled={otaState.status === 'checking' || otaState.status === 'downloading'}
                >
                  <Text style={styles.primaryBtnText}>
                    {otaState.status === 'checking' || otaState.status === 'downloading'
                      ? '检查中…'
                      : '立即检查更新'}
                  </Text>
                </TouchableOpacity>
              )}
            </SurfaceCard>
          </View>
        ) : null}

        {sectionKey === 'display' ? (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>当前偏好</Text>
            <SurfaceCard variant="default" radius="lg" style={styles.actionCard}>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>浅色主题</Text>
                  <Text style={styles.rowSubtitle}>移动端 pen 设计当前仅落地浅色</Text>
                </View>
                <Switch value disabled trackColor={{ true: colors.accent }} />
              </View>
            </SurfaceCard>
          </View>
        ) : null}

        {deepLinks.length ? (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>快捷入口</Text>
            <SurfaceCard variant="default" radius="lg" padding={0} style={styles.card}>
              {deepLinks.map((link, index) => (
                <View key={link.href}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <TouchableOpacity
                    style={styles.row}
                    activeOpacity={0.7}
                    onPress={() => router.push(link.href)}
                  >
                    <Text style={[styles.rowTitle, { flex: 1 }]}>{link.label}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
                  </TouchableOpacity>
                </View>
              ))}
            </SurfaceCard>
          </View>
        ) : null}

        <Text style={styles.footerHint}>
          该分区对齐桌面端设置信息架构。已接入网关的分区会显示实时数据；其余分区提供结构化入口与说明。
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { paddingBottom: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    minHeight: 44,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...textPresets.subheading, color: colors.textStrong, fontWeight: '700' },
  subtitle: {
    ...textPresets.bodySmall,
    color: colors.textMuted,
    paddingHorizontal: 16,
    marginTop: 6,
    marginBottom: 12,
    lineHeight: 18,
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  loadingText: { ...textPresets.caption, color: colors.textMuted },
  errorCard: { marginHorizontal: 16, marginBottom: 12, gap: 8 },
  errorTitle: { ...textPresets.body, color: colors.textStrong, fontWeight: '700' },
  errorText: { ...textPresets.caption, color: colors.textMuted, lineHeight: 18 },
  group: { marginBottom: 14 },
  groupTitle: {
    ...textPresets.label,
    color: colors.textMuted,
    fontWeight: '700',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  card: { marginHorizontal: 16, overflow: 'hidden' },
  actionCard: { marginHorizontal: 16, gap: 10 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.lineSubtle },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  rowTitle: { ...textPresets.body, color: colors.textStrong, fontWeight: '700' },
  rowSubtitle: { ...textPresets.caption, color: colors.textMuted },
  trailing: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  trailingText: { ...textPresets.caption, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  primaryBtn: {
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { ...textPresets.label, color: colors.white, fontWeight: '700' },
  secondaryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.lineDefault,
  },
  secondaryBtnText: { ...textPresets.label, color: colors.textDefault, fontWeight: '700' },
  footerHint: {
    ...textPresets.caption,
    color: colors.textSubtle,
    paddingHorizontal: 20,
    marginTop: 8,
    lineHeight: 18,
  },
  missingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  missingTitle: { ...textPresets.subheading, color: colors.textStrong },
});
