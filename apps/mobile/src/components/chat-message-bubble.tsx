import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  buildReasoningBlockKey,
  extractReasoningHeading,
  extractReasoningPreview,
  getReasoningHint,
  getReasoningLabel,
  REASONING_COLOR_TOKENS,
  REASONING_UI_TOKENS,
} from '@openAwork/shared';
import type { MobileChatMessage } from '../chat-message-content.js';

export function ChatMessageBubble({
  isStreaming = false,
  message,
}: {
  isStreaming?: boolean;
  message: MobileChatMessage;
}) {
  const isUser = message.role === 'user';

  return (
    <View
      style={[
        styles.bubble,
        isUser ? styles.userBubble : styles.assistantBubble,
        isStreaming && styles.streamingBubble,
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
      {message.content.length > 0 && (
        <Text style={[styles.bubbleText, isUser && styles.userBubbleText]}>
          {message.content}
          {isStreaming && <Text style={styles.cursor}>▋</Text>}
        </Text>
      )}
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
    maxWidth: '80%',
    borderRadius: 14,
    padding: 12,
    paddingHorizontal: 14,
  },
  userBubble: {
    backgroundColor: '#6366f1',
    alignSelf: 'flex-end',
  },
  assistantBubble: {
    backgroundColor: '#1e293b',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#334155',
  },
  streamingBubble: {
    opacity: 0.92,
  },
  bubbleText: {
    color: '#94a3b8',
    fontSize: 15,
    lineHeight: 22,
  },
  userBubbleText: {
    color: '#fff',
  },
  cursor: {
    color: '#6366f1',
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
    backgroundColor: '#1e293b',
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
