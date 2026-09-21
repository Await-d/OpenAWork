import type { Dispatch, SetStateAction } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MobileAttachmentBar } from '../../components/MobileAttachmentBar';
import type { MobileAttachmentItem } from '../../components/MobileAttachmentBar';
import { MOBILE_PROMPT_TEMPLATES } from '../chat-message-actions';
import { colors } from '../../theme/colors';
import { styles } from './styles';

interface ChatComposerProps {
  applyPromptTemplate: (templatePrompt: string) => void;
  attachments: MobileAttachmentItem[];
  composerBottomInset: number;
  handleAddAttachment: () => void;
  handleSend: () => void;
  handleStop: () => void;
  imageGenerationBusy: boolean;
  imageGenerationMode: boolean;
  input: string;
  sending: boolean;
  setAttachments: Dispatch<SetStateAction<MobileAttachmentItem[]>>;
  setInput: Dispatch<SetStateAction<string>>;
  setShowVoice: Dispatch<SetStateAction<boolean>>;
}

export function ChatComposer({
  applyPromptTemplate,
  attachments,
  composerBottomInset,
  handleAddAttachment,
  handleSend,
  handleStop,
  imageGenerationBusy,
  imageGenerationMode,
  input,
  sending,
  setAttachments,
  setInput,
  setShowVoice,
}: ChatComposerProps) {
  return (
    <View style={[styles.composerCard, { marginBottom: composerBottomInset }]}>
      {attachments.length > 0 && (
        <MobileAttachmentBar
          attachments={attachments}
          onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
        />
      )}

      <View style={styles.inputRow}>
        <TouchableOpacity style={styles.iconBtn} onPress={handleAddAttachment}>
          <Ionicons name="attach-outline" size={18} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => setShowVoice(true)}>
          <Ionicons name="mic-outline" size={18} color={colors.textMuted} />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={imageGenerationMode ? '描述你想生成或编辑的图片…' : '补充要求，或继续输入'}
          placeholderTextColor={colors.textSubtle}
          multiline
          editable={!sending && !imageGenerationBusy}
        />
        {sending ? (
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: colors.complement }]}
            onPress={handleStop}
          >
            <Ionicons name="stop" size={16} color={colors.white} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleSend}
            disabled={(!input.trim() && attachments.length === 0) || imageGenerationBusy}
            style={[
              styles.sendBtn,
              (!input.trim() && attachments.length === 0) || imageGenerationBusy
                ? styles.sendBtnDisabled
                : undefined,
            ]}
          >
            <Ionicons
              name={imageGenerationMode ? 'sparkles' : 'arrow-up'}
              size={18}
              color={colors.white}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Quick templates */}
      {!imageGenerationMode && (
        <View style={styles.quickTemplateRow}>
          <Text style={styles.quickLabel}>快捷</Text>
          {MOBILE_PROMPT_TEMPLATES.map((template) => (
            <TouchableOpacity
              key={template.id}
              disabled={sending || imageGenerationBusy}
              onPress={() => applyPromptTemplate(template.prompt)}
              style={[styles.quickChip, (sending || imageGenerationBusy) && { opacity: 0.45 }]}
            >
              <Text style={styles.quickChipText}>{template.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}
