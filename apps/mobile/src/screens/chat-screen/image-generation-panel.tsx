import type { Dispatch, SetStateAction } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  IMAGE_GENERATION_SIZE_PRESET_GROUPS,
  resolveImageGenerationSizePresetId,
  sizeForPreset,
  validateImageGenerationSize,
} from '@openAwork/shared';
import type { MobileImageGenerationDefaults } from '../../store/providerPersistence';
import { colors } from '../../theme/colors';
import { styles } from './styles';

interface ChatImageGenerationPanelProps {
  hasConfiguredImageModel: boolean;
  imageDefaults: MobileImageGenerationDefaults;
  imageGenerationBusy: boolean;
  imageModelLabel: string;
  setImageDefaults: Dispatch<SetStateAction<MobileImageGenerationDefaults>>;
}

export function ChatImageGenerationPanel({
  hasConfiguredImageModel,
  imageDefaults,
  imageGenerationBusy,
  imageModelLabel,
  setImageDefaults,
}: ChatImageGenerationPanelProps) {
  return (
    <View style={styles.imagePanel}>
      <Text style={styles.imagePanelTitle}>图片生成 / 编辑</Text>
      <Text style={styles.imagePanelText}>
        {hasConfiguredImageModel ? `当前模型：${imageModelLabel}` : '请先在设置中配置图片模型。'}
      </Text>
      <Text style={styles.imagePanelHint}>
        支持 1K / 2K / 4K 档位下的横图 / 方图 / 竖图预设，也可输入合法自定义尺寸。可附加 1
        张参考图。
      </Text>
      <View style={styles.imagePresetGroups}>
        {IMAGE_GENERATION_SIZE_PRESET_GROUPS.map((group) => (
          <View key={group.tier} style={styles.imagePresetGroup}>
            <Text style={styles.imagePresetGroupTitle}>{group.label}</Text>
            <Text style={styles.imagePresetGroupHint}>{group.description}</Text>
            <View style={styles.imageOptionRow}>
              {group.presets.map((preset) => (
                <TouchableOpacity
                  key={preset.id}
                  style={[
                    styles.optionChip,
                    resolveImageGenerationSizePresetId(imageDefaults.size) === preset.id &&
                      styles.optionChipActive,
                  ]}
                  onPress={() => setImageDefaults((prev) => ({ ...prev, size: preset.size }))}
                  disabled={imageGenerationBusy}
                >
                  <Text
                    style={[
                      styles.optionChipText,
                      resolveImageGenerationSizePresetId(imageDefaults.size) === preset.id &&
                        styles.optionChipTextActive,
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
            styles.optionChip,
            resolveImageGenerationSizePresetId(imageDefaults.size) === 'custom' &&
              styles.optionChipActive,
          ]}
          onPress={() =>
            setImageDefaults((prev) => ({
              ...prev,
              size:
                resolveImageGenerationSizePresetId(prev.size) === 'custom'
                  ? prev.size
                  : sizeForPreset('1k'),
            }))
          }
          disabled={imageGenerationBusy}
        >
          <Text
            style={[
              styles.optionChipText,
              resolveImageGenerationSizePresetId(imageDefaults.size) === 'custom' &&
                styles.optionChipTextActive,
            ]}
          >
            自定义尺寸
          </Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        value={imageDefaults.size}
        onChangeText={(size) => setImageDefaults((prev) => ({ ...prev, size }))}
        placeholder="例如 2560x1440"
        placeholderTextColor={colors.textSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!imageGenerationBusy}
      />
      <Text
        style={[
          styles.imagePanelHint,
          !validateImageGenerationSize(imageDefaults.size).valid && styles.imagePanelHintDanger,
        ]}
      >
        {validateImageGenerationSize(imageDefaults.size).valid
          ? '合法范围：最长边 ≤ 3840、宽高为 16 的倍数、比例不超过 3:1。'
          : validateImageGenerationSize(imageDefaults.size).message}
      </Text>
      <View style={styles.imageOptionRow}>
        {(['low', 'medium', 'high'] as const).map((quality) => (
          <TouchableOpacity
            key={quality}
            style={[
              styles.optionChip,
              imageDefaults.quality === quality && styles.optionChipActive,
            ]}
            onPress={() => setImageDefaults((prev) => ({ ...prev, quality }))}
            disabled={imageGenerationBusy}
          >
            <Text
              style={[
                styles.optionChipText,
                imageDefaults.quality === quality && styles.optionChipTextActive,
              ]}
            >
              {quality}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.imageOptionRow}>
        {(['png', 'jpeg', 'webp'] as const).map((outputFormat) => (
          <TouchableOpacity
            key={outputFormat}
            style={[
              styles.optionChip,
              imageDefaults.outputFormat === outputFormat && styles.optionChipActive,
            ]}
            onPress={() => setImageDefaults((prev) => ({ ...prev, outputFormat }))}
            disabled={imageGenerationBusy}
          >
            <Text
              style={[
                styles.optionChipText,
                imageDefaults.outputFormat === outputFormat && styles.optionChipTextActive,
              ]}
            >
              {outputFormat.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
        {(['auto', 'opaque'] as const).map((background) => (
          <TouchableOpacity
            key={background}
            style={[
              styles.optionChip,
              imageDefaults.background === background && styles.optionChipActive,
            ]}
            onPress={() => setImageDefaults((prev) => ({ ...prev, background }))}
            disabled={imageGenerationBusy}
          >
            <Text
              style={[
                styles.optionChipText,
                imageDefaults.background === background && styles.optionChipTextActive,
              ]}
            >
              {background === 'auto' ? '自动背景' : '不透明背景'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
