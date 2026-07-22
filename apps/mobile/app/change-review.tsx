import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Alert } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';

interface FileChange {
  id: string;
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
  preview: string;
}

const MOCK_CHANGES: FileChange[] = [
  {
    id: '1',
    path: 'src/store/auth.ts',
    status: 'modified',
    additions: 12,
    deletions: 3,
    preview: '增加 token 刷新间隔配置',
  },
  {
    id: '2',
    path: 'src/theme/colors.ts',
    status: 'added',
    additions: 45,
    deletions: 0,
    preview: '新建设计系统颜色变量',
  },
  {
    id: '3',
    path: 'src/components/BottomNav.tsx',
    status: 'added',
    additions: 88,
    deletions: 0,
    preview: '底部导航栏组件',
  },
  {
    id: '4',
    path: 'app/_layout.tsx',
    status: 'modified',
    additions: 18,
    deletions: 12,
    preview: '集成新主题和底部导航',
  },
  {
    id: '5',
    path: 'src/screens/ChatScreen.tsx',
    status: 'modified',
    additions: 64,
    deletions: 42,
    preview: 'Compact Composer 重构',
  },
];

const STATUS_MAP = {
  added: { label: '新增', color: colors.success, icon: 'add-circle-outline' as const },
  modified: { label: '修改', color: colors.warning, icon: 'create-outline' as const },
  deleted: { label: '删除', color: colors.danger, icon: 'trash-outline' as const },
};

/** S25: 变更审阅与还原 */
export default function ChangeReviewScreen() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleRevert() {
    if (selected.size === 0) {
      Alert.alert('提示', '请先选择要还原的文件');
      return;
    }
    Alert.alert('确认还原', `将还原 ${selected.size} 个文件的变更？`, [
      { text: '取消', style: 'cancel' },
      { text: '还原', style: 'destructive', onPress: () => setSelected(new Set()) },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={18} color={colors.textDefault} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>变更审阅</Text>
        <TouchableOpacity onPress={() => setSelected(new Set(MOCK_CHANGES.map((c) => c.id)))}>
          <Text style={styles.selectAll}>全选</Text>
        </TouchableOpacity>
      </View>

      {/* Summary bar */}
      <View style={styles.summaryBar}>
        <Ionicons name="git-compare-outline" size={16} color={colors.accent} />
        <Text style={styles.summaryText}>
          {MOCK_CHANGES.length} 个文件变更 · {MOCK_CHANGES.reduce((s, c) => s + c.additions, 0)}{' '}
          行新增 · {MOCK_CHANGES.reduce((s, c) => s + c.deletions, 0)} 行删除
        </Text>
      </View>

      <FlatList
        data={MOCK_CHANGES}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const isSelected = selected.has(item.id);
          const status = STATUS_MAP[item.status];
          return (
            <TouchableOpacity
              style={[styles.changeCard, isSelected && styles.changeCardSelected]}
              onPress={() => toggleSelect(item.id)}
              activeOpacity={0.7}
            >
              <View style={styles.changeHeader}>
                <Ionicons
                  name={isSelected ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={isSelected ? colors.accent : colors.textSubtle}
                />
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: status.color + '1A', borderColor: status.color + '52' },
                  ]}
                >
                  <Ionicons name={status.icon} size={12} color={status.color} />
                  <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                </View>
                <Text style={styles.filePath} numberOfLines={1}>
                  {item.path}
                </Text>
              </View>
              <Text style={styles.preview}>{item.preview}</Text>
              <View style={styles.statsRow}>
                <Text style={styles.additions}>+{item.additions}</Text>
                <Text style={styles.deletions}>-{item.deletions}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {/* Action bar */}
      {selected.size > 0 && (
        <View style={styles.actionBar}>
          <TouchableOpacity style={styles.revertBtn} onPress={handleRevert}>
            <Ionicons name="arrow-undo-outline" size={16} color={colors.white} />
            <Text style={styles.revertText}>还原 {selected.size} 个文件</Text>
          </TouchableOpacity>
        </View>
      )}
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
    marginBottom: 12,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...textPresets.cardTitle, color: colors.textStrong },
  selectAll: { ...textPresets.label, color: colors.accent },

  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.accentMuted,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    padding: 10,
  },
  summaryText: { ...textPresets.label, color: colors.accent },

  listContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 100 },
  changeCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 12,
    gap: 6,
  },
  changeCardSelected: { borderColor: colors.accentBorder, backgroundColor: colors.accentMuted },
  changeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusText: { ...textPresets.caption, fontWeight: '600' },
  filePath: {
    ...textPresets.bodySmall,
    color: colors.textStrong,
    flex: 1,
    fontFamily: 'monospace',
  },
  preview: { ...textPresets.bodySmall, color: colors.textMuted, marginLeft: 28 },
  statsRow: { flexDirection: 'row', gap: 8, marginLeft: 28 },
  additions: { ...textPresets.caption, color: colors.success, fontWeight: '700' },
  deletions: { ...textPresets.caption, color: colors.danger, fontWeight: '700' },

  actionBar: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.lineDefault,
    backgroundColor: colors.surface1,
  },
  revertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    backgroundColor: colors.danger,
    borderRadius: radii.lg,
  },
  revertText: { ...textPresets.body, color: colors.white, fontWeight: '700' },
});
