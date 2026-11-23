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
  /**
   * 只读来源标识（渠道：「渠道：飞书」/ 定时任务：「定时任务」）。
   *
   * 来源托管会话（`metadata.source` 为 channel / cron）**没有**「澄清 / 编程 / 程序员」
   * 对话模式：其模式与工具面由来源侧配置决定。故这里用只读标识取代可写的模式选择器，
   * 提示行也不再拼出该会话并不具备的模式。判定见 @openAwork/web-client 的 session-origin。
   */
  sourceBadgeLabel?: string | null;
  /**
   * 对话模式是否已可交互（本会话来源已判定）。为 false 时不渲染模式选择器与模式提示：
   * 此刻 `dialogueMode` 只是本地默认值这个假值，对来源会话会短暂显示错误模式。
   */
  dialogueModeReady?: boolean;
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
  sourceBadgeLabel = null,
  dialogueModeReady = true,
}: ChatModeBarProps) {
  /**
   * 提示行文案。
   *
   * `modeLabel` 是**输入模式**（文本对话 / 图片生成），与会话无关、立刻可知，任何情况下都照常显示；
   * 后半段的「偏需求澄清 / 偏工程协作 / 偏直接实现」才是**对话模式**推论——来源会话与
   * 「来源未判定」两种情况下都不拼它（那对它们都是假值）。
   */
  const imageGenerationHint = imageGenerationMode ? '发送会调用图片生成，附件仅支持参考图' : null;
  const hintText = sourceBadgeLabel
    ? `${sourceBadgeLabel} · 模式与可用工具由来源侧配置决定`
    : dialogueModeReady
      ? `当前：${modeLabel} · ${
          imageGenerationHint ??
          (dialogueMode === 'clarify'
            ? '偏需求澄清'
            : dialogueMode === 'programmer'
              ? '偏工程协作'
              : '偏直接实现')
        }`
      : `当前：${modeLabel}${imageGenerationHint ? ` · ${imageGenerationHint}` : ''}`;

  return (
    <>
      <View style={styles.contextBar}>
        {sourceBadgeLabel ? (
          <View style={styles.contextPill}>
            <Ionicons name="link-outline" size={12} color={colors.textMuted} />
            <Text style={styles.contextPillText}>{sourceBadgeLabel}</Text>
          </View>
        ) : dialogueModeReady ? (
          <DialogueModeSelector mode={dialogueMode} onChange={onChangeDialogueMode} />
        ) : null}
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
        <Text style={styles.modeHintText}>{hintText}</Text>
      </View>
    </>
  );
}
