import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

export interface MobileAttachmentItem {
  id: string;
  name: string;
  type: 'image' | 'audio' | 'file';
  sizeBytes: number;
}

interface MobileAttachmentBarProps {
  attachments: MobileAttachmentItem[];
  onRemove: (id: string) => void;
}

const TYPE_ICON: Record<MobileAttachmentItem['type'], string> = {
  image: '⊞',
  audio: '♫',
  file: '⊟',
};

const TYPE_COLOR: Record<MobileAttachmentItem['type'], string> = {
  image: '#8b5cf6',
  audio: '#f59e0b',
  file: '#3b82f6',
};

function fmtSize(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)}KB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
}

export function MobileAttachmentBar({ attachments, onRemove }: MobileAttachmentBarProps) {
  if (attachments.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.content}
    >
      {attachments.map((a) => {
        const color = TYPE_COLOR[a.type];
        return (
          <View
            key={a.id}
            style={[styles.chip, { borderColor: `${color}50`, backgroundColor: `${color}12` }]}
          >
            <Text style={[styles.chipIcon, { color }]}>{TYPE_ICON[a.type]}</Text>
            <Text style={styles.chipName} numberOfLines={1}>
              {a.name}
            </Text>
            <Text style={styles.chipSize}>{fmtSize(a.sizeBytes)}</Text>
            <TouchableOpacity
              onPress={() => onRemove(a.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.chipRemove}>✕</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 44 },
  content: { paddingHorizontal: 12, gap: 8, alignItems: 'center', paddingVertical: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 5,
    maxWidth: 180,
  },
  chipIcon: { fontSize: 13 },
  chipName: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '500',
    flex: 1,
    minWidth: 30,
    maxWidth: 90,
  },
  chipSize: { color: '#64748b', fontSize: 10 },
  chipRemove: { color: '#64748b', fontSize: 12, fontWeight: '700' },
});
