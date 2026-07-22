import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';

interface PanelItem {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
  color: string;
  route: string;
}

const PANELS: PanelItem[] = [
  {
    id: '1',
    icon: 'color-palette-outline',
    title: '主题与外观',
    desc: '切换亮色/暗色主题、字体大小',
    color: colors.accent,
    route: '/settings',
  },
  {
    id: '2',
    icon: 'hardware-chip-outline',
    title: 'MCP 服务管理',
    desc: '查看和管理已连接的 MCP 服务',
    color: colors.aux,
    route: '/settings/mcp',
  },
  {
    id: '3',
    icon: 'cube-outline',
    title: 'Provider 配置',
    desc: '切换 AI 模型服务商和 API Key',
    color: colors.contrast,
    route: '/settings',
  },
  {
    id: '4',
    icon: 'image-outline',
    title: '图片生成设置',
    desc: '配置图片模型、尺寸、质量参数',
    color: colors.success,
    route: '/image-workspace',
  },
  {
    id: '5',
    icon: 'git-branch-outline',
    title: '变更审阅',
    desc: '查看代码变更、还原文件',
    color: colors.warning,
    route: '/change-review',
  },
  {
    id: '6',
    icon: 'camera-outline',
    title: '快照管理',
    desc: '创建和恢复工作区快照',
    color: colors.danger,
    route: '/snapshot-recovery',
  },
  {
    id: '7',
    icon: 'terminal-outline',
    title: '快捷命令',
    desc: '常用操作一键触发',
    color: colors.accent,
    route: '/quick-commands',
  },
  {
    id: '8',
    icon: 'cloud-upload-outline',
    title: 'OTA 更新',
    desc: '检查和应用应用更新',
    color: colors.aux,
    route: '/settings',
  },
];

/** S27: 面板中心与设置入口 */
export default function PanelCenterScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={18} color={colors.textDefault} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>面板中心</Text>
        <View style={{ width: 36 }} />
      </View>

      <Text style={styles.title}>设置与工具</Text>
      <Text style={styles.subtitle}>集中管理所有配置面板和工作区工具。</Text>

      <FlatList
        data={PANELS}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.panelCard}
            onPress={() => router.push(item.route)}
            activeOpacity={0.7}
          >
            <View style={[styles.panelIconWrap, { backgroundColor: item.color + '1A' }]}>
              <Ionicons name={item.icon} size={22} color={item.color} />
            </View>
            <View style={styles.panelTextWrap}>
              <Text style={styles.panelTitle}>{item.title}</Text>
              <Text style={styles.panelDesc}>{item.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
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
    marginTop: 4,
    marginBottom: 16,
  },

  listContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 100 },
  panelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 14,
  },
  panelIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelTextWrap: { flex: 1, gap: 2 },
  panelTitle: { ...textPresets.cardTitle, color: colors.textStrong },
  panelDesc: { ...textPresets.cardDescription, color: colors.textMuted },
});
