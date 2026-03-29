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
                  color={action.variant === 'destructive' ? '#f87171' : '#6366f1'}
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
                <ActivityIndicator size="small" color="#fff" />
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

const BG = '#0f172a';
const SURFACE = '#1e293b';
const BORDER = '#334155';
const ACCENT = '#6366f1';
const TEXT = '#f8fafc';
const MUTED = '#94a3b8';
const DANGER = '#ef4444';

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: SURFACE,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 34,
    borderTopWidth: 1,
    borderColor: BORDER,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: BORDER,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    gap: 4,
  },
  title: { color: TEXT, fontSize: 16, fontWeight: '700' },
  message: { color: MUTED, fontSize: 13, lineHeight: 18 },
  actions: { paddingHorizontal: 16, paddingTop: 8 },
  actionBtn: {
    paddingVertical: 16,
    alignItems: 'center',
    borderRadius: 12,
  },
  actionBtnBorder: {
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    borderRadius: 0,
  },
  actionBtnDestructive: {},
  actionBtnCancel: { marginTop: 6, backgroundColor: BG, borderRadius: 12 },
  actionBtnDisabled: { opacity: 0.4 },
  actionText: { color: ACCENT, fontSize: 16, fontWeight: '600' },
  actionTextDestructive: { color: DANGER },
  actionTextCancel: { color: MUTED, fontWeight: '500' },
  dialogOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  dialogWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialogCard: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
  },
  dialogTitle: { color: TEXT, fontSize: 17, fontWeight: '700' },
  dialogMessage: { color: MUTED, fontSize: 14, lineHeight: 20 },
  dialogActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  dialogCancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    backgroundColor: BG,
  },
  dialogCancelText: { color: MUTED, fontSize: 14, fontWeight: '600' },
  dialogConfirmBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: ACCENT,
    alignItems: 'center',
  },
  dialogConfirmBtnDestructive: { backgroundColor: DANGER },
  dialogConfirmText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
