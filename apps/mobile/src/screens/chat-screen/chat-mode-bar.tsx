import { Ionicons } from '@expo/vector-icons';
import type { DialogueMode } from '@openAwork/shared';
import { Text, TouchableOpacity, View } from 'react-native';
import { DialogueModeSelector } from '../../components/DialogueModeSelector';
import { colors } from '../../theme/colors';
import { styles } from './styles';

interface ChatModeBarProps {
  dialogueMode: DialogueMode;
  imageGenerationBusy: boolean;
  imageGenerationMode: boolean;
  imageModelConfigured: boolean;
  modeLabel: string;
  onChangeDialogueMode: (mode: DialogueMode) => void;
  onToggleImageGenerationMode: () => void;
  sending: boolean;
}

export function ChatModeBar({
  dialogueMode,
  imageGenerationBusy,
  imageGenerationMode,
  imageModelConfigured,
  modeLabel,
  onChangeDialogueMode,
  onToggleImageGenerationMode,
  sending,
}: ChatModeBarProps) {
  return (
    <>
      <View style={styles.contextBar}>
        <DialogueModeSelector mode={dialogueMode} onChange={onChangeDialogueMode} />
        <TouchableOpacity
          style={[styles.contextPill, imageGenerationMode && styles.contextPillActive]}
          disabled={!imageModelConfigured || sending || imageGenerationBusy}
          onPress={onToggleImageGenerationMode}
        >
          <Ionicons
            name="image-outline"
            size={12}
            color={imageGenerationMode ? colors.contrast : colors.textMuted}
          />
          <Text style={[styles.contextPillText, imageGenerationMode && { color: colors.contrast }]}>
            {imageGenerationMode ? '生图模式' : '图片模式'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.modeHintBar}>
        <Text style={styles.modeHintText}>
          当前：{modeLabel}
          {imageGenerationMode
            ? ' · 发送会调用图片生成，附件仅支持参考图'
            : ` · ${dialogueMode === 'clarify' ? '偏需求澄清' : dialogueMode === 'programmer' ? '偏工程协作' : '偏直接实现'}`}
        </Text>
      </View>
    </>
  );
}
