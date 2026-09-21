import { Ionicons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../../theme/colors';
import { styles } from './styles';

interface ChatHeaderProps {
  onBack: () => void;
  onOpenAnswerRetry: () => void;
  onOpenAttachments: () => void;
  onOpenInputContext: () => void;
  onToggleSearch: () => void;
  searchOpen: boolean;
}

export function ChatHeader({
  onBack,
  onOpenAnswerRetry,
  onOpenAttachments,
  onOpenInputContext,
  onToggleSearch,
  searchOpen,
}: ChatHeaderProps) {
  return (
    <View style={styles.chatHeader}>
      <TouchableOpacity onPress={onBack} style={styles.headerBackBtn}>
        <Ionicons name="arrow-back" size={18} color={colors.textDefault} />
      </TouchableOpacity>
      <Text style={styles.chatHeaderTitle} numberOfLines={1}>
        聊天
      </Text>
      <View style={styles.headerActions}>
        <TouchableOpacity style={styles.headerActionBtn} onPress={onToggleSearch}>
          <Ionicons
            name="search-outline"
            size={18}
            color={searchOpen ? colors.warning : colors.textMuted}
          />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerActionBtn} onPress={onOpenInputContext}>
          <Ionicons name="layers-outline" size={18} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerActionBtn} onPress={onOpenAttachments}>
          <Ionicons name="attach-outline" size={18} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerActionBtn} onPress={onOpenAnswerRetry}>
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
