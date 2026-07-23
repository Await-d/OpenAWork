import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../src/store/auth';
import { createArtifactsClient } from '@openAwork/web-client';
import {
  IMAGE_GENERATION_SIZE_PRESET_GROUPS,
  resolveImageGenerationSizePresetId,
  validateImageGenerationSize,
} from '@openAwork/shared';
import ExpoPersistenceAdapter, {
  DEFAULT_MOBILE_IMAGE_GENERATION_DEFAULTS,
  type MobileImageGenerationDefaults,
} from '../src/store/providerPersistence';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';

const persistence = new ExpoPersistenceAdapter();

/** S05: 图片工作台 — 独立图片生成/编辑界面 */
export default function ImageWorkspaceScreen() {
  const { accessToken, gatewayUrl } = useAuthStore();
  const [prompt, setPrompt] = useState('');
  const [defaults, setDefaults] = useState<MobileImageGenerationDefaults>(
    DEFAULT_MOBILE_IMAGE_GENERATION_DEFAULTS,
  );
  const [generating, setGenerating] = useState(false);
  const [hasModel, setHasModel] = useState(false);
  const [modelLabel, setModelLabel] = useState('GPT Image 2 · OpenAI');

  useEffect(() => {
    void (async () => {
      const config = await persistence.loadProviderConfig();
      const active = config?.active.image;
      const provider = active
        ? config?.providers.find((p) => p.id === active.providerId)
        : undefined;
      const model = provider?.defaultModels.find((m) => m.id === active?.modelId);
      const key = active ? await persistence.loadApiKey(active.providerId) : null;
      setHasModel(Boolean(provider && model && key?.trim()));
      if (provider && model) setModelLabel(`${model.label} · ${provider.name}`);
    })();
  }, []);

  async function handleGenerate() {
    if (!prompt.trim()) {
      Alert.alert('提示', '请输入图片描述');
      return;
    }
    if (!accessToken) {
      Alert.alert('错误', '请先登录');
      return;
    }
    const validation = validateImageGenerationSize(defaults.size);
    if (!validation.valid) {
      Alert.alert('尺寸无效', validation.message ?? '请输入合法尺寸');
      return;
    }

    setGenerating(true);
    try {
      const result = await createArtifactsClient(gatewayUrl).generateImage(accessToken, 'current', {
        prompt: prompt.trim(),
        size: defaults.size,
        quality: defaults.quality,
        outputFormat: defaults.outputFormat,
        background: defaults.background,
      });
      Alert.alert(
        '已生成',
        `图片已保存：${(result as { artifact?: { title?: string } }).artifact?.title ?? '查看附件历史'}`,
      );
    } catch (err) {
      Alert.alert('生成失败', err instanceof Error ? err.message : '请重试');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader title="图片工作台" />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.subtitle}>AI 生成图片、编辑、变体创作。</Text>

        {/* Model status */}
        <View style={[styles.modelCard, hasModel ? styles.modelOk : styles.modelErr]}>
          <Ionicons
            name={hasModel ? 'checkmark-circle' : 'alert-circle-outline'}
            size={18}
            color={hasModel ? colors.success : colors.warning}
          />
          <Text style={styles.modelText}>
            {hasModel ? `当前模型：${modelLabel}` : '请先在设置中配置图片模型'}
          </Text>
        </View>

        {/* Prompt */}
        <Text style={styles.fieldLabel}>图片描述</Text>
        <TextInput
          style={styles.promptInput}
          placeholder="描述你想生成或编辑的图片…"
          placeholderTextColor={colors.textSubtle}
          value={prompt}
          onChangeText={setPrompt}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        {/* Size presets */}
        <Text style={styles.sectionTitle}>尺寸</Text>
        {IMAGE_GENERATION_SIZE_PRESET_GROUPS.map((group) => (
          <View key={group.tier} style={styles.presetGroup}>
            <Text style={styles.presetGroupLabel}>{group.label}</Text>
            <View style={styles.chipRow}>
              {group.presets.map((preset) => (
                <TouchableOpacity
                  key={preset.id}
                  style={[
                    styles.chip,
                    resolveImageGenerationSizePresetId(defaults.size) === preset.id &&
                      styles.chipActive,
                  ]}
                  onPress={() => setDefaults((d) => ({ ...d, size: preset.size }))}
                >
                  <Text
                    style={[
                      styles.chipText,
                      resolveImageGenerationSizePresetId(defaults.size) === preset.id &&
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
        <TextInput
          style={styles.input}
          placeholder="自定义尺寸 如 2560x1440"
          placeholderTextColor={colors.textSubtle}
          value={defaults.size}
          onChangeText={(size) => setDefaults((d) => ({ ...d, size }))}
          autoCapitalize="none"
        />
        <Text
          style={[
            styles.hint,
            !validateImageGenerationSize(defaults.size).valid && { color: colors.danger },
          ]}
        >
          {validateImageGenerationSize(defaults.size).valid
            ? '最长边 ≤ 3840、宽高为 16 的倍数、比例不超过 3:1'
            : validateImageGenerationSize(defaults.size).message}
        </Text>

        {/* Quality / Format / Background */}
        <Text style={styles.sectionTitle}>质量</Text>
        <View style={styles.chipRow}>
          {(['low', 'medium', 'high'] as const).map((q) => (
            <TouchableOpacity
              key={q}
              style={[styles.chip, defaults.quality === q && styles.chipActive]}
              onPress={() => setDefaults((d) => ({ ...d, quality: q }))}
            >
              <Text style={[styles.chipText, defaults.quality === q && styles.chipTextActive]}>
                {q}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>格式</Text>
        <View style={styles.chipRow}>
          {(['png', 'jpeg', 'webp'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.chip, defaults.outputFormat === f && styles.chipActive]}
              onPress={() => setDefaults((d) => ({ ...d, outputFormat: f }))}
            >
              <Text style={[styles.chipText, defaults.outputFormat === f && styles.chipTextActive]}>
                {f.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
          {(['auto', 'opaque'] as const).map((bg) => (
            <TouchableOpacity
              key={bg}
              style={[styles.chip, defaults.background === bg && styles.chipActive]}
              onPress={() => setDefaults((d) => ({ ...d, background: bg }))}
            >
              <Text style={[styles.chipText, defaults.background === bg && styles.chipTextActive]}>
                {bg === 'auto' ? '自动背景' : '不透明'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Secondary entries */}
        <View style={styles.linkRowWrap}>
          <TouchableOpacity
            style={styles.linkCard}
            activeOpacity={0.7}
            onPress={() => router.push('/image-params')}
          >
            <Ionicons name="options-outline" size={16} color={colors.accent} />
            <View style={styles.linkTextWrap}>
              <Text style={styles.linkTitle}>图片参数编辑</Text>
              <Text style={styles.linkDesc}>尺寸、质量、格式与背景</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkCard}
            activeOpacity={0.7}
            onPress={() => router.push('/image-progress')}
          >
            <Ionicons name="hourglass-outline" size={16} color={colors.contrast} />
            <View style={styles.linkTextWrap}>
              <Text style={styles.linkTitle}>生成进度</Text>
              <Text style={styles.linkDesc}>查看进行中的图片任务</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
          </TouchableOpacity>
        </View>

        {/* Generate button */}
        <TouchableOpacity
          style={[styles.generateBtn, (generating || !hasModel) && { opacity: 0.5 }]}
          onPress={() => void handleGenerate()}
          disabled={generating || !hasModel}
        >
          {generating ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <Ionicons name="sparkles" size={18} color={colors.white} />
              <Text style={styles.generateText}>生成图片</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { padding: 16, paddingBottom: 32 },

  title: { ...textPresets.title, color: colors.textStrong, marginTop: 16 },
  subtitle: { ...textPresets.body, color: colors.textMuted, marginTop: 6, marginBottom: 16 },

  modelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: 16,
  },
  modelOk: { backgroundColor: colors.successMuted, borderColor: colors.successBorder },
  modelErr: { backgroundColor: colors.warningMuted, borderColor: colors.warningBorder },
  modelText: { ...textPresets.label, color: colors.textDefault, flex: 1 },

  fieldLabel: { ...textPresets.label, color: colors.textMuted, marginBottom: 6 },
  promptInput: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 14,
    color: colors.textStrong,
    fontSize: 15,
    minHeight: 100,
    marginBottom: 16,
  },
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
  hint: { ...textPresets.caption, color: colors.textMuted, marginBottom: 12 },

  linkRowWrap: { gap: 10, marginBottom: 16 },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  linkTextWrap: { flex: 1, gap: 2 },
  linkTitle: { ...textPresets.body, color: colors.textStrong, fontWeight: '700' },
  linkDesc: { ...textPresets.caption, color: colors.textMuted },

  sectionTitle: {
    ...textPresets.subheading,
    color: colors.textStrong,
    marginBottom: 8,
    marginTop: 8,
  },
  presetGroup: { marginBottom: 8 },
  presetGroupLabel: { ...textPresets.caption, color: colors.textMuted, marginBottom: 6 },
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

  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    marginTop: 16,
    shadowColor: colors.accent,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  generateText: { ...textPresets.body, color: colors.white, fontWeight: '700', fontSize: 15 },
});
