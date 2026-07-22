import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { radii } from '../theme/radii';
import { textPresets } from '../theme/typography';

interface StreamingErrorBannerProps {
  error: string | null;
  onDismiss: () => void;
  onRetry: () => void;
  canRetry?: boolean;
}

/** S21: 流式错误与重试 — 聊天中的错误提示横幅 */
export function StreamingErrorBanner({
  error,
  onDismiss,
  onRetry,
  canRetry = true,
}: StreamingErrorBannerProps) {
  if (!error) return null;

  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name="alert-circle" size={16} color={colors.danger} />
      </View>
      <Text style={styles.errorText} numberOfLines={2}>
        {error}
      </Text>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <Text style={styles.dismissText}>知道了</Text>
      </TouchableOpacity>
      {canRetry && (
        <TouchableOpacity onPress={onRetry} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Text style={styles.retryText}>重试</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

interface StreamStatusIndicatorProps {
  status: 'connecting' | 'streaming' | 'thinking' | 'error';
  message?: string;
}

/** S21: 流式状态指示器 */
export function StreamStatusIndicator({ status, message }: StreamStatusIndicatorProps) {
  if (status === 'streaming') return null;

  const config = {
    connecting: { icon: 'sync-outline' as const, label: '连接中…', color: colors.aux },
    streaming: { icon: 'chatbubble-outline' as const, label: '回复中', color: colors.accent },
    thinking: { icon: 'bulb-outline' as const, label: '思考中…', color: colors.contrast },
    error: { icon: 'alert-circle-outline' as const, label: '出错了', color: colors.danger },
  };

  const c = config[status];

  return (
    <View
      style={[
        statusStyles.container,
        { borderColor: c.color + '52', backgroundColor: c.color + '14' },
      ]}
    >
      <Ionicons name={c.icon} size={16} color={c.color} />
      <Text style={[statusStyles.label, { color: c.color }]}>{message ?? c.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginVertical: 4,
    backgroundColor: colors.dangerMuted,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  iconWrap: {
    width: 18,
    height: 18,
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: colors.dangerMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: { flex: 1, ...textPresets.bodySmall, color: colors.danger, lineHeight: 17 },
  dismissText: { ...textPresets.label, color: colors.textMuted, fontWeight: '700' },
  retryText: { ...textPresets.label, color: colors.danger, fontWeight: '800' },
});

const statusStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  label: { ...textPresets.bodySmall, fontWeight: '600' },
});
