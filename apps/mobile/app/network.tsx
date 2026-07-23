import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNetworkState } from '../src/hooks/useNetworkState';
import { useAuthStore } from '../src/store/auth';
import { isGatewayHealthy } from '@openAwork/web-client';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ui';

/** S15: 网络与重连状态页 */
export default function NetworkStatusScreen() {
  const { isConnected } = useNetworkState();
  const { gatewayUrl, accessToken } = useAuthStore();
  const [gatewayStatus, setGatewayStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  async function checkGateway() {
    setGatewayStatus('checking');
    try {
      const ok = await isGatewayHealthy(gatewayUrl, { timeoutMs: 5000 });
      setGatewayStatus(ok ? 'ok' : 'error');
      setLastCheck(new Date());
    } catch {
      setGatewayStatus('error');
      setLastCheck(new Date());
    }
  }

  useEffect(() => {
    void checkGateway();
  }, [gatewayUrl]);

  function formatTime(date: Date): string {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader title="网络状态" />
      <View style={styles.container}>
        <Text style={styles.title}>网络状态</Text>
        <Text style={styles.subtitle}>诊断连接问题并手动重连。</Text>

        {/* Network card */}
        <View style={[styles.card, isConnected ? styles.cardOk : styles.cardErr]}>
          <View style={styles.cardHeader}>
            <Ionicons
              name={isConnected ? 'wifi' : 'wifi-outline'}
              size={20}
              color={isConnected ? colors.success : colors.danger}
            />
            <Text style={styles.cardTitle}>{isConnected ? '网络已连接' : '网络已断开'}</Text>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isConnected ? colors.success : colors.danger },
              ]}
            />
          </View>
          <Text style={styles.cardMeta}>
            {isConnected ? '设备网络正常，可以访问互联网。' : '请检查 Wi-Fi 或蜂窝数据连接。'}
          </Text>
        </View>

        {/* Gateway card */}
        <View
          style={[
            styles.card,
            gatewayStatus === 'ok'
              ? styles.cardOk
              : gatewayStatus === 'error'
                ? styles.cardErr
                : {},
          ]}
        >
          <View style={styles.cardHeader}>
            {gatewayStatus === 'checking' ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : (
              <Ionicons
                name={gatewayStatus === 'ok' ? 'globe' : 'globe-outline'}
                size={20}
                color={gatewayStatus === 'ok' ? colors.success : colors.danger}
              />
            )}
            <Text style={styles.cardTitle}>
              {gatewayStatus === 'checking'
                ? '检查中…'
                : gatewayStatus === 'ok'
                  ? 'Gateway 可达'
                  : 'Gateway 不可达'}
            </Text>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    gatewayStatus === 'ok'
                      ? colors.success
                      : gatewayStatus === 'error'
                        ? colors.danger
                        : colors.warning,
                },
              ]}
            />
          </View>
          <Text style={styles.cardMeta} numberOfLines={1}>
            {gatewayUrl}
          </Text>
          {lastCheck && <Text style={styles.cardTime}>上次检查：{formatTime(lastCheck)}</Text>}
        </View>

        {/* Auth card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons
              name={accessToken ? 'shield-checkmark' : 'shield-outline'}
              size={20}
              color={accessToken ? colors.success : colors.warning}
            />
            <Text style={styles.cardTitle}>{accessToken ? '已认证' : '未认证'}</Text>
          </View>
          <Text style={styles.cardMeta}>
            {accessToken ? 'Token 有效，会话可正常使用。' : '请重新登录以获取访问权限。'}
          </Text>
        </View>

        {/* Diagnostics */}
        <Text style={styles.sectionTitle}>诊断指标</Text>
        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{retryCount}</Text>
            <Text style={styles.metricLabel}>重连次数</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{isConnected ? '✓' : '✗'}</Text>
            <Text style={styles.metricLabel}>网络</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>
              {gatewayStatus === 'ok' ? '✓' : gatewayStatus === 'error' ? '✗' : '…'}
            </Text>
            <Text style={styles.metricLabel}>Gateway</Text>
          </View>
        </View>

        {/* Actions */}
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => {
            setRetryCount((c) => c + 1);
            void checkGateway();
          }}
        >
          <Ionicons name="refresh-outline" size={18} color={colors.white} />
          <Text style={styles.retryBtnText}>重新检查</Text>
        </TouchableOpacity>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase, padding: 16 },
  title: { ...textPresets.title, color: colors.textStrong, marginTop: 8 },
  subtitle: { ...textPresets.body, color: colors.textMuted, marginTop: 6, marginBottom: 20 },

  card: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 14,
    marginBottom: 10,
    gap: 4,
  },
  cardOk: { borderColor: colors.successBorder, backgroundColor: colors.successMuted },
  cardErr: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerMuted },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { ...textPresets.body, color: colors.textStrong, fontWeight: '700', flex: 1 },
  cardMeta: { ...textPresets.bodySmall, color: colors.textMuted },
  cardTime: { ...textPresets.caption, color: colors.textSubtle },
  statusDot: { width: 8, height: 8, borderRadius: 4 },

  sectionTitle: {
    ...textPresets.subheading,
    color: colors.textStrong,
    marginTop: 16,
    marginBottom: 10,
  },
  metricsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  metricCard: {
    flex: 1,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  metricValue: { ...textPresets.subheading, color: colors.textStrong, fontSize: 20 },
  metricLabel: { ...textPresets.caption, color: colors.textMuted },

  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
  },
  retryBtnText: { ...textPresets.body, color: colors.white, fontWeight: '700' },
});
