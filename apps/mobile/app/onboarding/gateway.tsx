import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { isGatewayHealthy, login, loginWithPairingToken } from '@openAwork/web-client';
import {
  normalizeMobileGatewayUrl,
  useAuthStore,
  DEFAULT_MOBILE_GATEWAY_URL,
} from '../../src/store/auth';
import { colors } from '../../src/theme/colors';
import { radii } from '../../src/theme/radii';
import { textPresets } from '../../src/theme/typography';

function parseExpIn(expiresIn: string): number {
  const m = /^(\d+)(s|m|h)?$/.exec(expiresIn);
  if (!m) return 15 * 60 * 1000;
  const n = parseInt(m[1] ?? '15', 10);
  const u = m[2] ?? 'm';
  if (u === 's') return n * 1000;
  if (u === 'h') return n * 3600 * 1000;
  return n * 60 * 1000;
}

type LoginMethod = 'pairing' | 'password';

/** 连接已有网关 — 输入 URL → 健康检查 → 配对码或账号密码登录 */
export default function GatewayConnectScreen() {
  const { setGatewayUrl, setTokens } = useAuthStore();

  const [step, setStep] = useState<'url' | 'health' | 'login'>('url');
  const [gatewayUrl, setGatewayUrlInput] = useState(DEFAULT_MOBILE_GATEWAY_URL);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('pairing');

  // 配对码
  const [pairingCode, setPairingCode] = useState('');
  // 账号密码
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [verifiedUrl, setVerifiedUrl] = useState<string>('');

  async function handleHealthCheck() {
    if (!gatewayUrl.trim()) {
      Alert.alert('错误', '请输入 Gateway 地址');
      return;
    }
    setLoading(true);
    setError(null);
    setHealthStatus('idle');
    let url: string;
    try {
      url = normalizeMobileGatewayUrl(gatewayUrl);
    } catch (err) {
      setHealthStatus('error');
      setError(err instanceof Error ? err.message : '网关地址格式不正确');
      setLoading(false);
      return;
    }
    try {
      const ok = await isGatewayHealthy(url, { timeoutMs: 5000 });
      if (ok) {
        setHealthStatus('ok');
        setVerifiedUrl(url);
        setStep('login');
      } else {
        setHealthStatus('error');
        setError(`无法连接到 ${url}，请检查网关是否已启动`);
      }
    } catch (err) {
      setHealthStatus('error');
      const msg = err instanceof Error ? err.message : '无法连接到网关';
      setError(`${msg}（${url}）`);
    } finally {
      setLoading(false);
    }
  }

  async function handlePairingLogin() {
    const raw = pairingCode.trim();
    if (!raw) {
      Alert.alert('错误', '请输入配对码');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let parsed: { token?: string; hostUrl?: string };
      try {
        parsed = JSON.parse(raw) as { token?: string; hostUrl?: string };
      } catch {
        // 支持直接粘贴 token 字符串
        parsed = { token: raw };
      }
      const token = parsed.token;
      if (!token) throw new Error('缺少 token，请粘贴配对码');

      const url = normalizeMobileGatewayUrl(parsed.hostUrl ?? gatewayUrl);
      try {
        const data = await loginWithPairingToken(url, token, {
          deviceName: 'Mobile',
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
        });
        await setGatewayUrl(url);
        await setTokens(data.accessToken, data.refreshToken);
        const expiresMs = data.expiresIn ? parseExpIn(data.expiresIn) : 15 * 60 * 1000;
        await SecureStore.setItemAsync('openwork_token_expires_at', String(Date.now() + expiresMs));
        await AsyncStorage.setItem('onboarded', 'true');
        router.replace('/sessions');
      } catch (apiErr) {
        const msg = apiErr instanceof Error ? apiErr.message : '配对登录失败';
        throw new Error(`${msg}（${url}）`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '配对登录失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordLogin() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('错误', '请输入邮箱和密码');
      return;
    }
    setLoading(true);
    setError(null);
    let url: string;
    try {
      url = normalizeMobileGatewayUrl(gatewayUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : '网关地址格式不正确');
      setLoading(false);
      return;
    }
    try {
      const data = await login(url, email.trim(), password, 8000);
      await setGatewayUrl(url);
      await setTokens(data.accessToken, data.refreshToken);
      const expiresMs = data.expiresIn ? parseExpIn(data.expiresIn) : 15 * 60 * 1000;
      await SecureStore.setItemAsync('openwork_token_expires_at', String(Date.now() + expiresMs));
      await AsyncStorage.setItem('onboarded', 'true');
      router.replace('/sessions');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '登录失败';
      setError(`${msg}（${url}）`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={18} color={colors.textDefault} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>连接已有网关</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* 步骤条 */}
      <View style={styles.stepRow}>
        <StepBadge
          index={1}
          label="地址"
          active={step === 'url'}
          done={step === 'health' || step === 'login'}
        />
        <View style={styles.stepArrow} />
        <StepBadge index={2} label="检查" active={step === 'health'} done={step === 'login'} />
        <View style={styles.stepArrow} />
        <StepBadge index={3} label="登录" active={step === 'login'} done={false} />
      </View>

      {/* Step 1: Gateway URL */}
      {step === 'url' && (
        <>
          <Text style={styles.sectionTitle}>Gateway 地址</Text>
          <Text style={styles.hint}>填写局域网或远程 Gateway 服务地址。</Text>

          <Text style={styles.fieldLabel}>Gateway URL</Text>
          <TextInput
            style={styles.input}
            placeholder="http://192.168.1.100:3000"
            placeholderTextColor={colors.textSubtle}
            value={gatewayUrl}
            onChangeText={setGatewayUrlInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <TouchableOpacity
            style={[styles.primaryBtn, loading && styles.disabledBtn]}
            onPress={() => void handleHealthCheck()}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <>
                <Ionicons name="arrow-forward" size={16} color={colors.white} />
                <Text style={styles.primaryBtnText}>测试连接</Text>
              </>
            )}
          </TouchableOpacity>
        </>
      )}

      {/* Step 2: Health Check */}
      {step === 'health' && (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.hint}>正在检查 Gateway 连接…</Text>
        </View>
      )}

      {/* Step 3: Login */}
      {step === 'login' && (
        <>
          {/* 健康检查结果 */}
          <View style={[styles.healthCard, healthStatus === 'ok' ? styles.healthOk : {}]}>
            <Ionicons name="shield-checkmark" size={18} color={colors.success} />
            <View style={styles.healthTextWrap}>
              <Text style={styles.healthTitle}>连接正常</Text>
              <Text style={styles.healthMeta}>{verifiedUrl}</Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setStep('url');
                setHealthStatus('idle');
                setVerifiedUrl('');
              }}
            >
              <Text style={styles.healthAction}>更换</Text>
            </TouchableOpacity>
          </View>

          {/* 登录方式切换 */}
          <View style={styles.methodRow}>
            <TouchableOpacity
              style={[styles.methodChip, loginMethod === 'pairing' && styles.methodChipActive]}
              onPress={() => {
                setLoginMethod('pairing');
                setError(null);
              }}
            >
              <Ionicons
                name="keypad-outline"
                size={14}
                color={loginMethod === 'pairing' ? colors.accent : colors.textMuted}
              />
              <Text
                style={[styles.methodText, loginMethod === 'pairing' && styles.methodTextActive]}
              >
                配对码
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.methodChip, loginMethod === 'password' && styles.methodChipActive]}
              onPress={() => {
                setLoginMethod('password');
                setError(null);
              }}
            >
              <Ionicons
                name="lock-closed-outline"
                size={14}
                color={loginMethod === 'password' ? colors.accent : colors.textMuted}
              />
              <Text
                style={[styles.methodText, loginMethod === 'password' && styles.methodTextActive]}
              >
                账号密码
              </Text>
            </TouchableOpacity>
          </View>

          {/* 配对码登录 */}
          {loginMethod === 'pairing' && (
            <>
              <Text style={styles.fieldLabel}>配对码</Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                placeholder="粘贴配对 JSON 或纯 token 字符串"
                placeholderTextColor={colors.textSubtle}
                value={pairingCode}
                onChangeText={(v) => {
                  setPairingCode(v);
                  setError(null);
                }}
                multiline
                numberOfLines={3}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.disabledBtn]}
                onPress={() => void handlePairingLogin()}
                disabled={loading}
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
            </>
          )}

          {/* 账号密码登录 */}
          {loginMethod === 'password' && (
            <>
              <Text style={styles.fieldLabel}>邮箱</Text>
              <TextInput
                style={styles.input}
                placeholder="user@example.com"
                placeholderTextColor={colors.textSubtle}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <Text style={styles.fieldLabel}>密码</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor={colors.textSubtle}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.disabledBtn]}
                onPress={() => void handlePasswordLogin()}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <>
                    <Ionicons name="log-in-outline" size={16} color={colors.white} />
                    <Text style={styles.primaryBtnText}>登录并继续</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </>
      )}

      {/* 错误提示 */}
      {error ? (
        <View style={styles.errorBar}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function StepBadge({
  index,
  label,
  active,
  done,
}: {
  index: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <View style={styles.stepItem}>
      <View
        style={[styles.stepBadge, active && styles.stepBadgeActive, done && styles.stepBadgeDone]}
      >
        <Text style={[styles.stepBadgeText, (active || done) && styles.stepBadgeTextActive]}>
          {done ? '✓' : index}
        </Text>
      </View>
      <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { padding: 16, paddingBottom: 100 },

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

  /* step bar */
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeActive: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accent,
  },
  stepBadgeDone: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  stepBadgeText: {
    ...textPresets.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  stepBadgeTextActive: {
    color: colors.accent,
  },
  stepLabel: {
    ...textPresets.bodySmall,
    color: colors.textMuted,
  },
  stepLabelActive: {
    color: colors.accent,
    fontWeight: '600',
  },
  stepArrow: {
    width: 14,
    height: 1,
    backgroundColor: colors.lineDefault,
    marginHorizontal: 4,
  },

  /* form */
  sectionTitle: {
    ...textPresets.subheading,
    color: colors.textStrong,
    marginBottom: 4,
  },
  hint: {
    ...textPresets.bodySmall,
    color: colors.textMuted,
    marginBottom: 16,
  },
  fieldLabel: {
    ...textPresets.label,
    color: colors.textMuted,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 14,
    color: colors.textStrong,
    fontSize: 15,
    marginBottom: 12,
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },

  /* health card */
  healthCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 14,
    marginBottom: 16,
  },
  healthOk: {
    backgroundColor: colors.successMuted,
    borderColor: colors.successBorder,
  },
  healthTextWrap: {
    flex: 1,
    gap: 2,
  },
  healthTitle: {
    ...textPresets.body,
    color: colors.textStrong,
    fontWeight: '700',
  },
  healthMeta: {
    ...textPresets.cardDescription,
    color: colors.textMuted,
  },
  healthAction: {
    ...textPresets.label,
    color: colors.accent,
    fontWeight: '700',
  },

  /* login method */
  methodRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  methodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  methodChipActive: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accentBorder,
  },
  methodText: {
    ...textPresets.bodySmall,
    color: colors.textMuted,
  },
  methodTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },

  /* buttons */
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    marginBottom: 12,
  },
  primaryBtnText: {
    ...textPresets.body,
    color: colors.white,
    fontWeight: '700',
  },
  disabledBtn: { opacity: 0.45 },

  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    height: 200,
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
