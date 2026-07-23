import { useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { login as apiLogin } from '@openAwork/web-client';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  DEFAULT_MOBILE_GATEWAY_URL,
  normalizeMobileGatewayUrl,
  useAuthStore,
} from '../src/store/auth';
import { Screen } from '../src/components/Screen';
import { PrimaryButton } from '../src/components/ui';
import { useKeyboardHeight } from '../src/hooks/useKeyboardHeight';
import { resolveComposerBottomInset } from '../src/layout/keyboard';
import { colors } from '../src/theme/colors';
import { radii } from '../src/theme/radii';
import { textPresets } from '../src/theme/typography';

/** S11: 账号登录 — 极简风格 */
export default function LoginScreen() {
  const [gatewayUrl] = useState(DEFAULT_MOBILE_GATEWAY_URL);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { setTokens, setGatewayUrl: saveGatewayUrl } = useAuthStore();
  const keyboardHeight = useKeyboardHeight();
  const formBottomInset = resolveComposerBottomInset({
    keyboardHeight,
    safeBottom: 0,
    gap: 24,
    platform: Platform.OS,
  });

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('错误', '请输入邮箱和密码');
      return;
    }
    setLoading(true);
    try {
      const url = normalizeMobileGatewayUrl(gatewayUrl);
      const data = await apiLogin(url, email, password);
      await saveGatewayUrl(url);
      await setTokens(data.accessToken, data.refreshToken);
      await AsyncStorage.setItem('onboarded', 'true');
      router.replace('/home');
    } catch (e) {
      const isTimeout = e instanceof DOMException && e.name === 'TimeoutError';
      Alert.alert(
        isTimeout ? '登录超时' : '登录失败',
        isTimeout
          ? '网关未响应，请确认服务是否已启动。'
          : e instanceof Error
            ? e.message
            : '未知错误',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: formBottomInset }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* 氛围光装饰 */}
        <View style={styles.glowAccent} />
        <View style={styles.glowAux} />

        {/* 标题栏 */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={18} color={colors.textDefault} />
          </TouchableOpacity>
          <View style={styles.brandRow}>
            <View style={styles.brandIcon}>
              <Ionicons name="sparkles" size={20} color={colors.white} />
            </View>
            <Text style={styles.brandName}>OPENAWORK</Text>
          </View>
          <View style={styles.secureBadge}>
            <Ionicons name="lock-closed-outline" size={12} color={colors.accent} />
            <Text style={styles.secureText}>安全连接</Text>
          </View>
        </View>

        <Text style={styles.welcomeTitle}>欢迎回来</Text>
        <Text style={styles.welcomeSubtitle}>登录后继续你的会话、任务与工作区。</Text>

        {/* 当前网关 */}
        <View style={styles.gatewayCard}>
          <View style={styles.gatewayIconWrap}>
            <Ionicons name="globe-outline" size={16} color={colors.aux} />
          </View>
          <View style={styles.gatewayTextWrap}>
            <Text style={styles.gatewayLabel}>当前网关</Text>
            <Text style={styles.gatewayUrl} numberOfLines={1}>
              {gatewayUrl}
            </Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/connection')}>
            <Text style={styles.gatewayChange}>更换</Text>
          </TouchableOpacity>
        </View>

        {/* 登录表单 */}
        <Text style={styles.formLabel}>账号登录</Text>
        <View style={styles.credentialCard}>
          <View style={styles.inputRow}>
            <Ionicons name="mail-outline" size={18} color={colors.textSubtle} />
            <TextInput
              style={styles.input}
              placeholder="邮箱"
              placeholderTextColor={colors.textSubtle}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.inputRow}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textSubtle} />
            <TextInput
              style={styles.input}
              placeholder="密码"
              placeholderTextColor={colors.textSubtle}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>
        </View>

        {/* 辅助说明 */}
        <View style={styles.assistRow}>
          <Ionicons name="checkmark-circle" size={14} color={colors.success} />
          <Text style={styles.assistText}>网关状态已验证，可以安全登录。</Text>
        </View>

        <PrimaryButton
          label="登录并继续"
          loading={loading}
          onPress={() => void handleLogin()}
          icon={<Ionicons name="log-in-outline" size={18} color={colors.white} />}
          style={styles.loginBtn}
        />

        {/* 配对入口 */}
        <View style={styles.pairRow}>
          <Text style={styles.pairHint}>需要配对？</Text>
          <TouchableOpacity onPress={() => router.push('/onboarding')}>
            <Text style={styles.pairLink}>返回连接页扫码</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
  },
  content: {
    padding: 16,
    paddingTop: 8,
    flexGrow: 1,
  },

  /* glow decorations */
  glowAccent: {
    position: 'absolute',
    top: -60,
    right: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.accentMuted,
    opacity: 0.6,
  },
  glowAux: {
    position: 'absolute',
    bottom: 100,
    left: -60,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: colors.auxMuted,
    opacity: 0.5,
  },

  /* header */
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 36,
    marginBottom: 24,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    ...textPresets.caption,
    color: colors.accent,
    letterSpacing: 1.2,
    fontWeight: '700',
  },
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accentMuted,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  secureText: {
    ...textPresets.caption,
    color: colors.accent,
    fontWeight: '600',
  },

  /* welcome */
  welcomeTitle: {
    ...textPresets.title,
    color: colors.textStrong,
    fontSize: 28,
    marginBottom: 6,
  },
  welcomeSubtitle: {
    ...textPresets.body,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: 24,
  },

  /* gateway card */
  gatewayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 52,
    backgroundColor: colors.surfaceGlass,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineSubtle,
    paddingHorizontal: 10,
    marginBottom: 24,
  },
  gatewayIconWrap: {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    backgroundColor: colors.auxMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gatewayTextWrap: {
    flex: 1,
    gap: 1,
  },
  gatewayLabel: {
    ...textPresets.caption,
    color: colors.textMuted,
  },
  gatewayUrl: {
    ...textPresets.bodySmall,
    color: colors.textStrong,
    fontWeight: '600',
  },
  gatewayChange: {
    ...textPresets.label,
    color: colors.accent,
  },

  /* form */
  formLabel: {
    ...textPresets.label,
    color: colors.textDefault,
    marginBottom: 8,
  },
  credentialCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg + 2,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingVertical: 2,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 52,
  },
  input: {
    flex: 1,
    ...textPresets.body,
    color: colors.textStrong,
    padding: 0,
  },
  divider: {
    height: 1,
    backgroundColor: colors.lineSubtle,
  },

  /* assist */
  assistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 26,
    marginBottom: 24,
  },
  assistText: {
    ...textPresets.label,
    color: colors.textMuted,
  },

  /* login button */
  loginBtn: {
    marginBottom: 24,
    minHeight: 52,
    borderRadius: radii.lg + 2,
    shadowColor: colors.accent,
    shadowOpacity: 0.3,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },

  /* pair link */
  pairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pairHint: {
    ...textPresets.label,
    color: colors.textMuted,
  },
  pairLink: {
    ...textPresets.label,
    color: colors.accent,
  },
});
