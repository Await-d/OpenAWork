import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';

interface Snapshot {
  id: string;
  label: string;
  time: string;
  changes: number;
  type: 'auto' | 'manual' | 'checkpoint';
}

const MOCK_SNAPSHOTS: Snapshot[] = [
  {
    id: '1',
    label: '完成 Phase 3 聊天工作台重构',
    time: '10 分钟前',
    changes: 5,
    type: 'checkpoint',
  },
  { id: '2', label: '自动快照', time: '25 分钟前', changes: 2, type: 'auto' },
  { id: '3', label: '手动保存 - 主题系统', time: '1 小时前', changes: 8, type: 'manual' },
  { id: '4', label: '自动快照', time: '2 小时前', changes: 1, type: 'auto' },
  { id: '5', label: '初始状态', time: '3 小时前', changes: 0, type: 'checkpoint' },
];

const TYPE_MAP = {
  auto: { icon: 'time-outline' as const, color: colors.textMuted },
  manual: { icon: 'bookmark-outline' as const, color: colors.aux },
  checkpoint: { icon: 'flag-outline' as const, color: colors.accent },
};

/** S29: 快照恢复预览 */
export default function SnapshotRecoveryScreen() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function handleRestore() {
    if (!selectedId) {
      Alert.alert('提示', '请先选择一个快照');
      return;
    }
    const snapshot = MOCK_SNAPSHOTS.find((s) => s.id === selectedId);
    Alert.alert('确认恢复', `将恢复到「${snapshot?.label}」？当前未保存的变更将丢失。`, [
      { text: '取消', style: 'cancel' },
      { text: '恢复', style: 'destructive' },
    ]);
  }

  return (
    <Screen>
      <ScreenHeader
        title="快照恢复"
        right={
          <TouchableOpacity style={styles.headerAction}>
            <Ionicons name="camera-outline" size={18} color={colors.aux} />
          </TouchableOpacity>
        }
      />

      <Text style={styles.title}>选择恢复点</Text>
      <Text style={styles.subtitle}>将工作区恢复到某个历史快照状态。</Text>

      <FlatList
        data={MOCK_SNAPSHOTS}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item, index }) => {
          const isSelected = selectedId === item.id;
          const typeInfo = TYPE_MAP[item.type];
          return (
            <TouchableOpacity
              style={[styles.snapshotCard, isSelected && styles.snapshotCardActive]}
              onPress={() => setSelectedId(item.id)}
              activeOpacity={0.7}
            >
              {/* Timeline dot */}
              <View style={styles.timelineCol}>
                <View style={[styles.timelineDot, { backgroundColor: typeInfo.color }]} />
                {index < MOCK_SNAPSHOTS.length - 1 && <View style={styles.timelineLine} />}
              </View>

              <View style={styles.snapshotContent}>
                <View style={styles.snapshotHeader}>
                  <Ionicons name={typeInfo.icon} size={16} color={typeInfo.color} />
                  <Text style={styles.snapshotLabel}>{item.label}</Text>
                </View>
                <Text style={styles.snapshotMeta}>
                  {item.time} · {item.changes} 个文件变更
                </Text>
              </View>

              {isSelected && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}
            </TouchableOpacity>
          );
        }}
      />

      {/* Action bar */}
      <View style={styles.actionBar}>
        <TouchableOpacity style={styles.previewBtn}>
          <Ionicons name="eye-outline" size={16} color={colors.accent} />
          <Text style={styles.previewText}>预览差异</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.restoreBtn, !selectedId && { opacity: 0.45 }]}
          onPress={handleRestore}
          disabled={!selectedId}
        >
          <Ionicons name="arrow-undo-outline" size={16} color={colors.white} />
          <Text style={styles.restoreText}>恢复快照</Text>
        </TouchableOpacity>
      </View>
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

  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  snapshotCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
  },
  snapshotCardActive: {},

  timelineCol: { alignItems: 'center', width: 20 },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: colors.lineDefault,
    marginTop: 4,
    minHeight: 20,
  },

  snapshotContent: { flex: 1, gap: 4 },
  snapshotHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  snapshotLabel: { ...textPresets.body, color: colors.textStrong, fontWeight: '600', flex: 1 },
  snapshotMeta: { ...textPresets.caption, color: colors.textMuted },

  actionBar: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.lineDefault,
    backgroundColor: colors.surface1,
  },
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
  },
  previewText: { ...textPresets.body, color: colors.accent, fontWeight: '600' },
  restoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
  },
  restoreText: { ...textPresets.body, color: colors.white, fontWeight: '700' },
});
