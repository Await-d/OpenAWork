import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { radii } from '../theme/radii';
import { textPresets } from '../theme/typography';

interface SubagentInterventionSheetProps {
  visible: boolean;
  agentName: string;
  taskName: string;
  status: string;
  onDismiss: () => void;
  onCancel: () => void;
  onViewDetails: () => void;
}

/** S20: 子 Agent 干预 — 干预/取消子 Agent 任务 */
export function SubagentInterventionSheet({
  visible,
  agentName,
  taskName,
  status,
  onDismiss,
  onCancel,
  onViewDetails,
}: SubagentInterventionSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onDismiss}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {/* Agent info */}
          <View style={styles.agentRow}>
            <View style={styles.agentIconWrap}>
              <Ionicons name="hardware-chip-outline" size={20} color={colors.aux} />
            </View>
            <View style={styles.agentInfo}>
              <Text style={styles.agentName}>@{agentName}</Text>
              <Text style={styles.agentTask}>{taskName}</Text>
            </View>
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>{status}</Text>
            </View>
          </View>

          {/* Actions */}
          <TouchableOpacity style={styles.actionRow} onPress={onViewDetails}>
            <Ionicons name="eye-outline" size={20} color={colors.accent} />
            <Text style={styles.actionLabel}>查看详情</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionRow} onPress={onCancel}>
            <Ionicons name="close-circle-outline" size={20} color={colors.danger} />
            <Text style={[styles.actionLabel, { color: colors.danger }]}>取消任务</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onDismiss}>
            <Text style={styles.cancelText}>关闭</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: 16,
    paddingBottom: 32,
    gap: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineDefault,
    alignSelf: 'center',
    marginBottom: 8,
  },
  agentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  agentIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.auxMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentInfo: { flex: 1, gap: 2 },
  agentName: { ...textPresets.body, color: colors.textStrong, fontWeight: '700' },
  agentTask: { ...textPresets.caption, color: colors.textMuted },
  statusBadge: {
    backgroundColor: colors.auxMuted,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: { ...textPresets.caption, color: colors.aux, fontWeight: '600' },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 44,
    paddingHorizontal: 4,
  },
  actionLabel: { ...textPresets.body, color: colors.textStrong, flex: 1 },
  cancelBtn: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.lineDefault,
  },
  cancelText: { ...textPresets.body, color: colors.textMuted },
});
