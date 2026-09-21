import { Text, TouchableOpacity, View } from 'react-native';
import { styles } from './styles';

interface ChatStreamErrorBarProps {
  hasRetryDraft: boolean;
  imageGenerationBusy: boolean;
  message: string;
  onDismiss: () => void;
  onRetry: () => void;
  sending: boolean;
}

export function ChatStreamErrorBar({
  hasRetryDraft,
  imageGenerationBusy,
  message,
  onDismiss,
  onRetry,
  sending,
}: ChatStreamErrorBarProps) {
  const retryDisabled = sending || imageGenerationBusy || !hasRetryDraft;

  return (
    <View style={styles.streamErrorBar}>
      <Text style={styles.streamErrorIcon}>!</Text>
      <Text style={styles.streamErrorText} numberOfLines={2}>
        {message}
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="关闭流式错误提示"
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        onPress={onDismiss}
      >
        <Text style={styles.streamErrorDismiss}>知道了</Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="重试上一次聊天请求"
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        disabled={retryDisabled}
        onPress={onRetry}
      >
        <Text style={[styles.streamErrorRetry, retryDisabled && styles.streamErrorRetryDisabled]}>
          重试
        </Text>
      </TouchableOpacity>
    </View>
  );
}
