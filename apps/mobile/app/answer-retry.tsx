import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { createSessionsClient } from '@openAwork/web-client';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';
import { useAuthStore } from '../src/store/auth';

const RETRY_MODES = [
  {
    id: 'same',
    icon: 'refresh-outline' as const,
    title: '相同提示词重试',
    desc: '使用完全相同的输入重新生成',
    color: colors.accent,
  },
  {
    id: 'edit',
    icon: 'create-outline' as const,
    title: '编辑后重试',
    desc: '修改提示词后重新生成',
    color: colors.aux,
  },
  {
    id: 'model',
    icon: 'swap-horizontal-outline' as const,
    title: '切换模型重试',
    desc: '换一个模型重新生成',
    color: colors.contrast,
  },
  {
    id: 'temperature',
    icon: 'thermometer-outline' as const,
    title: '调整参数重试',
    desc: '调整温度、最大 Token 等参数',
    color: colors.success,
  },
] as const;

/** S26: 回答重试方式选择 */
export default function AnswerRetryScreen() {
  const { sessionId, messageId } = useLocalSearchParams<{
    sessionId: string;
    messageId?: string;
  }>();
  const { accessToken, gatewayUrl } = useAuthStore();
  const [selected, setSelected] = useState<string>('same');
  const [retrying, setRetrying] = useState(false);

  const handleRetry = useCallback(async () => {
    if (!sessionId || !accessToken || !messageId) {
      Alert.alert('提示', '缺少会话或消息信息，无法重试');
      return;
    }
    setRetrying(true);
    try {
      const client = createSessionsClient(gatewayUrl);
      await client.truncateMessages(accessToken, sessionId, messageId, { inclusive: true });
      router.replace(`/chat/${sessionId}`);
    } catch (err) {
      Alert.alert('重试失败', err instanceof Error ? err.message : '请稍后重试');
    } finally {
      setRetrying(false);
    }
  }, [sessionId, messageId, accessToken, gatewayUrl]);

  return (
    <Screen>
      <ScreenHeader title="重试方式" />

      <Text style={styles.title}>选择重试方式</Text>
      <Text style={styles.subtitle}>选择一种方式重新生成上一条回复。</Text>

      {/* Original response preview */}
      <View style={styles.originalCard}>
        <View style={styles.originalHeader}>
          <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.textMuted} />
          <Text style={styles.originalLabel}>原始回复</Text>
        </View>
        <Text style={styles.originalText} numberOfLines={3}>
          {selected === 'edit'
            ? '编辑后重试：将截断到上一条用户消息，你可以修改后重新发送。'
            : selected === 'model'
              ? '切换模型重试：将在聊天页面中切换模型后重新生成。'
              : selected === 'temperature'
                ? '调整参数重试：将在聊天页面中调整参数后重新生成。'
                : '相同提示词重试：将截断到上一条用户消息并重新发送。'}
        </Text>
      </View>

      {/* Retry mode selection */}
      <View style={styles.modeList}>
        {RETRY_MODES.map((mode) => {
          const isActive = selected === mode.id;
          return (
            <TouchableOpacity
              key={mode.id}
              style={[styles.modeCard, isActive && styles.modeCardActive]}
              onPress={() => setSelected(mode.id)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.modeIconWrap,
                  { backgroundColor: isActive ? mode.color + '1A' : colors.surface2 },
                ]}
              >
                <Ionicons
                  name={mode.icon}
                  size={20}
                  color={isActive ? mode.color : colors.textMuted}
                />
              </View>
              <View style={styles.modeTextWrap}>
                <Text style={styles.modeTitle}>{mode.title}</Text>
                <Text style={styles.modeDesc}>{mode.desc}</Text>
              </View>
              {isActive && <Ionicons name="checkmark-circle" size={20} color={mode.color} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Action */}
      <TouchableOpacity
        style={[styles.retryBtn, retrying && { opacity: 0.6 }]}
        disabled={retrying}
        onPress={() => void handleRetry()}
      >
        {retrying ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <>
            <Ionicons name="refresh" size={18} color={colors.white} />
            <Text style={styles.retryText}>重新生成</Text>
          </>
        )}
      </TouchableOpacity>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase, padding: 16 },
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

  originalCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 12,
    marginBottom: 20,
    gap: 8,
  },
  originalHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  originalLabel: { ...textPresets.label, color: colors.textMuted },
  originalText: { ...textPresets.bodySmall, color: colors.textDefault, lineHeight: 18 },

  modeList: { gap: 10, marginBottom: 24 },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 14,
  },
  modeCardActive: { borderColor: colors.accentBorder, backgroundColor: colors.accentMuted },
  modeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTextWrap: { flex: 1, gap: 2 },
  modeTitle: { ...textPresets.cardTitle, color: colors.textStrong },
  modeDesc: { ...textPresets.cardDescription, color: colors.textMuted },

  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    shadowColor: colors.accent,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  retryText: { ...textPresets.body, color: colors.white, fontWeight: '700', fontSize: 15 },
});
