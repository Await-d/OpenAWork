import { useCallback, type ReactNode } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TouchableWithoutFeedback,
  ActivityIndicator,
} from 'react-native';
import { colors } from '../theme/colors';
import { radii } from '../theme/radii';

export interface ActionSheetButton {
  label: string;
  onPress: () => void;
  variant?: 'default' | 'destructive' | 'cancel';
  loading?: boolean;
  disabled?: boolean;
}

interface ActionSheetProps {
  visible: boolean;
  title?: string;
  message?: string;
  actions: ActionSheetButton[];
  onDismiss: () => void;
}

export function ActionSheet({ visible, title, message, actions, onDismiss }: ActionSheetProps) {
  const handleBackdrop = useCallback(() => onDismiss(), [onDismiss]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <TouchableWithoutFeedback onPress={handleBackdrop}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        {(title ?? message) ? (
          <View style={styles.header}>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            {message ? <Text style={styles.message}>{message}</Text> : null}
          </View>
        ) : null}
        <View style={styles.actions}>
          {actions.map((action, idx) => (
            <TouchableOpacity
              key={action.label}
              style={[
                styles.actionBtn,
                action.variant === 'destructive' && styles.actionBtnDestructive,
                action.variant === 'cancel' && styles.actionBtnCancel,
                (action.disabled ?? action.loading) && styles.actionBtnDisabled,
                idx < actions.length - 1 && styles.actionBtnBorder,
              ]}
              onPress={action.onPress}
              disabled={action.disabled ?? action.loading}
            >
              {action.loading ? (
                <ActivityIndicator
                  size="small"
                  color={action.variant === 'destructive' ? colors.danger : colors.accent}
                />
              ) : (
                <Text
                  style={[
                    styles.actionText,
                    action.variant === 'destructive' && styles.actionTextDestructive,
                    action.variant === 'cancel' && styles.actionTextCancel,
                  ]}
                >
                  {action.label}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </Modal>
  );
}

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  confirmVariant?: 'destructive' | 'default';
  confirmLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = '确认',
  confirmVariant = 'default',
  confirmLoading,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <TouchableWithoutFeedback onPress={onCancel}>
        <View style={styles.dialogOverlay} />
      </TouchableWithoutFeedback>
      <View style={styles.dialogWrapper}>
        <View style={styles.dialogCard}>
          <Text style={styles.dialogTitle}>{title}</Text>
          {message ? <Text style={styles.dialogMessage}>{message}</Text> : null}
          {children}
          <View style={styles.dialogActions}>
            <TouchableOpacity style={styles.dialogCancelBtn} onPress={onCancel}>
              <Text style={styles.dialogCancelText}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.dialogConfirmBtn,
                confirmVariant === 'destructive' && styles.dialogConfirmBtnDestructive,
                confirmLoading && styles.actionBtnDisabled,
              ]}
              onPress={onConfirm}
              disabled={confirmLoading}
            >
              {confirmLoading ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.dialogConfirmText}>{confirmLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,61,0.28)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 34,
    borderTopWidth: 1,
    borderColor: colors.lineDefault,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineDefault,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineDefault,
    gap: 4,
  },
  title: { color: colors.textStrong, fontSize: 16, fontWeight: '700' },
  message: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  actions: { paddingHorizontal: 16, paddingTop: 8 },
  actionBtn: {
    paddingVertical: 16,
    alignItems: 'center',
    borderRadius: radii.lg,
  },
  actionBtnBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.lineDefault,
    borderRadius: 0,
  },
  actionBtnDestructive: {},
  actionBtnCancel: { marginTop: 6, backgroundColor: colors.bgBase, borderRadius: radii.lg },
  actionBtnDisabled: { opacity: 0.4 },
  actionText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  actionTextDestructive: { color: colors.danger },
  actionTextCancel: { color: colors.textMuted, fontWeight: '500' },
  dialogOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,61,0.32)',
  },
  dialogWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialogCard: {
    backgroundColor: colors.surface1,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: colors.lineDefault,
    gap: 12,
  },
  dialogTitle: { color: colors.textStrong, fontSize: 17, fontWeight: '700' },
  dialogMessage: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  dialogActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  dialogCancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    alignItems: 'center',
    backgroundColor: colors.bgBase,
  },
  dialogCancelText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  dialogConfirmBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: radii.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  dialogConfirmBtnDestructive: { backgroundColor: colors.danger },
  dialogConfirmText: { color: colors.white, fontSize: 14, fontWeight: '700' },
});
