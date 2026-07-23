import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput } from 'react-native';
import {
  IMAGE_GENERATION_SIZE_PRESET_GROUPS,
  resolveImageGenerationSizePresetId,
  sizeForPreset,
  validateImageGenerationSize,
} from '@openAwork/shared';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';

/** S09: 图片参数编辑 */
export default function ImageParamsScreen() {
  const [size, setSize] = useState('1024x1024');
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('medium');
  const [format, setFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [background, setBackground] = useState<'auto' | 'opaque'>('auto');

  const sizeValidation = validateImageGenerationSize(size);

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <ScreenHeader title="图片参数" />

        <Text style={styles.title}>生成参数</Text>
        <Text style={styles.subtitle}>调整尺寸、质量、格式等参数。</Text>

        {/* Size presets */}
        <Text style={styles.sectionTitle}>尺寸</Text>
        {IMAGE_GENERATION_SIZE_PRESET_GROUPS.map((group) => (
          <View key={group.tier} style={styles.presetGroup}>
            <Text style={styles.presetLabel}>
              {group.label} — {group.description}
            </Text>
            <View style={styles.chipRow}>
              {group.presets.map((preset) => (
                <TouchableOpacity
                  key={preset.id}
                  style={[
                    styles.chip,
                    resolveImageGenerationSizePresetId(size) === preset.id && styles.chipActive,
                  ]}
                  onPress={() => setSize(preset.size)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      resolveImageGenerationSizePresetId(size) === preset.id &&
                        styles.chipTextActive,
                    ]}
                  >
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
        <TouchableOpacity
          style={[
            styles.chip,
            resolveImageGenerationSizePresetId(size) === 'custom' && styles.chipActive,
          ]}
          onPress={() => setSize(sizeForPreset('1k'))}
        >
          <Text
            style={[
              styles.chipText,
              resolveImageGenerationSizePresetId(size) === 'custom' && styles.chipTextActive,
            ]}
          >
            自定义
          </Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={size}
          onChangeText={setSize}
          placeholder="2560x1440"
          placeholderTextColor={colors.textSubtle}
          autoCapitalize="none"
        />
        <Text style={[styles.hint, !sizeValidation.valid && { color: colors.danger }]}>
          {sizeValidation.valid ? '最长边 ≤ 3840、宽高为 16 的倍数' : sizeValidation.message}
        </Text>

        {/* Quality */}
        <Text style={styles.sectionTitle}>质量</Text>
        <View style={styles.chipRow}>
          {(['low', 'medium', 'high'] as const).map((q) => (
            <TouchableOpacity
              key={q}
              style={[styles.chip, quality === q && styles.chipActive]}
              onPress={() => setQuality(q)}
            >
              <Text style={[styles.chipText, quality === q && styles.chipTextActive]}>{q}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Format */}
        <Text style={styles.sectionTitle}>格式</Text>
        <View style={styles.chipRow}>
          {(['png', 'jpeg', 'webp'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.chip, format === f && styles.chipActive]}
              onPress={() => setFormat(f)}
            >
              <Text style={[styles.chipText, format === f && styles.chipTextActive]}>
                {f.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Background */}
        <Text style={styles.sectionTitle}>背景</Text>
        <View style={styles.chipRow}>
          {(['auto', 'opaque'] as const).map((bg) => (
            <TouchableOpacity
              key={bg}
              style={[styles.chip, background === bg && styles.chipActive]}
              onPress={() => setBackground(bg)}
            >
              <Text style={[styles.chipText, background === bg && styles.chipTextActive]}>
                {bg === 'auto' ? '自动' : '不透明'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>当前参数</Text>
          <Text style={styles.summaryLine}>尺寸：{size}</Text>
          <Text style={styles.summaryLine}>质量：{quality}</Text>
          <Text style={styles.summaryLine}>格式：{format.toUpperCase()}</Text>
          <Text style={styles.summaryLine}>背景：{background === 'auto' ? '自动' : '不透明'}</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { padding: 16, paddingBottom: 32 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    marginBottom: 8,
    marginTop: 16,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...textPresets.cardTitle, color: colors.textStrong },

  title: { ...textPresets.title, color: colors.textStrong, fontSize: 22 },
  subtitle: { ...textPresets.body, color: colors.textMuted, marginTop: 4, marginBottom: 16 },

  sectionTitle: {
    ...textPresets.subheading,
    color: colors.textStrong,
    marginTop: 16,
    marginBottom: 8,
  },
  presetGroup: { marginBottom: 8 },
  presetLabel: { ...textPresets.caption, color: colors.textMuted, marginBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    backgroundColor: colors.surface2,
  },
  chipActive: { borderColor: colors.contrastBorder, backgroundColor: colors.contrastMuted },
  chipText: { ...textPresets.caption, color: colors.textMuted },
  chipTextActive: { color: colors.contrast, fontWeight: '600' },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 10,
    color: colors.textStrong,
    fontSize: 14,
    marginBottom: 4,
  },
  hint: { ...textPresets.caption, color: colors.textMuted, marginBottom: 8 },

  summaryCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 14,
    gap: 4,
    marginTop: 16,
  },
  summaryTitle: { ...textPresets.label, color: colors.textStrong, marginBottom: 4 },
  summaryLine: { ...textPresets.bodySmall, color: colors.textMuted },
});
