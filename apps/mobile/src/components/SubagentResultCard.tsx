import { StyleSheet, Text, View } from 'react-native';
import type {
  SubagentResultItem,
  SubagentResultSection,
  SubagentResultSectionKind,
} from '@openAwork/shared';
import { colors } from '../theme/colors';
import { radii } from '../theme/radii';
import { spacing } from '../theme/spacing';
import { textPresets } from '../theme/typography';

interface SectionPresentation {
  label: string;
  accent: string;
}

/** 分节标题与语义色映射（与 Web 端 shared-ui 的 SubagentResultCard 保持一致）。 */
function sectionPresentation(kind: SubagentResultSectionKind): SectionPresentation {
  switch (kind) {
    case 'files':
      return { label: '相关文件', accent: colors.aux };
    case 'findings':
      return { label: '关键发现', accent: colors.warning };
    case 'answer':
      return { label: '回答', accent: colors.accent };
    case 'next_steps':
      return { label: '后续步骤', accent: colors.aux };
    case 'uncertainties':
      return { label: '待确认', accent: colors.warning };
    default:
      return { label: '明细', accent: colors.textMuted };
  }
}

function isFileLike(text: string): boolean {
  return /^\s*\/\S/.test(text) || /^[a-z]+:\/\//i.test(text);
}

function ListItem({ item }: { item: SubagentResultItem }) {
  return (
    <View style={listStyles.itemRow}>
      <Text style={[listStyles.itemText, isFileLike(item.text) && listStyles.itemTextMono]}>
        {item.text}
      </Text>
      {item.detail ? <Text style={listStyles.itemDetail}>{`— ${item.detail}`}</Text> : null}
    </View>
  );
}

function SectionHeader({ kind }: { kind: SubagentResultSectionKind }) {
  const presentation = sectionPresentation(kind);
  return (
    <View style={styles.sectionHeader}>
      <View style={[styles.sectionBar, { backgroundColor: presentation.accent }]} />
      <Text style={[styles.sectionLabel, { color: presentation.accent }]}>
        {presentation.label}
      </Text>
    </View>
  );
}

export interface MobileSubagentResultCardProps {
  /** 由 `parseSubagentResultBlocks` 解析出的分节（三端共用 SSOT）。 */
  sections: readonly SubagentResultSection[];
}

/**
 * 移动端子代理结构化结果卡片：把 `<results>` 结果块渲染为分节视图
 * （answer → files/findings → next_steps/uncertainties → 其它）。
 *
 * 无结构化块（全部 raw）时退化为纯正文段，不做卡片装饰。
 * 样式语义对齐 Web 端 `SubagentResultCard`（shared-ui）。
 */
export function MobileSubagentResultCard({ sections }: MobileSubagentResultCardProps) {
  const structured = sections.some((section) => section.kind !== 'raw');

  if (!structured) {
    return (
      <View style={styles.plainBlock}>
        {sections
          .filter((section) => section.body?.trim())
          .map((section, index) => (
            <Text key={index} style={styles.plainText}>
              {section.body?.trim()}
            </Text>
          ))}
      </View>
    );
  }

  const orderedSections = [
    ...sections.filter((section) => section.kind === 'answer'),
    ...sections.filter((section) => section.kind === 'files' || section.kind === 'findings'),
    ...sections.filter(
      (section) => section.kind === 'next_steps' || section.kind === 'uncertainties',
    ),
    ...sections.filter((section) => section.kind === 'other'),
    ...sections.filter((section) => section.kind === 'raw' && section.body?.trim()),
  ];

  return (
    <View style={styles.card}>
      {orderedSections.map((section, index) => {
        const items = section.items;
        if (items && items.length > 0) {
          return (
            <View key={index} style={styles.section}>
              <SectionHeader kind={section.kind} />
              <View>
                {items.map((item, itemIndex) => (
                  <ListItem key={itemIndex} item={item} />
                ))}
              </View>
            </View>
          );
        }
        const body = section.body?.trim();
        if (body) {
          const isRaw = section.kind === 'raw';
          return (
            <View key={index} style={isRaw ? undefined : styles.section}>
              {isRaw ? null : <SectionHeader kind={section.kind} />}
              <Text style={styles.bodyText}>{body}</Text>
            </View>
          );
        }
        return null;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    marginTop: spacing[1],
  },
  plainBlock: {
    marginTop: spacing[1],
  },
  plainText: {
    ...textPresets.bodySmall,
    color: colors.textMuted,
  },
  section: {
    marginBottom: spacing[3],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing[1],
  },
  sectionBar: {
    width: 3,
    height: 12,
    borderRadius: radii.xs,
    marginRight: spacing[1],
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  bodyText: {
    ...textPresets.body,
    color: colors.textDefault,
  },
});

const listStyles = StyleSheet.create({
  itemRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'baseline',
    paddingVertical: spacing[1] / 2,
  },
  itemText: {
    ...textPresets.bodySmall,
    color: colors.textDefault,
    fontWeight: '600',
    flexShrink: 1,
  },
  itemTextMono: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
  itemDetail: {
    ...textPresets.bodySmall,
    color: colors.textMuted,
    flexShrink: 1,
  },
});
