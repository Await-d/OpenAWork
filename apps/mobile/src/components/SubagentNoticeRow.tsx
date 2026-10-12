import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { parseSubagentResultBlocks, summarizeSubagentResult } from '@openAwork/shared';
import type { MobileSubagentNotice, MobileSubagentNoticeState } from '../chat/chat-message-content';
import { colors } from '../theme/colors';
import { radii } from '../theme/radii';
import { spacing } from '../theme/spacing';
import { textPresets } from '../theme/typography';
import { MobileSubagentResultCard } from './SubagentResultCard';

interface NoticeStatePresentation {
  glyph: string;
  label: string;
  accent: string;
}

/**
 * 状态呈现。语义色与 Web / 桌面端（shared-ui 的 `SubagentNoticeRow`）一致：
 * 失败 → danger、取消 → warning、完成 → aux(info)。
 */
const STATE_PRESENTATION: Record<MobileSubagentNoticeState, NoticeStatePresentation> = {
  done: { glyph: '↳', label: '已完成', accent: colors.aux },
  failed: { glyph: '!', label: '已失败', accent: colors.danger },
  cancelled: { glyph: '!', label: '已取消', accent: colors.warning },
};

export interface SubagentNoticeRowProps {
  notice: MobileSubagentNotice;
  /** 与相邻通知合组时收紧上间距。 */
  grouped?: boolean;
  /** 传入且通知带子会话 id 时，标题行可点击跳转。 */
  onOpenChild?: (childSessionId: string) => void;
}

function buildNoticeAccessibilityLabel(notice: MobileSubagentNotice): string {
  const presentation = STATE_PRESENTATION[notice.state];
  const heading = `${notice.agent} ${presentation.label}`;
  const summary = summarizeSubagentResult(parseSubagentResultBlocks(notice.text));
  if (notice.description.length > 0) {
    return `${heading} · ${notice.description}${summary ? ` · ${summary}` : ''}`;
  }
  return summary ? `${heading} · ${summary}` : heading;
}

/**
 * 子代理完成通知的呈现：紧凑标题行 + 全展开的结构化结果卡片。
 *
 * 标题行对齐上游 notice 契约：紧凑单行、按状态着色、` · ` 追加 `description`、
 * 有子会话 id 且提供 `onOpenChild` 时标题行可点击（`Pressable` + 按压反馈）。
 * 标题行下方通过 `MobileSubagentResultCard` 全展开渲染 `notice.text` 中的
 * `<results>` 结构化块（files / findings / answer / next_steps / uncertainties）；
 * 无结构化块时退化为纯正文段。原始 XML 标签不再直接暴露给用户。
 * `failed` 即使没有描述也强制可见——可见性由 `parseMobileSubagentNotice` 裁决。
 */
export function SubagentNoticeRow({
  notice,
  grouped = false,
  onOpenChild,
}: SubagentNoticeRowProps) {
  const presentation = STATE_PRESENTATION[notice.state];
  const childSessionId = notice.childSessionId;
  const interactive = Boolean(childSessionId && onOpenChild);
  const accessibilityLabel = useMemo(() => buildNoticeAccessibilityLabel(notice), [notice]);

  const resultSections = useMemo(() => parseSubagentResultBlocks(notice.text), [notice.text]);

  const heading = (
    <Text
      accessibilityLabel={accessibilityLabel}
      ellipsizeMode="tail"
      numberOfLines={1}
      style={styles.rowText}
    >
      <Text style={[styles.glyph, { color: presentation.accent }]}>{`${presentation.glyph} `}</Text>
      <Text style={[styles.agent, { color: presentation.accent }]}>{notice.agent}</Text>
      <Text style={[styles.state, { color: presentation.accent }]}>{` ${presentation.label}`}</Text>
      {notice.description.length > 0 ? (
        <Text style={styles.description}>{` · ${notice.description}`}</Text>
      ) : null}
    </Text>
  );

  const card = <MobileSubagentResultCard sections={resultSections} />;

  if (!interactive) {
    return (
      <View style={[styles.base, grouped ? styles.grouped : styles.spaced]}>
        {heading}
        {card}
      </View>
    );
  }

  return (
    <View style={[styles.base, grouped ? styles.grouped : styles.spaced]}>
      <Pressable
        accessibilityHint="打开子会话"
        accessibilityRole="button"
        hitSlop={spacing[2]}
        style={({ pressed }) => [styles.headingPressable, pressed && styles.pressed]}
        onPress={() => {
          if (childSessionId && onOpenChild) {
            onOpenChild(childSessionId);
          }
        }}
      >
        {heading}
      </Pressable>
      {card}
    </View>
  );
}

export interface SubagentNoticeListProps {
  notices: readonly MobileSubagentNotice[];
  onOpenChild?: (childSessionId: string) => void;
}

/** 会话尾部的通知组：首个通知留出上间距，其余合组紧凑排布。 */
export function SubagentNoticeList({ notices, onOpenChild }: SubagentNoticeListProps) {
  if (notices.length === 0) {
    return null;
  }

  return (
    <View>
      {notices.map((notice, index) => (
        <SubagentNoticeRow
          key={notice.id}
          grouped={index > 0}
          notice={notice}
          {...(onOpenChild ? { onOpenChild } : {})}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.sm,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1.5],
  },
  spaced: { marginTop: spacing[2] },
  grouped: { marginTop: spacing[0.5] },
  headingPressable: {
    borderRadius: radii.xs,
    paddingHorizontal: spacing[0.5],
    paddingVertical: spacing[0.5],
  },
  pressed: { backgroundColor: colors.surface2 },
  rowText: {
    ...textPresets.bodySmall,
    color: colors.textMuted,
  },
  glyph: { fontWeight: '700' },
  agent: { fontWeight: '600' },
  state: { fontWeight: '600' },
  description: { color: colors.textSubtle, fontWeight: '500' },
});
