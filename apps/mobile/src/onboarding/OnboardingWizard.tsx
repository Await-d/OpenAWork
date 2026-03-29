import { useCallback, useEffect, useState, type ReactNode } from 'react';
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
  | { type: 'host-health' }
  | { type: 'host-done' }
  | { type: 'client-scan' }
  | { type: 'cloud-login' };

type Mode = 'host' | 'client' | 'cloud';

interface HostConfig {
  provider: string;
  apiKey: string;
  workspace: string;
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
      return { current: 2, total: 5 };
    case 'host-workspace':
      return { current: 3, total: 5 };
    case 'host-health':
      return { current: 4, total: 5 };
    case 'host-done':
      return { current: 5, total: 5 };
    case 'client-scan':
      return { current: 2, total: 2 };
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
      return { type: 'host-health' };
    case 'host-health':
      return { type: 'host-done' };
    case 'host-done':
    case 'client-scan':
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
    case 'host-workspace':
      return { type: 'host-provider' };
    case 'host-health':
      return { type: 'host-workspace' };
    case 'host-done':
      return { type: 'host-health' };
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

function HostHealthStep({ step, onNext, onBack }: StepProps) {
  const [status, setStatus] = useState<'checking' | 'success'>('checking');

  useEffect(() => {
    const timer = setTimeout(() => {
      setStatus('success');
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <StepScreen step={step} onBack={onBack}>
      <View style={styles.centerContent}>
        <Text style={styles.heading}>健康检查</Text>
        {status === 'checking' ? (
          <>
            <ActivityIndicator color={ACCENT} size="large" />
            <Text style={styles.subheading}>检查中...</Text>
          </>
        ) : (
          <>
            <Text style={styles.successMark}>✓</Text>
            <Text style={styles.subheading}>Provider 与工作区配置校验通过。</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => onNext()}>
              <Text style={styles.primaryButtonText}>下一步</Text>
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
  const isDisabled = pairingCode.trim().length === 0;

  return (
    <StepScreen step={step} onBack={onBack}>
      <Text style={styles.heading}>连接已有 Host</Text>
      <Text style={styles.subheading}>移动端扫码能力后续接入，当前先粘贴 QR 中的配对 JSON。</Text>

      <Text style={styles.label}>Pairing JSON</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        numberOfLines={6}
        placeholder='{"hostUrl":"http://...","token":"..."}'
        placeholderTextColor={MUTED}
        style={[styles.input, styles.multilineInput]}
        value={pairingCode}
        onChangeText={setPairingCode}
      />

      <TouchableOpacity
        disabled={isDisabled}
        style={[styles.primaryButton, isDisabled && styles.disabledButton]}
        onPress={() => onNext()}
      >
        <Text style={styles.primaryButtonText}>连接 Host</Text>
      </TouchableOpacity>
    </StepScreen>
  );
}

function CloudLoginStep({ step, onNext, onBack }: StepProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const isDisabled = email.trim().length === 0 || password.trim().length === 0;

  return (
    <StepScreen step={step} onBack={onBack}>
      <Text style={styles.heading}>登录云端账号</Text>
      <Text style={styles.subheading}>这里先使用 mock 登录表单，后续再接真实鉴权。</Text>

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

      <TouchableOpacity
        disabled={isDisabled}
        style={[styles.primaryButton, isDisabled && styles.disabledButton]}
        onPress={() => onNext()}
      >
        <Text style={styles.primaryButtonText}>继续</Text>
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
      {step.type === 'host-health' ? <HostHealthStep {...stepProps} /> : null}
      {step.type === 'host-done' ? <HostDoneStep {...stepProps} /> : null}
      {step.type === 'client-scan' ? <ClientScanStep {...stepProps} /> : null}
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
});
