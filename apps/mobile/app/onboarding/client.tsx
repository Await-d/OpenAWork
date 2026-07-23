import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import {
  CameraView as CameraViewBase,
  useCameraPermissions,
  type BarcodeScanningResult,
} from 'expo-camera';
import type { ComponentType } from 'react';
import { loginWithPairingToken } from '@openAwork/web-client';
import {
  normalizeMobileGatewayUrl,
  useAuthStore,
  DEFAULT_MOBILE_GATEWAY_URL,
} from '../../src/store/auth';
import { Screen } from '../../src/components/Screen';
import { colors } from '../../src/theme/colors';
import { radii } from '../../src/theme/radii';
import { textPresets } from '../../src/theme/typography';

// Cast CameraView to fix React 19 JSX type compatibility
const CameraView = CameraViewBase as unknown as ComponentType<Record<string, unknown>>;

function parseExpIn(expiresIn: string): number {
  const m = /^(\d+)(s|m|h)?$/.exec(expiresIn);
  if (!m) return 15 * 60 * 1000;
  const n = parseInt(m[1] ?? '15', 10);
  const u = m[2] ?? 'm';
  if (u === 's') return n * 1000;
  if (u === 'h') return n * 3600 * 1000;
  return n * 60 * 1000;
}

/** 连接桌面端 — 扫码配对 / 手动粘贴配对 JSON */
export default function ClientPairingScreen() {
  const { setGatewayUrl, setTokens } = useAuthStore();
  const [permission, requestPermission] = useCameraPermissions();
  const [pairingCode, setPairingCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const [connected, setConnected] = useState(false);
  const isDisabled = loading || connected || pairingCode.trim().length === 0;

  const completePairingLogin = useCallback(
    async (rawCode: string) => {
      setLoading(true);
      setError(null);
      try {
        let hostUrl: string | undefined;
        let token: string | undefined;

        // 尝试解析为 JSON
        try {
          const parsed = JSON.parse(rawCode.trim()) as { hostUrl?: string; token?: string };
          hostUrl = parsed.hostUrl;
          token = parsed.token;
        } catch {
          // 非 JSON 格式，视为纯 token 字符串
          token = rawCode.trim();
        }

        if (!token) throw new Error('缺少 token，请粘贴配对码或配对 JSON');

        // 如果没有 hostUrl，使用默认网关地址
        const url = normalizeMobileGatewayUrl(hostUrl ?? DEFAULT_MOBILE_GATEWAY_URL);
        try {
          const data = await loginWithPairingToken(url, token, {
            deviceName: 'Mobile',
            platform: Platform.OS === 'ios' ? 'ios' : 'android',
          });
          await setGatewayUrl(url);
          await setTokens(data.accessToken, data.refreshToken);
          const expiresMs = data.expiresIn ? parseExpIn(data.expiresIn) : 15 * 60 * 1000;
          await SecureStore.setItemAsync(
            'openwork_token_expires_at',
            String(Date.now() + expiresMs),
          );
          await AsyncStorage.setItem('onboarded', 'true');
          setConnected(true);
          setTimeout(() => {
            router.replace('/home');
          }, 800);
        } catch (apiErr) {
          const msg = apiErr instanceof Error ? apiErr.message : '配对登录失败';
          throw new Error(`${msg}（${url}）`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '配对失败，请重试');
        setScanned(false);
      } finally {
        setLoading(false);
      }
    },
    [setGatewayUrl, setTokens],
  );

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (scanned || loading) return;
      setScanned(true);
      setPairingCode(result.data);
      void completePairingLogin(result.data);
    },
    [scanned, loading, completePairingLogin],
  );

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={18} color={colors.textDefault} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>连接桌面端</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* 连接状态 */}
        <View style={styles.statusCard}>
          <Ionicons
            name={connected ? 'checkmark-circle' : 'radio-button-off-outline'}
            size={16}
            color={connected ? colors.success : colors.textSubtle}
          />
          <Text style={styles.statusText}>
            {connected ? '配对成功，正在跳转…' : loading ? '正在配对…' : '等待扫描配对码'}
          </Text>
        </View>

        {/* 网关地址 */}
        <View style={styles.gatewayCard}>
          <Ionicons name="globe-outline" size={14} color={colors.textMuted} />
          <Text style={styles.gatewayLabel}>网关：</Text>
          <Text style={styles.gatewayUrl} numberOfLines={1}>
            {DEFAULT_MOBILE_GATEWAY_URL}
          </Text>
        </View>

        {/* 扫码区域 */}
        <View style={styles.cameraCard}>
          {permission?.granted ? (
            <CameraView
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={scanned || loading ? undefined : handleBarcodeScanned}
              style={styles.cameraPreview}
            />
          ) : (
            <View style={styles.cameraPermissionBox}>
              <Ionicons name="camera-outline" size={36} color={colors.textSubtle} />
              <Text style={styles.cameraPermissionText}>需要相机权限才能扫描二维码</Text>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => void requestPermission()}
              >
                <Text style={styles.secondaryBtnText}>授权相机</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {scanned && !loading && !connected ? (
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setScanned(false)}>
            <Text style={styles.secondaryBtnText}>重新扫描</Text>
          </TouchableOpacity>
        ) : null}

        {/* 手动输入配对码 */}
        <Text style={styles.sectionLabel}>手动粘贴配对码</Text>
        <TextInput
          style={styles.codeInput}
          placeholder="粘贴配对 JSON 或纯 token 字符串"
          placeholderTextColor={colors.textSubtle}
          value={pairingCode}
          onChangeText={(v) => {
            setPairingCode(v);
            setError(null);
            setScanned(false);
          }}
          multiline
          numberOfLines={3}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TouchableOpacity
          style={[styles.primaryBtn, isDisabled && styles.disabledBtn]}
          onPress={() => void completePairingLogin(pairingCode)}
          disabled={isDisabled}
        >
          {loading ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <>
              <Ionicons name="git-merge-outline" size={16} color={colors.white} />
              <Text style={styles.primaryBtnText}>使用配对码连接</Text>
            </>
          )}
        </TouchableOpacity>

        {/* 提示 */}
        <View style={styles.tipCard}>
          <Ionicons name="information-circle-outline" size={17} color={colors.aux} />
          <Text style={styles.tipText}>
            在桌面端开启局域网访问后，终端或 Web/Desktop 界面会显示配对二维码。
          </Text>
        </View>

        {error ? (
          <View style={styles.errorBar}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { padding: 16, paddingBottom: 32 },

  /* header */
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 38,
    marginBottom: 16,
    marginTop: 16,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...textPresets.cardTitle,
    color: colors.textStrong,
  },

  /* status */
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingHorizontal: 12,
    height: 38,
    marginBottom: 16,
  },
  statusText: {
    ...textPresets.label,
    color: colors.textDefault,
  },

  /* gateway */
  gatewayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface2,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingHorizontal: 10,
    height: 32,
    marginBottom: 12,
  },
  gatewayLabel: {
    ...textPresets.caption,
    color: colors.textMuted,
  },
  gatewayUrl: {
    ...textPresets.caption,
    color: colors.textStrong,
    fontWeight: '600',
    flex: 1,
  },

  /* camera */
  cameraCard: {
    height: 260,
    overflow: 'hidden',
    borderRadius: radii.lg + 2,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    backgroundColor: colors.surface2,
    marginBottom: 12,
  },
  cameraPreview: { flex: 1 },
  cameraPermissionBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 18,
  },
  cameraPermissionText: {
    ...textPresets.body,
    color: colors.textMuted,
    textAlign: 'center',
  },

  /* form */
  sectionLabel: {
    ...textPresets.label,
    color: colors.textMuted,
    marginBottom: 6,
    marginTop: 4,
  },
  codeInput: {
    backgroundColor: colors.surface2,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 10,
    color: colors.textStrong,
    fontSize: 13,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 12,
  },

  /* buttons */
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    marginBottom: 16,
  },
  primaryBtnText: {
    ...textPresets.body,
    color: colors.white,
    fontWeight: '700',
  },
  secondaryBtn: {
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 12,
  },
  secondaryBtnText: {
    ...textPresets.bodySmall,
    color: colors.accent,
    fontWeight: '700',
  },
  disabledBtn: { opacity: 0.45 },

  /* tip */
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surfaceSoft,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineSubtle,
    padding: 14,
    marginBottom: 12,
  },
  tipText: {
    ...textPresets.bodySmall,
    color: colors.textMuted,
    flex: 1,
    lineHeight: 18,
  },

  /* error */
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dangerMuted,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    padding: 10,
  },
  errorText: {
    ...textPresets.bodySmall,
    color: colors.danger,
    flex: 1,
  },
});
