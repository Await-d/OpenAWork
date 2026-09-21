import { Text, TouchableOpacity, View } from 'react-native';
import type { MobileAttachmentItem } from '../../components/MobileAttachmentBar';
import type { ChatDraftSummary } from '../chat-message-actions';
import { MOBILE_PROMPT_TEMPLATES } from '../chat-message-actions';
import { styles } from './styles';

interface ChatComposerMetaBarProps {
  attachments: MobileAttachmentItem[];
  clearComposerDraft: () => void;
  draftSummary: ChatDraftSummary;
  imageGenerationBusy: boolean;
  input: string;
  sending: boolean;
}

export function ChatComposerMetaBar({
  attachments,
  clearComposerDraft,
  draftSummary,
  imageGenerationBusy,
  input,
  sending,
}: ChatComposerMetaBarProps) {
  return (
    <View style={styles.composerMetaBar}>
      <Text style={styles.composerMetaText}>
        {draftSummary.modeLabel} · {draftSummary.charCount} 字 · {draftSummary.lineCount} 行
        {draftSummary.attachmentCount > 0 ? ` · ${draftSummary.attachmentCount} 个附件` : ''}
      </Text>
      {(input.trim().length > 0 || attachments.length > 0) && !sending && !imageGenerationBusy ? (
        <TouchableOpacity
          onPress={clearComposerDraft}
          accessibilityRole="button"
          accessibilityLabel="清空输入草稿"
        >
          <Text style={styles.composerMetaAction}>清空</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

interface ChatPromptTemplateBarProps {
  applyPromptTemplate: (templatePrompt: string) => void;
  imageGenerationBusy: boolean;
  sending: boolean;
}

export function ChatPromptTemplateBar({
  applyPromptTemplate,
  imageGenerationBusy,
  sending,
}: ChatPromptTemplateBarProps) {
  return (
    <View style={styles.promptTemplateBar}>
      <Text style={styles.promptTemplateLabel}>快捷</Text>
      {MOBILE_PROMPT_TEMPLATES.map((template) => (
        <TouchableOpacity
          key={template.id}
          accessibilityRole="button"
          accessibilityLabel={`插入${template.label}模板`}
          disabled={sending || imageGenerationBusy}
          onPress={() => applyPromptTemplate(template.prompt)}
          style={[
            styles.promptTemplateChip,
            (sending || imageGenerationBusy) && styles.promptTemplateChipDisabled,
          ]}
        >
          <Text style={styles.promptTemplateChipText}>{template.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
