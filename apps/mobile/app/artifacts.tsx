import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';

interface Artifact {
  id: string;
  name: string;
  type: 'code' | 'image' | 'file' | 'html';
  size: string;
  time: string;
}

const MOCK_ARTIFACTS: Artifact[] = [
  { id: '1', name: 'auth.ts', type: 'code', size: '2.4 KB', time: '3 分钟前' },
  { id: '2', name: 'banner.png', type: 'image', size: '156 KB', time: '10 分钟前' },
  { id: '3', name: 'report.html', type: 'html', size: '8.1 KB', time: '1 小时前' },
  { id: '4', name: 'config.json', type: 'file', size: '1.2 KB', time: '2 小时前' },
];

const TYPE_ICONS: Record<Artifact['type'], keyof typeof Ionicons.glyphMap> = {
  code: 'code-slash-outline',
  image: 'image-outline',
  html: 'globe-outline',
  file: 'document-outline',
};

const TYPE_COLORS: Record<Artifact['type'], string> = {
  code: colors.accent,
  image: colors.contrast,
  html: colors.aux,
  file: colors.textMuted,
};

/** S24: 浏览器与产物预览 */
export default function ArtifactPreviewScreen() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <Screen>
      <ScreenHeader
        title="产物预览"
        right={
          <TouchableOpacity style={styles.headerAction}>
            <Ionicons name="download-outline" size={18} color={colors.aux} />
          </TouchableOpacity>
        }
      />

      {/* Preview area */}
      <View style={styles.previewArea}>
        <Ionicons name="document-outline" size={48} color={colors.textSubtle} />
        <Text style={styles.previewHint}>选择一个产物查看预览</Text>
      </View>

      {/* Artifact list */}
      <Text style={styles.sectionTitle}>已生成产物</Text>
      <FlatList
        data={MOCK_ARTIFACTS}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const isSelected = selectedId === item.id;
          return (
            <TouchableOpacity
              style={[styles.artifactCard, isSelected && styles.artifactCardActive]}
              onPress={() => setSelectedId(item.id)}
              activeOpacity={0.7}
            >
              <View style={[styles.iconWrap, { backgroundColor: TYPE_COLORS[item.type] + '1A' }]}>
                <Ionicons name={TYPE_ICONS[item.type]} size={18} color={TYPE_COLORS[item.type]} />
              </View>
              <View style={styles.infoWrap}>
                <Text style={styles.artifactName}>{item.name}</Text>
                <Text style={styles.artifactMeta}>
                  {item.size} · {item.time}
                </Text>
              </View>
              <View style={styles.actionGroup}>
                <TouchableOpacity style={styles.actionBtn}>
                  <Ionicons name="eye-outline" size={16} color={colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn}>
                  <Ionicons name="share-outline" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...textPresets.cardTitle, color: colors.textStrong },
  headerAction: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  previewArea: {
    height: 200,
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  previewHint: { ...textPresets.body, color: colors.textMuted },

  sectionTitle: {
    ...textPresets.subheading,
    color: colors.textStrong,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  listContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 32 },

  artifactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 12,
  },
  artifactCardActive: { borderColor: colors.accentBorder, backgroundColor: colors.accentMuted },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoWrap: { flex: 1, gap: 2 },
  artifactName: { ...textPresets.body, color: colors.textStrong, fontWeight: '600' },
  artifactMeta: { ...textPresets.caption, color: colors.textMuted },
  actionGroup: { flexDirection: 'row', gap: 4 },
  actionBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
