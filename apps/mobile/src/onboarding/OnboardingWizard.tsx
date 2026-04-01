import { useCallback, useEffect, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../store/auth';

function parseExpIn(expiresIn: string): number {
  const m = /^(\d+)(s|m|h)?$/.exec(expiresIn);
  if (!m) return 15 * 60 * 1000;
  const n = parseInt(m[1] ?? '15', 10);
  const u = m[2] ?? 'm';
  if (u === 's') return n * 1000;
  if (u === 'h') return n * 3600 * 1000;
  return n * 60 * 1000;
}
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type OnboardingStep =
  | { type: 'select-mode' }
  | { type: 'host-provider' }
  | { type: 'host-workspace' }
  | { type: 'host-gateway' }
  | { type: 'host-health' }
  | { type: 'host-login' }
  | { type: 'host-done' }
  | { type: 'client-scan' }
  | { type: 'client-login' }
  | { type: 'cloud-login' };

type Mode = 'host' | 'client' | 'cloud';

interface HostConfig {
  provider: string;
  apiKey: string;
  workspace: string;
  gatewayUrl: string;
}

interface OnboardingWizardProps {
  onComplete: () => void;
}

interface StepProps {
  step: OnboardingStep;
  hostConfig: HostConfig;
  onNext: (data?: Partial<HostConfig>) => void;
  onBack: () => void;
}

const HOST_PROVIDERS = ['OpenAI', 'Anthropic', 'Gemini', 'Ollama（本地）'];

function getProgress(step: OnboardingStep): { current: number; total: number } {
  switch (step.type) {
    case 'select-mode':
      return { current: 1, total: 1 };
    case 'host-provider':
      return { current: 2, total: 7 };
    case 'host-workspace':
      return { current: 3, total: 7 };
    case 'host-gateway':
      return { current: 4, total: 7 };
    case 'host-health':
      return { current: 5, total: 7 };
    case 'host-login':
      return { current: 6, total: 7 };
    case 'host-done':
      return { current: 7, total: 7 };
    case 'client-scan':
      return { current: 2, total: 3 };
    case 'client-login':
      return { current: 3, total: 3 };
    case 'cloud-login':
      return { current: 2, total: 2 };
  }
}

function getNextStep(step: OnboardingStep): OnboardingStep | 'complete' {
  switch (step.type) {
    case 'select-mode':
      return step;
    case 'host-provider':
      return { type: 'host-workspace' };
    case 'host-workspace':
      return { type: 'host-gateway' };
    case 'host-gateway':
      return { type: 'host-health' };
    case 'host-health':
      return { type: 'host-login' };
    case 'host-login':
      return { type: 'host-done' };
    case 'host-done':
      return 'complete';
    case 'client-scan':
      return { type: 'client-login' };
    case 'client-login':
    case 'cloud-login':
      return 'complete';
  }
}

function getPreviousStep(step: OnboardingStep): OnboardingStep {
  switch (step.type) {
    case 'host-provider':
    case 'client-scan':
    case 'cloud-login':
      return { type: 'select-mode' };
    case 'client-login':
      return { type: 'client-scan' };
    case 'host-workspace':
      return { type: 'host-provider' };
    case 'host-gateway':
      return { type: 'host-workspace' };
    case 'host-health':
      return { type: 'host-gateway' };
    case 'host-login':
      return { type: 'host-health' };
    case 'host-done':
      return { type: 'host-login' };
    case 'select-mode':
      return step;
  }
}

function ProgressHeader({ step, onBack }: { step: OnboardingStep; onBack?: () => void }) {
  const { current, total } = getProgress(step);
  const progressWidth: `${number}%` = `${Math.round((current / total) * 100)}%`;

  return (
    <View style={styles.progressWrapper}>
      <Text style={styles.progressText}>
        {current} / {total}
      </Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: progressWidth }]} />
      </View>
      {onBack ? (
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← 上一步</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function StepScreen({
  children,
  step,
  onBack,
}: {
  children: ReactNode;
  step: OnboardingStep;
  onBack?: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.stepContainer} keyboardShouldPersistTaps="handled">
      <ProgressHeader step={step} onBack={onBack} />
      {children}
    </ScrollView>
  );
}

function HostProviderStep({ step, hostConfig, onNext, onBack }: StepProps) {
  const [provider, setProvider] = useState(hostConfig.provider);
  const [apiKey, setApiKey] = useState(hostConfig.apiKey);
  const isDisabled = provider.trim().length === 0 || apiKey.trim().length === 0;

  return (
    <StepScreen step={step} onBack={onBack}>
      <Text style={styles.heading}>选择 Host Provider</Text>
      <Text style={styles.subheading}>先选择模型提供方，再录入 API Key。</Text>

      <View style={styles.optionList}>
        {HOST_PROVIDERS.map((item) => {
          const selected = item === provider;
          return (
            <TouchableOpacity
              key={item}
              style={[styles.optionCard, selected && styles.optionCardSelected]}
              onPress={() => setProvider(item)}
            >
              <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>
                {item}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>API Key</Text>
      <TextInput
        autoCapitalize="none"
        placeholder="sk-..."
        placeholderTextColor={MUTED}
        secureTextEntry
        style={styles.input}
        value={apiKey}
        onChangeText={setApiKey}
      />

      <TouchableOpacity
        disabled={isDisabled}
        style={[styles.primaryButton, isDisabled && styles.disabledButton]}
        onPress={() => onNext({ provider, apiKey })}
      >
        <Text style={styles.primaryButtonText}>下一步</Text>
      </TouchableOpacity>
    </StepScreen>
  );
}

function HostWorkspaceStep({ step, hostConfig, onNext, onBack }: StepProps) {
  const [workspace, setWorkspace] = useState(hostConfig.workspace);
  const isDisabled = workspace.trim().length === 0;

  return (
    <StepScreen step={step} onBack={onBack}>
      <Text style={styles.heading}>选择工作区目录</Text>
      <Text style={styles.subheading}>移动端先使用文本输入，后续再接入目录选择器。</Text>

      <Text style={styles.label}>Workspace 路径</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="/home/user/openawork"
        placeholderTextColor={MUTED}
        style={styles.input}
        value={workspace}
        onChangeText={setWorkspace}
      />

      <TouchableOpacity
        disabled={isDisabled}
        style={[styles.primaryButton, isDisabled && styles.disabledButton]}
        onPress={() => onNext({ workspace })}
      >
        <Text style={styles.primaryButtonText}>下一步</Text>
      </TouchableOpacity>
    </StepScreen>
  );
}

function HostGatewayStep({ step, onNext, onBack }: StepProps) {
  const [gatewayUrl, setGatewayUrlInput] = useState('http://');
  const isDisabled = gatewayUrl.trim().length < 8;

  return (
    <StepScreen step={step} onBack={onBack}>
      <Text style={styles.heading}>Gateway 地址</Text>
      <Text style={styles.subheading}>填写本机或局域网 Gateway 服务地址。</Text>

      <Text style={styles.label}>Gateway URL</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="http://192.168.1.100:3000"
        placeholderTextColor={MUTED}
        style={styles.input}
        value={gatewayUrl}
        onChangeText={setGatewayUrlInput}
      />

      <TouchableOpacity
        disabled={isDisabled}
        style={[styles.primaryButton, isDisabled && styles.disabledButton]}
        onPress={() => onNext({ gatewayUrl: gatewayUrl.trim().replace(/\/$/, '') })}
      >
        <Text style={styles.primaryButtonText}>下一步</Text>
      </TouchableOpacity>
    </StepScreen>
  );
}

function HostLoginStep({ step, hostConfig, onNext, onBack }: StepProps) {
  const { setTokens, setGatewayUrl } = useAuthStore();
  const gUrl = hostConfig.gatewayUrl;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDisabled = loading || !gUrl || email.trim().length === 0 || password.trim().length === 0;

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${gUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 401) throw new Error('邮箱或密码错误');
      if (!res.ok) throw new Error(`服务器错误 (${res.status})`);
      const data = (await res.json()) as {
        accessToken: string;
        refreshToken: string;
        expiresIn?: string;
      };
      await setGatewayUrl(gUrl);
      await setTokens(data.accessToken, data.refreshToken);
      const expiresMs = data.expiresIn ? parseExpIn(data.expiresIn) : 15 * 60 * 1000;
      await SecureStore.setItemAsync('openwork_token_expires_at', String(Date.now() + expiresMs));
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <StepScreen step={step} onBack={onBack}>
      <Text style={styles.heading}>登录账号</Text>
      <Text style={styles.subheading}>已连接到 {gUrl}，请输入账号密码完成登录。</Text>

      <Text style={styles.label}>邮箱</Text>
      <TextInput
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="user@example.com"
        placeholderTextColor={MUTED}
        style={styles.input}
        value={email}
        onChangeText={setEmail}
      />

      <Text style={styles.label}>密码</Text>
      <TextInput
        placeholder="••••••••"
        placeholderTextColor={MUTED}
        secureTextEntry
        style={styles.input}
        value={password}
        onChangeText={setPassword}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        disabled={isDisabled}
        style={[styles.primaryButton, isDisabled && styles.disabledButton]}
        onPress={() => void handleLogin()}
      >
        <Text style={styles.primaryButtonText}>{loading ? '登录中…' : '登录'}</Text>
      </TouchableOpacity>
    </StepScreen>
  );
}

function HostHealthStep({ step, hostConfig, onNext, onBack }: StepProps) {
  const [status, setStatus] = useState<'checking' | 'success' | 'error'>('checking');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const gatewayUrl =
      (hostConfig.gatewayUrl || hostConfig.workspace).trim().replace(/\/$/, '') ||
      'http://localhost:3000';
    void fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(5000) })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setStatus('success');
        } else {
          setStatus('error');
          setErrorMsg(`Gateway 返回 ${res.status}，请检查服务是否正常运行`);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : '无法连接 Gateway');
      });
    return () => {
      cancelled = true;
    };
  }, [hostConfig.workspace, hostConfig.gatewayUrl]);

  return (
    <StepScreen step={step} onBack={onBack}>
      <View style={styles.centerContent}>
        <Text style={styles.heading}>健康检查</Text>
        {status === 'checking' ? (
          <>
            <ActivityIndicator color={ACCENT} size="large" />
            <Text style={styles.subheading}>正在连接 Gateway…</Text>
          </>
        ) : status === 'success' ? (
          <>
            <Text style={styles.successMark}>✓</Text>
            <Text style={styles.subheading}>Gateway 连接正常，配置校验通过。</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => onNext()}>
              <Text style={styles.primaryButtonText}>下一步</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={[styles.successMark, { color: '#f87171' }]}>✗</Text>
            <Text style={styles.errorText}>{errorMsg}</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => {
                setStatus('checking');
                setErrorMsg(null);
              }}
            >
              <Text style={styles.primaryButtonText}>重试</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </StepScreen>
  );
}

function HostDoneStep({ step, onNext, onBack }: StepProps) {
  return (
    <StepScreen step={step} onBack={onBack}>
      <View style={styles.centerContent}>
        <Text style={styles.heading}>Host 配置完成</Text>
        <Text style={styles.subheading}>
          OpenAWork 已准备好作为 Host 运行，接下来可以直接进入主页。
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => onNext()}>
          <Text style={styles.primaryButtonText}>开始使用</Text>
        </TouchableOpacity>
      </View>
    </StepScreen>
  );
}

function ClientScanStep({ step, onNext, onBack }: StepProps) {
  const [pairingCode, setPairingCode] = useState('');
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDisabled = loading || pairingCode.trim().length === 0;
  const isConfirmDisabled = loading || !resolvedUrl || resolvedUrl.trim().length < 8;

  async function handleVerify() {
    setLoading(true);
    setError(null);
    setResolvedUrl(null);
    try {
      let parsed: { hostUrl?: string; token?: string };
      try {
        parsed = JSON.parse(pairingCode.trim()) as { hostUrl?: string; token?: string };
      } catch {
        throw new Error('JSON 格式错误，请检查粘贴内容');
      }
      const { hostUrl, token } = parsed;
      if (!hostUrl || !token) throw new Error('缺少 hostUrl 或 token 字段');
      const url = hostUrl.trim().replace(/\/$/, '');
      const res = await fetch(`${url}/pairing/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, deviceName: 'Mobile', platform: 'android' }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`配对验证失败 (${res.status})`);
      setResolvedUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!resolvedUrl) return;
    setLoading(true);
    try {
      const res = await fetch(`${resolvedUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`Gateway 健康检查失败 (${res.status})`);
      onNext({ workspace: resolvedUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : '地址不可达，请修改后重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <StepScreen step={step} onBack={onBack}>
      <Text style={styles.heading}>连接已有 Host</Text>
      <Text style={styles.subheading}>
        粘贴终端二维码对应的 JSON 配对码，验证后可修正地址再确认。
      </Text>

      <Text style={styles.label}>Pairing JSON</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        numberOfLines={4}
        placeholder='{"hostUrl":"http://192.168.1.100:3000","token":"abc123"}'
        placeholderTextColor={MUTED}
        style={[styles.input, styles.multilineInput]}
        value={pairingCode}
        onChangeText={(v) => {
          setPairingCode(v);
          setResolvedUrl(null);
          setError(null);
        }}
      />

      <TouchableOpacity
        disabled={isDisabled}
        style={[styles.primaryButton, isDisabled && styles.disabledButton]}
        onPress={() => void handleVerify()}
      >
        <Text style={styles.primaryButtonText}>
          {loading && !resolvedUrl ? '验证中…' : '验证配对码'}
        </Text>
      </TouchableOpacity>

      {resolvedUrl !== null ? (
        <View style={{ marginTop: 16, gap: 8 }}>
          <Text style={styles.label}>Gateway 地址（可修改）</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholderTextColor={MUTED}
            style={styles.input}
            value={resolvedUrl}
            onChangeText={setResolvedUrl}
          />
          <TouchableOpacity
            disabled={isConfirmDisabled}
            style={[styles.primaryButton, isConfirmDisabled && styles.disabledButton]}
            onPress={() => void handleConfirm()}
          >
            <Text style={styles.primaryButtonText}>
              {loading && resolvedUrl ? '确认中…' : '确认并继续'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </StepScreen>
  );
}

function ClientLoginStep({ step, hostConfig, onNext, onBack }: StepProps) {
  const { setTokens, setGatewayUrl } = useAuthStore();
  const gatewayUrl = hostConfig.workspace;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDisabled = loading || email.trim().length === 0 || password.trim().length === 0;

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${gatewayUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 401) throw new Error('邮箱或密码错误');
      if (!res.ok) throw new Error(`服务器错误 (${res.status})`);
      const data = (await res.json()) as {
        accessToken: string;
        refreshToken: string;
        expiresIn?: string;
      };
      await setGatewayUrl(gatewayUrl);
      await setTokens(data.accessToken, data.refreshToken);
      const expiresMs = data.expiresIn ? parseExpIn(data.expiresIn) : 15 * 60 * 1000;
      await SecureStore.setItemAsync('openwork_token_expires_at', String(Date.now() + expiresMs));
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <StepScreen step={step} onBack={onBack}>
      <Text style={styles.heading}>登录账号</Text>
      <Text style={styles.subheading}>已连接到 {gatewayUrl}，请输入账号密码完成登录。</Text>

      <Text style={styles.label}>邮箱</Text>
      <TextInput
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="user@example.com"
        placeholderTextColor={MUTED}
        style={styles.input}
        value={email}
        onChangeText={setEmail}
      />

      <Text style={styles.label}>密码</Text>
      <TextInput
        placeholder="••••••••"
        placeholderTextColor={MUTED}
        secureTextEntry
        style={styles.input}
        value={password}
        onChangeText={setPassword}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        disabled={isDisabled}
        style={[styles.primaryButton, isDisabled && styles.disabledButton]}
        onPress={() => void handleLogin()}
      >
        <Text style={styles.primaryButtonText}>{loading ? '登录中…' : '登录'}</Text>
      </TouchableOpacity>
    </StepScreen>
  );
}

function CloudLoginStep({ step, onNext, onBack }: StepProps) {
  const { setGatewayUrl, setTokens } = useAuthStore();
  const [gatewayUrl, setGatewayUrlInput] = useState('http://');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDisabled =
    loading ||
    gatewayUrl.trim().length < 8 ||
    email.trim().length === 0 ||
    password.trim().length === 0;

  async function handleLogin() {
    setLoading(true);
    setError(null);
    const url = gatewayUrl.trim().replace(/\/$/, '');
    try {
      const res = await fetch(`${url}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (res.status === 401) throw new Error('邮箱或密码错误');
      if (!res.ok) throw new Error(`服务器错误 (${res.status})`);
      const data = (await res.json()) as {
        accessToken: string;
        refreshToken: string;
        expiresIn?: string;
      };
      await setGatewayUrl(url);
      await setTokens(data.accessToken, data.refreshToken);
      const expiresMs = data.expiresIn ? parseExpIn(data.expiresIn) : 15 * 60 * 1000;
      await SecureStore.setItemAsync('openwork_token_expires_at', String(Date.now() + expiresMs));
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误，请检查 Gateway 是否运行');
    } finally {
      setLoading(false);
    }
  }

  return (
    <StepScreen step={step} onBack={onBack}>
      <Text style={styles.heading}>登录云端账号</Text>
      <Text style={styles.subheading}>填写 Gateway 地址与账号信息以连接云端服务。</Text>

      <Text style={styles.label}>Gateway 地址</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="http://192.168.1.100:3000"
        placeholderTextColor={MUTED}
        style={styles.input}
        value={gatewayUrl}
        onChangeText={setGatewayUrlInput}
      />

      <Text style={styles.label}>邮箱</Text>
      <TextInput
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="user@example.com"
        placeholderTextColor={MUTED}
        style={styles.input}
        value={email}
        onChangeText={setEmail}
      />

      <Text style={styles.label}>密码</Text>
      <TextInput
        placeholder="••••••••"
        placeholderTextColor={MUTED}
        secureTextEntry
        style={styles.input}
        value={password}
        onChangeText={setPassword}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        disabled={isDisabled}
        style={[styles.primaryButton, isDisabled && styles.disabledButton]}
        onPress={() => void handleLogin()}
      >
        <Text style={styles.primaryButtonText}>{loading ? '登录中…' : '登录'}</Text>
      </TouchableOpacity>
    </StepScreen>
  );
}

function SelectModeStep({ onSelect }: { onSelect: (mode: Mode) => void }) {
  return (
    <StepScreen step={{ type: 'select-mode' }}>
      <Text style={styles.heading}>欢迎使用 OpenAWork</Text>
      <Text style={styles.subheading}>请选择这台设备在你的工作流中承担的角色。</Text>

      <TouchableOpacity style={styles.modeCard} onPress={() => onSelect('host')}>
        <Text style={styles.modeTitle}>Host</Text>
        <Text style={styles.modeDescription}>本机承载 Provider 配置、工作区与健康检查。</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.modeCard} onPress={() => onSelect('client')}>
        <Text style={styles.modeTitle}>Client</Text>
        <Text style={styles.modeDescription}>连接已存在的 Host，继续你的会话与操作。</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.modeCard} onPress={() => onSelect('cloud')}>
        <Text style={styles.modeTitle}>Cloud</Text>
        <Text style={styles.modeDescription}>使用云端账号直接开始，无需本地 Host。</Text>
      </TouchableOpacity>
    </StepScreen>
  );
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<OnboardingStep>({ type: 'select-mode' });
  const [hostConfig, setHostConfig] = useState<HostConfig>({
    provider: '',
    apiKey: '',
    workspace: '',
    gatewayUrl: '',
  });

  const handleSelectMode = useCallback((mode: Mode) => {
    switch (mode) {
      case 'host':
        setStep({ type: 'host-provider' });
        break;
      case 'client':
        setStep({ type: 'client-scan' });
        break;
      case 'cloud':
        setStep({ type: 'cloud-login' });
        break;
    }
  }, []);

  const handleNext = useCallback(
    (data?: Partial<HostConfig>) => {
      if (data) {
        setHostConfig((current) => ({ ...current, ...data }));
      }

      const nextStep = getNextStep(step);
      if (nextStep === 'complete') {
        onComplete();
        return;
      }

      if (nextStep.type !== 'select-mode') {
        setStep(nextStep);
      }
    },
    [onComplete, step],
  );

  const handleBack = useCallback(() => {
    setStep((current) => getPreviousStep(current));
  }, []);

  const stepProps: StepProps = {
    step,
    hostConfig,
    onNext: handleNext,
    onBack: handleBack,
  };

  return (
    <View style={styles.container}>
      {step.type === 'select-mode' ? <SelectModeStep onSelect={handleSelectMode} /> : null}
      {step.type === 'host-provider' ? <HostProviderStep {...stepProps} /> : null}
      {step.type === 'host-workspace' ? <HostWorkspaceStep {...stepProps} /> : null}
      {step.type === 'host-gateway' ? <HostGatewayStep {...stepProps} /> : null}
      {step.type === 'host-health' ? <HostHealthStep {...stepProps} /> : null}
      {step.type === 'host-login' ? <HostLoginStep {...stepProps} /> : null}
      {step.type === 'host-done' ? <HostDoneStep {...stepProps} /> : null}
      {step.type === 'client-scan' ? <ClientScanStep {...stepProps} /> : null}
      {step.type === 'client-login' ? <ClientLoginStep {...stepProps} /> : null}
      {step.type === 'cloud-login' ? <CloudLoginStep {...stepProps} /> : null}
    </View>
  );
}

const BG = '#0f172a';
const SURFACE = '#1e293b';
const SURFACE_ALT = '#172554';
const ACCENT = '#6366f1';
const TEXT = '#f8fafc';
const MUTED = '#94a3b8';
const BORDER = '#334155';
const SUCCESS = '#22c55e';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  stepContainer: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 28,
    gap: 14,
  },
  progressWrapper: {
    gap: 8,
    marginBottom: 12,
  },
  progressText: {
    color: MUTED,
    fontSize: 12,
    textAlign: 'right',
  },
  progressTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: BORDER,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 999,
    backgroundColor: ACCENT,
  },
  backButton: {
    alignSelf: 'flex-start',
  },
  backButtonText: {
    color: MUTED,
    fontSize: 14,
    fontWeight: '500',
  },
  heading: {
    color: TEXT,
    fontSize: 24,
    fontWeight: '700',
  },
  subheading: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
  },
  modeCard: {
    backgroundColor: SURFACE,
    borderColor: BORDER,
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 6,
  },
  modeTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: '700',
  },
  modeDescription: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
  },
  optionList: {
    gap: 10,
  },
  optionCard: {
    backgroundColor: SURFACE,
    borderColor: BORDER,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  optionCardSelected: {
    backgroundColor: SURFACE_ALT,
    borderColor: ACCENT,
  },
  optionTitle: {
    color: TEXT,
    fontSize: 15,
    fontWeight: '600',
  },
  optionTitleSelected: {
    color: '#c7d2fe',
  },
  label: {
    color: MUTED,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 6,
  },
  input: {
    backgroundColor: SURFACE,
    borderColor: BORDER,
    borderRadius: 12,
    borderWidth: 1,
    color: TEXT,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  multilineInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderRadius: 12,
    marginTop: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  disabledButton: {
    opacity: 0.45,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    minHeight: 320,
  },
  successMark: {
    color: SUCCESS,
    fontSize: 52,
    fontWeight: '800',
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    lineHeight: 18,
  },
});
