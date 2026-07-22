import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../src/theme/colors';
import { textPresets } from '../src/theme/typography';

/** S14: 图片生成进度 — 独立进度指示组件/页面 */
export default function ImageGenerationProgressScreen() {
  const [stage, setStage] = useState(0);
  const stages = [
    { label: '解析提示词', icon: 'document-text-outline' as const },
    { label: '生成图片', icon: 'sparkles-outline' as const },
    { label: '后处理', icon: 'color-wand-outline' as const },
    { label: '保存结果', icon: 'save-outline' as const },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setStage((s) => Math.min(s + 1, stages.length - 1));
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>图片生成中</Text>
      <Text style={styles.subtitle}>请稍候，AI 正在创作你的图片。</Text>

      {/* Progress visualization */}
      <View style={styles.progressArea}>
        <View style={styles.spinnerWrap}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Ionicons name="sparkles" size={24} color={colors.accent} style={styles.sparkleIcon} />
        </View>
      </View>

      {/* Stage indicators */}
      <View style={styles.stageList}>
        {stages.map((s, i) => {
          const isDone = i < stage;
          const isCurrent = i === stage;
          const isPending = i > stage;
          return (
            <View key={i} style={styles.stageRow}>
              <View style={styles.stageTimeline}>
                <View
                  style={[
                    styles.stageDot,
                    isDone && { backgroundColor: colors.success },
                    isCurrent && { backgroundColor: colors.accent },
                    isPending && { backgroundColor: colors.lineDefault },
                  ]}
                />
                {i < stages.length - 1 && (
                  <View style={[styles.stageLine, isDone && { backgroundColor: colors.success }]} />
                )}
              </View>
              <Ionicons
                name={isDone ? 'checkmark-circle' : s.icon}
                size={18}
                color={isDone ? colors.success : isCurrent ? colors.accent : colors.textSubtle}
              />
              <Text
                style={[
                  styles.stageLabel,
                  isDone && { color: colors.success },
                  isCurrent && { color: colors.accent, fontWeight: '700' },
                  isPending && { color: colors.textSubtle },
                ]}
              >
                {s.label}
              </Text>
              {isCurrent && <ActivityIndicator size="small" color={colors.accent} />}
              {isDone && <Ionicons name="checkmark" size={14} color={colors.success} />}
            </View>
          );
        })}
      </View>

      <Text style={styles.estimate}>预计剩余 3–5 秒</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase, padding: 16, justifyContent: 'center' },
  title: { ...textPresets.title, color: colors.textStrong, textAlign: 'center' },
  subtitle: {
    ...textPresets.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 32,
  },

  progressArea: { alignItems: 'center', marginBottom: 32 },
  spinnerWrap: {
    position: 'relative',
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkleIcon: { position: 'absolute' },

  stageList: { gap: 0, marginBottom: 24 },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 40 },
  stageTimeline: { alignItems: 'center', width: 20 },
  stageDot: { width: 10, height: 10, borderRadius: 5 },
  stageLine: { width: 2, flex: 1, backgroundColor: colors.lineDefault, minHeight: 16 },
  stageLabel: { ...textPresets.body, flex: 1 },

  estimate: { ...textPresets.caption, color: colors.textSubtle, textAlign: 'center' },
});
