import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';

const STAGES = [
  { label: '解析提示词', icon: 'document-text-outline' as const },
  { label: '生成图片', icon: 'sparkles-outline' as const },
  { label: '后处理', icon: 'color-wand-outline' as const },
  { label: '保存结果', icon: 'save-outline' as const },
];

/** S14: 图片生成进度 — 独立进度指示组件/页面 */
export default function ImageGenerationProgressScreen() {
  const { sessionId, status } = useLocalSearchParams<{
    sessionId?: string;
    status?: 'generating' | 'done' | 'error';
    error?: string;
  }>();
  const [stage, setStage] = useState(0);
  const isDone = status === 'done';
  const isError = status === 'error';

  useEffect(() => {
    if (isDone || isError) {
      setStage(STAGES.length);
      return;
    }
    // 模拟进度推进（实际图片生成 API 是同步的，没有独立进度端点）
    const timer = setInterval(() => {
      setStage((s) => Math.min(s + 1, STAGES.length - 1));
    }, 2000);
    return () => clearInterval(timer);
  }, [isDone, isError]);

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader title="生成进度" />
      <View style={styles.container}>
        <Text style={styles.title}>
          {isDone ? '生成完成' : isError ? '生成失败' : '图片生成中'}
        </Text>
        <Text style={styles.subtitle}>
          {isDone
            ? '图片已保存，可在产物预览中查看。'
            : isError
              ? '生成过程中出现错误，请重试。'
              : '请稍候，AI 正在创作你的图片。'}
        </Text>

        {/* Progress visualization */}
        <View style={styles.progressArea}>
          {isDone ? (
            <Ionicons name="checkmark-circle" size={48} color={colors.success} />
          ) : isError ? (
            <Ionicons name="alert-circle-outline" size={48} color={colors.danger} />
          ) : (
            <View style={styles.spinnerWrap}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Ionicons
                name="sparkles"
                size={24}
                color={colors.accent}
                style={styles.sparkleIcon}
              />
            </View>
          )}
        </View>

        {/* Stage indicators */}
        <View style={styles.stageList}>
          {STAGES.map((s, i) => {
            const stageDone = isDone || i < stage;
            const stageCurrent = !isDone && !isError && i === stage;
            const stagePending = !isDone && i > stage;
            return (
              <View key={i} style={styles.stageRow}>
                <View style={styles.stageTimeline}>
                  <View
                    style={[
                      styles.stageDot,
                      stageDone && { backgroundColor: colors.success },
                      stageCurrent && { backgroundColor: colors.accent },
                      stagePending && { backgroundColor: colors.lineDefault },
                    ]}
                  />
                  {i < STAGES.length - 1 ? (
                    <View
                      style={[styles.stageLine, stageDone && { backgroundColor: colors.success }]}
                    />
                  ) : null}
                </View>
                <Ionicons
                  name={stageDone ? 'checkmark-circle' : s.icon}
                  size={18}
                  color={
                    stageDone ? colors.success : stageCurrent ? colors.accent : colors.textSubtle
                  }
                />
                <Text
                  style={[
                    styles.stageLabel,
                    stageDone && { color: colors.success },
                    stageCurrent && { color: colors.accent, fontWeight: '700' },
                    stagePending && { color: colors.textSubtle },
                  ]}
                >
                  {s.label}
                </Text>
                {stageCurrent ? <ActivityIndicator size="small" color={colors.accent} /> : null}
                {stageDone ? <Ionicons name="checkmark" size={14} color={colors.success} /> : null}
              </View>
            );
          })}
        </View>

        {/* Action buttons */}
        {isDone ? (
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/artifacts')}>
              <Ionicons name="cube-outline" size={16} color={colors.accent} />
              <Text style={styles.secondaryBtnText}>查看产物</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() =>
                sessionId ? router.replace(`/chat/${sessionId}`) : router.replace('/home')
              }
            >
              <Text style={styles.primaryBtnText}>返回聊天</Text>
            </TouchableOpacity>
          </View>
        ) : isError ? (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() =>
              sessionId ? router.replace(`/chat/${sessionId}`) : router.replace('/image-workspace')
            }
          >
            <Ionicons name="arrow-back" size={16} color={colors.white} />
            <Text style={styles.primaryBtnText}>返回重试</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.estimate}>预计剩余 3–5 秒</Text>
        )}
      </View>
    </Screen>
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

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    backgroundColor: colors.surface2,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
  },
  secondaryBtnText: { ...textPresets.body, color: colors.accent, fontWeight: '600' },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
  },
  primaryBtnText: { ...textPresets.body, color: colors.white, fontWeight: '700' },
});
