import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';

interface Task {
  id: string;
  name: string;
  agent: string;
  status: 'running' | 'done' | 'error';
  output?: string;
  artifacts: number;
}

const MOCK_TASKS: Task[] = [
  { id: '1', name: '重构认证模块', agent: 'coder', status: 'running', artifacts: 3 },
  {
    id: '2',
    name: '运行单元测试',
    agent: 'tester',
    status: 'done',
    output: '24/24 通过',
    artifacts: 1,
  },
  {
    id: '3',
    name: '分析性能瓶颈',
    agent: 'analyzer',
    status: 'error',
    output: '超时',
    artifacts: 0,
  },
  {
    id: '4',
    name: '生成 API 文档',
    agent: 'writer',
    status: 'done',
    output: '已生成 3 个文件',
    artifacts: 2,
  },
];

const STATUS_MAP = {
  running: { label: '运行中', color: colors.aux, icon: 'sync-outline' as const },
  done: { label: '已完成', color: colors.success, icon: 'checkmark-circle-outline' as const },
  error: { label: '失败', color: colors.danger, icon: 'alert-circle-outline' as const },
};

/** S08: Agent 任务与产物 */
export default function AgentTasksScreen() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const runningCount = MOCK_TASKS.filter((t) => t.status === 'running').length;
  const doneCount = MOCK_TASKS.filter((t) => t.status === 'done').length;

  return (
    <Screen>
      <ScreenHeader title="Agent 任务" />

      {/* Summary */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Ionicons name="sync-outline" size={16} color={colors.aux} />
          <Text style={styles.summaryValue}>{runningCount}</Text>
          <Text style={styles.summaryLabel}>运行中</Text>
        </View>
        <View style={styles.summaryCard}>
          <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
          <Text style={styles.summaryValue}>{doneCount}</Text>
          <Text style={styles.summaryLabel}>已完成</Text>
        </View>
        <View style={styles.summaryCard}>
          <Ionicons name="cube-outline" size={16} color={colors.contrast} />
          <Text style={styles.summaryValue}>{MOCK_TASKS.reduce((s, t) => s + t.artifacts, 0)}</Text>
          <Text style={styles.summaryLabel}>产物</Text>
        </View>
      </View>

      <FlatList
        data={MOCK_TASKS}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const status = STATUS_MAP[item.status];
          const isExpanded = expandedId === item.id;
          return (
            <TouchableOpacity
              style={styles.taskCard}
              onPress={() => setExpandedId(isExpanded ? null : item.id)}
              activeOpacity={0.7}
            >
              <View style={styles.taskHeader}>
                <Ionicons name={status.icon} size={18} color={status.color} />
                <View style={styles.taskInfo}>
                  <Text style={styles.taskName}>{item.name}</Text>
                  <Text style={styles.taskMeta}>
                    @{item.agent} · {status.label}
                  </Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: status.color + '1A' }]}>
                  <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                </View>
              </View>

              {item.output && <Text style={styles.taskOutput}>{item.output}</Text>}

              {isExpanded && item.artifacts > 0 && (
                <View style={styles.artifactRow}>
                  <Ionicons name="cube-outline" size={14} color={colors.accent} />
                  <Text style={styles.artifactText}>{item.artifacts} 个产物</Text>
                  <TouchableOpacity onPress={() => router.push('/artifacts')}>
                    <Text style={styles.viewLink}>查看</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
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
    marginBottom: 12,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...textPresets.cardTitle, color: colors.textStrong },

  summaryRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 16 },
  summaryCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 10,
  },
  summaryValue: { ...textPresets.subheading, color: colors.textStrong },
  summaryLabel: { ...textPresets.caption, color: colors.textMuted },

  listContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 32 },
  taskCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 12,
    gap: 8,
  },
  taskHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  taskInfo: { flex: 1, gap: 2 },
  taskName: { ...textPresets.body, color: colors.textStrong, fontWeight: '600' },
  taskMeta: { ...textPresets.caption, color: colors.textMuted },
  statusBadge: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { ...textPresets.caption, fontWeight: '600' },
  taskOutput: { ...textPresets.bodySmall, color: colors.textDefault, marginLeft: 28 },
  artifactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.lineSubtle,
  },
  artifactText: { ...textPresets.caption, color: colors.textMuted, flex: 1 },
  viewLink: { ...textPresets.label, color: colors.accent },
});
