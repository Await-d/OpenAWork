import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput } from 'react-native';
import {
  IMAGE_GENERATION_COUNT_RANGE,
  IMAGE_GENERATION_QUALITY_OPTIONS,
  IMAGE_GENERATION_SIZE_PRESET_GROUPS,
  resolveImageGenerationSizePresetId,
  sizeForPreset,
  validateImageGenerationSize,
  type ImageGenerationBackground,
  type ImageGenerationModeration,
  type ImageGenerationOutputFormat,
  type ImageGenerationQuality,
} from '@openAwork/shared';

/** 可选的生成张数档位（官方 `n`），与生图面板共用同一区间定义。 */
const COUNT_VALUES: number[] = Array.from(
  { length: IMAGE_GENERATION_COUNT_RANGE.max - IMAGE_GENERATION_COUNT_RANGE.min + 1 },
  (_unused, index) => IMAGE_GENERATION_COUNT_RANGE.min + index,
);
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';

/** S09: 图片参数编辑 */
export default function ImageParamsScreen() {
  const [size, setSize] = useState('1024x1024');
  const [quality, setQuality] = useState<ImageGenerationQuality>('medium');
  const [format, setFormat] = useState<ImageGenerationOutputFormat>('png');
  const [background, setBackground] = useState<ImageGenerationBackground>('auto');
  const [moderation, setModeration] = useState<ImageGenerationModeration>('auto');
  const [count, setCount] = useState<number>(IMAGE_GENERATION_COUNT_RANGE.min);

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
          {IMAGE_GENERATION_QUALITY_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[styles.chip, quality === option.value && styles.chipActive]}
              onPress={() => setQuality(option.value)}
            >
              <Text style={[styles.chipText, quality === option.value && styles.chipTextActive]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.hint}>极高 / 最高仅 GPT Image 2.5 支持，其他模型会自动收敛。</Text>

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
          {(['auto', 'opaque', 'transparent'] as const).map((bg) => (
            <TouchableOpacity
              key={bg}
              style={[styles.chip, background === bg && styles.chipActive]}
              onPress={() => setBackground(bg)}
            >
              <Text style={[styles.chipText, background === bg && styles.chipTextActive]}>
                {bg === 'auto' ? '自动' : bg === 'opaque' ? '不透明' : '透明'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {background === 'transparent' && format === 'jpeg' && (
          <Text style={styles.hint}>透明背景需要 PNG 或 WebP，JPEG 不支持。</Text>
        )}

        {/* Moderation */}
        <Text style={styles.sectionTitle}>内容审核</Text>
        <View style={styles.chipRow}>
          {(['auto', 'low'] as const).map((level) => (
            <TouchableOpacity
              key={level}
              style={[styles.chip, moderation === level && styles.chipActive]}
              onPress={() => setModeration(level)}
            >
              <Text style={[styles.chipText, moderation === level && styles.chipTextActive]}>
                {level === 'auto' ? '标准' : '宽松'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Count */}
        <Text style={styles.sectionTitle}>张数</Text>
        <View style={styles.chipRow}>
          {COUNT_VALUES.map((value) => (
            <TouchableOpacity
              key={value}
              style={[styles.chip, count === value && styles.chipActive]}
              onPress={() => setCount(value)}
            >
              <Text style={[styles.chipText, count === value && styles.chipTextActive]}>
                {value} 张
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
          <Text style={styles.summaryLine}>
            背景：{background === 'auto' ? '自动' : background === 'opaque' ? '不透明' : '透明'}
          </Text>
          <Text style={styles.summaryLine}>审核：{moderation === 'auto' ? '标准' : '宽松'}</Text>
          <Text style={styles.summaryLine}>张数：{count} 张</Text>
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
