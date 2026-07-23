import { useCallback, useMemo, useState } from 'react';
import { Alert, Image, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import {
  buildReasoningBlockKey,
  extractReasoningHeading,
  extractReasoningPreview,
  getReasoningHint,
  getReasoningLabel,
  REASONING_COLOR_TOKENS,
  REASONING_UI_TOKENS,
} from '@openAwork/shared';
import type { MobileChatMessage } from '../chat/chat-message-content';
import {
  parseMobileMessageSegments,
  summarizeMobileCodeBlock,
} from '../screens/chat-message-actions';
import { colors } from '../theme/colors';
import { radii } from '../theme/radii';

export function ChatMessageBubble({
  highlighted = false,
  isStreaming = false,
  message,
  onLongPress,
}: {
  highlighted?: boolean;
  isStreaming?: boolean;
  message: MobileChatMessage;
  onLongPress?: () => void;
}) {
  const isUser = message.role === 'user';
  const segments = useMemo(() => parseMobileMessageSegments(message.content), [message.content]);

  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={260}
      style={[
        styles.bubble,
        isUser ? styles.userBubble : styles.assistantBubble,
        isStreaming && styles.streamingBubble,
        highlighted && styles.highlightedBubble,
      ]}
    >
      {!isUser &&
        (message.reasoningBlocks ?? []).map((reasoning, index) => (
          <ReasoningBlock
            key={buildReasoningBlockKey(reasoning, index)}
            content={reasoning}
            index={index}
            streaming={isStreaming}
            total={message.reasoningBlocks?.length ?? 0}
          />
        ))}
      {segments.map((segment, index) =>
        segment.kind === 'code' ? (
          <CodeBlock key={`code-${index}`} code={segment.code} language={segment.language} />
        ) : segment.text.length > 0 ? (
          <Text key={`text-${index}`} style={[styles.bubbleText, isUser && styles.userBubbleText]}>
            {segment.text}
            {isStreaming && index === segments.length - 1 ? (
              <Text style={styles.cursor}>▋</Text>
            ) : null}
          </Text>
        ) : null,
      )}
      {(message.inputImages ?? []).map((image, index) => (
        <View
          key={`${image.imageUrl ?? image.artifactId ?? image.fileName ?? 'image'}-${index}`}
          style={styles.imageWrap}
        >
          {image.imageUrl ? (
            <Image
              source={{ uri: image.imageUrl }}
              style={styles.imagePreview}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imagePlaceholderText}>图片已附加</Text>
            </View>
          )}
          <Text style={[styles.imageLabel, isUser && styles.userBubbleText]}>
            {image.fileName ?? `图片 ${index + 1}`}
          </Text>
        </View>
      ))}
    </Pressable>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => summarizeMobileCodeBlock(code), [code]);
  const visibleCode = expanded || !summary.shouldCollapse ? code.trimEnd() : summary.collapsedCode;
  const shareCode = useCallback(async () => {
    try {
      await Share.share({ message: code.trimEnd() });
    } catch (error) {
      Alert.alert('分享失败', error instanceof Error ? error.message : '无法打开系统分享面板');
    }
  }, [code]);

  return (
    <View style={styles.codeBlock}>
      <View style={styles.codeHeader}>
        <Text style={styles.codeLanguage}>{language ?? 'code'}</Text>
        <View style={styles.codeHeaderActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="分享代码块" onPress={shareCode}>
            <Text style={styles.codeActionText}>分享</Text>
          </Pressable>
          {summary.shouldCollapse ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={expanded ? '收起代码块' : '展开代码块'}
              onPress={() => setExpanded((previous) => !previous)}
            >
              <Text style={styles.codeActionText}>{expanded ? '收起' : '展开'}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Text style={styles.codeText}>{visibleCode}</Text>
      {summary.shouldCollapse && !expanded ? (
        <Text style={styles.codeCollapsedHint}>已折叠，共 {summary.lineCount} 行</Text>
      ) : null}
    </View>
  );
}

function ReasoningBlock({
  content,
  index,
  streaming = false,
  total,
}: {
  content: string;
  index: number;
  streaming?: boolean;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const heading = useMemo(() => extractReasoningHeading(content), [content]);
  const preview = useMemo(() => heading ?? extractReasoningPreview(content), [content, heading]);
  const charCount = useMemo(() => Array.from(content).length, [content]);
  const label = getReasoningLabel({ index, streaming, total });
  const hint = getReasoningHint({ charCount, open, streaming });

  return (
    <View style={[styles.reasoningBlock, streaming && styles.reasoningBlockStreaming]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((previous) => !previous)}
        style={({ pressed }) => [
          styles.reasoningSummary,
          pressed && styles.reasoningSummaryPressed,
        ]}
      >
        <View style={styles.reasoningSummaryMain}>
          <View style={styles.reasoningLabelBadge}>
            <Text style={styles.reasoningLabel}>{label}</Text>
          </View>
          {preview ? <Text style={styles.reasoningHeading}>{preview}</Text> : null}
        </View>
        <Text style={styles.reasoningHint}>{hint}</Text>
      </Pressable>
      {open ? <Text style={styles.reasoningBody}>{content}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: '86%',
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 10,
    gap: 3,
  },
  userBubble: {
    backgroundColor: colors.accent,
    alignSelf: 'flex-end',
  },
  assistantBubble: {
    backgroundColor: colors.surface1,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.lineDefault,
  },
  streamingBubble: {
    opacity: 0.96,
  },
  highlightedBubble: {
    borderWidth: 1.5,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningMuted,
  },
  bubbleText: {
    color: colors.textDefault,
    fontSize: 14,
    lineHeight: 20,
  },
  userBubbleText: {
    color: colors.white,
  },
  codeBlock: {
    minWidth: 220,
    maxWidth: 300,
    marginTop: 6,
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSubtle,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.surfaceSoft,
  },
  codeLanguage: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  codeHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  codeActionText: { color: colors.accent, fontSize: 10, fontWeight: '800' },
  codeText: {
    color: colors.textStrong,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
    padding: 10,
  },
  codeCollapsedHint: {
    borderTopWidth: 1,
    borderTopColor: colors.lineSubtle,
    color: colors.textMuted,
    fontSize: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  imageWrap: {
    marginTop: 8,
    gap: 6,
  },
  imagePreview: {
    width: 180,
    height: 180,
    borderRadius: radii.lg,
    backgroundColor: colors.bgBase,
  },
  imagePlaceholder: {
    width: 180,
    height: 120,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgBase,
  },
  imagePlaceholderText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  imageLabel: {
    color: colors.textMuted,
    fontSize: 11,
  },
  cursor: {
    color: colors.accent,
  },
  reasoningBlock: {
    marginBottom: REASONING_UI_TOKENS.blockMarginBottomPx,
    borderRadius: REASONING_UI_TOKENS.blockRadiusPx,
    borderWidth: 1,
    borderColor: REASONING_COLOR_TOKENS.surfaceBorder,
    backgroundColor: REASONING_COLOR_TOKENS.surfaceBackground,
    overflow: 'hidden',
  },
  reasoningBlockStreaming: {
    borderColor: REASONING_COLOR_TOKENS.streamingBorder,
    backgroundColor: REASONING_COLOR_TOKENS.streamingBackground,
  },
  reasoningSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: REASONING_UI_TOKENS.summaryGapPx,
    paddingHorizontal: REASONING_UI_TOKENS.summaryPaddingXPx,
    paddingVertical: REASONING_UI_TOKENS.summaryPaddingYPx,
  },
  reasoningSummaryPressed: {
    backgroundColor: REASONING_COLOR_TOKENS.pressedBackground,
  },
  reasoningSummaryMain: {
    flex: 1,
    gap: REASONING_UI_TOKENS.summaryMainGapPx,
  },
  reasoningLabelBadge: {
    alignSelf: 'flex-start',
    minHeight: REASONING_UI_TOKENS.labelBadgeHeightPx,
    paddingHorizontal: REASONING_UI_TOKENS.labelBadgePaddingXPx,
    paddingVertical: 3,
    borderRadius: REASONING_UI_TOKENS.labelBadgeRadiusPx,
    backgroundColor: colors.surface2,
    justifyContent: 'center',
  },
  reasoningLabel: {
    color: REASONING_COLOR_TOKENS.labelText,
    fontSize: REASONING_UI_TOKENS.labelFontSizePx,
    fontWeight: '700',
    letterSpacing: REASONING_UI_TOKENS.labelLetterSpacingPx,
    textTransform: 'uppercase',
  },
  reasoningHeading: {
    color: REASONING_COLOR_TOKENS.headingText,
    fontSize: REASONING_UI_TOKENS.headingFontSizePx,
    lineHeight: REASONING_UI_TOKENS.headingLineHeightPx,
  },
  reasoningHint: {
    color: REASONING_COLOR_TOKENS.hintText,
    fontSize: REASONING_UI_TOKENS.hintFontSizePx,
    lineHeight: REASONING_UI_TOKENS.hintLineHeightPx,
    textAlign: 'right',
  },
  reasoningBody: {
    color: REASONING_COLOR_TOKENS.bodyText,
    fontSize: REASONING_UI_TOKENS.bodyFontSizePx,
    lineHeight: REASONING_UI_TOKENS.bodyLineHeightPx,
    paddingHorizontal: REASONING_UI_TOKENS.bodyPaddingXPx,
    paddingTop: 0,
    paddingBottom: REASONING_UI_TOKENS.bodyPaddingBottomPx,
  },
});
