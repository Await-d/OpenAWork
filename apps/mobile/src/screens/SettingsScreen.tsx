import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/auth';
import { createSettingsClient } from '@openAwork/web-client';
import {
  IMAGE_GENERATION_SIZE_PRESET_GROUPS,
  resolveImageGenerationSizePresetId,
  validateImageGenerationSize,
} from '@openAwork/shared';
import { useOtaUpdate } from '../hooks/useOtaUpdate';
import { DEFAULT_MOBILE_GATEWAY_URL } from '../store/auth';
import ExpoPersistenceAdapter, {
  buildMobileProviderConfig,
  DEFAULT_MOBILE_IMAGE_GENERATION_DEFAULTS,
  loadImageGenerationDefaults,
  loadMcpServers,
  restoreMobileProviderSelection,
  saveImageGenerationDefaults,
  type MobileImageGenerationDefaults,
  type MobileMcpServer,
} from '../store/providerPersistence';
import { Screen } from '../components/Screen';
import { Chip, PageHeader, PrimaryButton, SurfaceCard } from '../components/ui';
import { useBottomNavContentInset } from '../layout/use-bottom-nav-inset';
import { colors } from '../theme/colors';
import { radii } from '../theme/radii';
import { textPresets } from '../theme/typography';

const PRESET_PROVIDERS = [
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'qwen', name: 'Qwen (阿里云)' },
  { id: 'zhipu', name: '智谱 AI' },
  { id: 'custom', name: 'Custom' },
] as const;

const IMAGE_PROVIDER_OPTIONS = PRESET_PROVIDERS.filter((provider) => provider.id === 'openai');

type MobileProviderOption = (typeof PRESET_PROVIDERS)[number];

const persistence = new ExpoPersistenceAdapter();

interface SettingsScreenProps {
  onLogout?: () => void;
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function LinkRow({
  icon,
  title,
  subtitle,
  onPress,
  trailing,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  trailing?: string;
}) {
  return (
    <TouchableOpacity style={styles.linkRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.linkIcon}>
        <Ionicons name={icon} size={16} color={colors.accent} />
      </View>
      <View style={styles.linkText}>
        <Text style={styles.linkTitle}>{title}</Text>
        {subtitle ? <Text style={styles.linkSubtitle}>{subtitle}</Text> : null}
      </View>
      {trailing ? <Text style={styles.linkTrailing}>{trailing}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
    </TouchableOpacity>
  );
}

export function SettingsScreen({ onLogout }: SettingsScreenProps) {
  const router = useRouter();
  const { accessToken, gatewayUrl, setGatewayUrl, customBaseUrl, setCustomBaseUrl, logout } =
    useAuthStore();
  const { state: otaState, checkAndApply, applyUpdate } = useOtaUpdate();
  const [gatewayInput, setGatewayInput] = useState(gatewayUrl);
  const [customBaseUrlInput, setCustomBaseUrlInput] = useState(customBaseUrl);
  const [selectedProvider, setSelectedProvider] = useState<MobileProviderOption>(
    PRESET_PROVIDERS[0],
  );
  const [apiKey, setApiKey] = useState('');
  const [selectedImageProvider, setSelectedImageProvider] = useState<MobileProviderOption>(
    IMAGE_PROVIDER_OPTIONS[0] ?? PRESET_PROVIDERS[0],
  );
  const [imageDefaults, setImageDefaults] = useState<MobileImageGenerationDefaults>(
    DEFAULT_MOBILE_IMAGE_GENERATION_DEFAULTS,
  );
  const [mcpServers, setMcpServers] = useState<MobileMcpServer[]>([]);
  const bottomInset = useBottomNavContentInset();

  useEffect(() => {
    setGatewayInput(gatewayUrl);
  }, [gatewayUrl]);

  useEffect(() => {
    setCustomBaseUrlInput(customBaseUrl);
  }, [customBaseUrl]);

  useEffect(() => {
    let cancelled = false;

    const loadPersistedSettings = async () => {
      const config = await persistence.loadProviderConfig();
      const selectedProviderId = config?.active.chat.providerId ?? PRESET_PROVIDERS[0].id;
      const storedApiKey = await persistence.loadApiKey(selectedProviderId);
      const restored = restoreMobileProviderSelection(config, storedApiKey);
      const storedMcpServers = await loadMcpServers();
      const storedImageDefaults = await loadImageGenerationDefaults();

      if (cancelled) return;

      setSelectedProvider(
        PRESET_PROVIDERS.find((provider) => provider.id === restored.selectedProviderId) ??
          PRESET_PROVIDERS[0],
      );
      setSelectedImageProvider(
        IMAGE_PROVIDER_OPTIONS.find((provider) => provider.id === restored.imageProviderId) ??
          IMAGE_PROVIDER_OPTIONS[0] ??
          PRESET_PROVIDERS[0],
      );
      setApiKey(restored.apiKey);
      setImageDefaults(storedImageDefaults);
      setMcpServers(storedMcpServers);
    };

    void loadPersistedSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadApiKeyForProvider = async () => {
      const storedApiKey = await persistence.loadApiKey(selectedProvider.id);
      if (!cancelled) {
        setApiKey(storedApiKey ?? '');
      }
    };

    void loadApiKeyForProvider();

    return () => {
      cancelled = true;
    };
  }, [selectedProvider.id]);

  const saveGateway = async () => {
    await setGatewayUrl(gatewayInput.trim());
    Alert.alert('已保存', '网关地址已更新');
  };

  const saveCustomBaseUrlFn = async () => {
    await setCustomBaseUrl(customBaseUrlInput.trim());
    Alert.alert('已保存', '自定义域名已更新');
  };

  const saveProvider = async () => {
    const sizeValidation = validateImageGenerationSize(imageDefaults.size);
    if (!sizeValidation.valid) {
      Alert.alert('图片尺寸无效', sizeValidation.message ?? '请输入合法的自定义尺寸');
      return;
    }

    const apiKeysByProvider = Object.fromEntries(
      await Promise.all(
        PRESET_PROVIDERS.map(async (provider) => {
          const stored =
            provider.id === selectedProvider.id
              ? apiKey.trim()
              : ((await persistence.loadApiKey(provider.id)) ?? '').trim();
          return [provider.id, stored] as const;
        }),
      ),
    );
    const config = buildMobileProviderConfig({
      apiKeysByProvider,
      imageProviderId: selectedImageProvider.id,
      selectedProviderId: selectedProvider.id,
    });
    await persistence.saveProviderConfig(config.providers, config.active);
    await persistence.saveApiKey(selectedProvider.id, apiKey.trim());
    await saveImageGenerationDefaults(imageDefaults);

    let syncedToGateway = false;
    if (accessToken && gatewayUrl) {
      try {
        await createSettingsClient(gatewayUrl).putProviders(accessToken, {
          providers: config.providers,
          activeSelection: config.active,
          imageGenerationDefaults: imageDefaults,
        });
        syncedToGateway = true;
      } catch {
        syncedToGateway = false;
      }
    }

    Alert.alert(
      '已保存',
      syncedToGateway
        ? `${selectedProvider.name} 与图片模式配置已同步到网关`
        : `${selectedProvider.name} 与图片模式配置已保存到本机`,
    );
  };

  const handleLogout = async () => {
    await logout();
    onLogout?.();
  };

  const enabledMcp = mcpServers.filter((s) => s.enabled).length;

  return (
    <Screen>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
      >
        <PageHeader
          title="设置"
          subtitle="网关、模型、桌面能力与应用配置。"
          style={styles.pageHeader}
        />

        {/* Account card */}
        <SurfaceCard variant="default" radius="lg" style={styles.accountCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>A</Text>
          </View>
          <View style={styles.accountText}>
            <Text style={styles.accountTitle}>{accessToken ? '已登录工作台' : '未登录'}</Text>
            <Text style={styles.accountMeta} numberOfLines={1}>
              {gatewayUrl || DEFAULT_MOBILE_GATEWAY_URL}
            </Text>
          </View>
          <View style={[styles.onlineBadge, !accessToken && styles.offlineBadge]}>
            <Text style={[styles.onlineText, !accessToken && styles.offlineText]}>
              {accessToken ? '在线' : '离线'}
            </Text>
          </View>
        </SurfaceCard>

        {/* Connection */}
        <SectionTitle title="连接与网关" />
        <SurfaceCard variant="default" radius="lg" padding={0} style={styles.groupCard}>
          <View style={styles.editBlock}>
            <Text style={styles.fieldLabel}>网关地址</Text>
            <TextInput
              style={styles.input}
              value={gatewayInput}
              onChangeText={setGatewayInput}
              placeholder={DEFAULT_MOBILE_GATEWAY_URL}
              placeholderTextColor={colors.textSubtle}
              autoCapitalize="none"
              keyboardType="url"
            />
            <TouchableOpacity style={styles.secondaryAction} onPress={() => void saveGateway()}>
              <Text style={styles.secondaryActionText}>保存网关</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.divider} />
          <View style={styles.editBlock}>
            <Text style={styles.fieldLabel}>自定义域名</Text>
            <TextInput
              style={styles.input}
              value={customBaseUrlInput}
              onChangeText={setCustomBaseUrlInput}
              placeholder="https://openwork.app"
              placeholderTextColor={colors.textSubtle}
              autoCapitalize="none"
              keyboardType="url"
            />
            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={() => void saveCustomBaseUrlFn()}
            >
              <Text style={styles.secondaryActionText}>保存域名</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.divider} />
          <LinkRow
            icon="wifi-outline"
            title="网络与重连"
            subtitle="诊断连接并手动重试"
            onPress={() => router.push('/network')}
          />
        </SurfaceCard>

        {/* Model & API */}
        <SectionTitle title="模型与 API" />
        <SurfaceCard variant="default" radius="lg" style={styles.groupCardPad}>
          <View style={styles.chipRow}>
            {PRESET_PROVIDERS.map((p) => (
              <Chip
                key={p.id}
                label={p.name}
                tone="accent"
                selected={selectedProvider.id === p.id}
                onPress={() => setSelectedProvider(p)}
              />
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder={`${selectedProvider.name} API 密钥`}
            placeholderTextColor={colors.textSubtle}
            secureTextEntry
            autoCapitalize="none"
          />
          <PrimaryButton
            label="保存模型配置"
            onPress={() => {
              void saveProvider();
            }}
          />
        </SurfaceCard>

        {/* Image defaults */}
        <SectionTitle title="图片生成默认" />
        <SurfaceCard variant="default" radius="lg" style={styles.groupCardPad}>
          <View style={styles.chipRow}>
            {IMAGE_PROVIDER_OPTIONS.map((provider) => (
              <Chip
                key={provider.id}
                label={provider.name}
                tone="contrast"
                selected={selectedImageProvider.id === provider.id}
                onPress={() => setSelectedImageProvider(provider)}
              />
            ))}
          </View>
          <Text style={styles.helperText}>模型：GPT Image 2</Text>
          {IMAGE_GENERATION_SIZE_PRESET_GROUPS.map((group) => (
            <View key={group.tier} style={styles.optionGroup}>
              <Text style={styles.fieldLabel}>
                {group.label} · {group.description}
              </Text>
              <View style={styles.chipRow}>
                {group.presets.map((preset) => (
                  <Chip
                    key={preset.id}
                    label={preset.label}
                    tone="contrast"
                    selected={resolveImageGenerationSizePresetId(imageDefaults.size) === preset.id}
                    onPress={() => setImageDefaults((prev) => ({ ...prev, size: preset.size }))}
                  />
                ))}
              </View>
            </View>
          ))}
          <View style={styles.optionGroup}>
            <Text style={styles.fieldLabel}>质量</Text>
            <View style={styles.chipRow}>
              {(['low', 'medium', 'high'] as const).map((quality) => (
                <Chip
                  key={quality}
                  label={quality}
                  tone="contrast"
                  selected={imageDefaults.quality === quality}
                  onPress={() => setImageDefaults((prev) => ({ ...prev, quality }))}
                />
              ))}
            </View>
          </View>
          <View style={styles.optionGroup}>
            <Text style={styles.fieldLabel}>格式</Text>
            <View style={styles.chipRow}>
              {(['png', 'jpeg', 'webp'] as const).map((outputFormat) => (
                <Chip
                  key={outputFormat}
                  label={outputFormat.toUpperCase()}
                  tone="contrast"
                  selected={imageDefaults.outputFormat === outputFormat}
                  onPress={() => setImageDefaults((prev) => ({ ...prev, outputFormat }))}
                />
              ))}
            </View>
          </View>
          <View style={styles.optionGroup}>
            <Text style={styles.fieldLabel}>背景</Text>
            <View style={styles.chipRow}>
              {(['auto', 'opaque'] as const).map((background) => (
                <Chip
                  key={background}
                  label={background === 'auto' ? '自动' : '不透明'}
                  tone="contrast"
                  selected={imageDefaults.background === background}
                  onPress={() => setImageDefaults((prev) => ({ ...prev, background }))}
                />
              ))}
            </View>
          </View>
          <TextInput
            style={styles.input}
            value={imageDefaults.size}
            onChangeText={(size) => setImageDefaults((prev) => ({ ...prev, size }))}
            placeholder="自定义尺寸，例如 2560x1440"
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
          />
          <Text
            style={[
              styles.helperText,
              !validateImageGenerationSize(imageDefaults.size).valid && styles.helperDanger,
            ]}
          >
            {validateImageGenerationSize(imageDefaults.size).valid
              ? '合法范围：最长边 ≤ 3840、宽高为 16 的倍数、比例不超过 3:1。'
              : validateImageGenerationSize(imageDefaults.size).message}
          </Text>
        </SurfaceCard>

        {/* Tools */}
        <SectionTitle title="工具与接入" />
        <SurfaceCard variant="default" radius="lg" padding={0} style={styles.groupCard}>
          <LinkRow
            icon="hardware-chip-outline"
            title="MCP 服务"
            subtitle={
              mcpServers.length === 0 ? '尚未添加' : `${enabledMcp}/${mcpServers.length} 已启用`
            }
            onPress={() => router.push('/settings/mcp')}
          />
          <View style={styles.divider} />
          <LinkRow
            icon="chatbubbles-outline"
            title="消息渠道"
            subtitle="飞书 / Telegram / 钉钉"
            onPress={() => router.push('/channels')}
          />
          <View style={styles.divider} />
          <LinkRow
            icon="image-outline"
            title="图片工作台"
            subtitle="生成、编辑与默认参数"
            onPress={() => router.push('/image-workspace')}
          />
          <View style={styles.divider} />
          <LinkRow
            icon="git-network-outline"
            title="Agent 任务"
            subtitle="运行中任务与产物"
            onPress={() => router.push('/agent-tasks')}
          />
        </SurfaceCard>

        {/* Workspace tools */}
        <SectionTitle title="工作区工具" />
        <SurfaceCard variant="default" radius="lg" padding={0} style={styles.groupCard}>
          <LinkRow
            icon="git-compare-outline"
            title="变更审阅"
            onPress={() => router.push('/change-review')}
          />
          <View style={styles.divider} />
          <LinkRow
            icon="time-outline"
            title="快照恢复"
            onPress={() => router.push('/snapshot-recovery')}
          />
          <View style={styles.divider} />
          <LinkRow
            icon="flash-outline"
            title="快捷命令"
            onPress={() => router.push('/quick-commands')}
          />
          <View style={styles.divider} />
          <LinkRow icon="cube-outline" title="产物预览" onPress={() => router.push('/artifacts')} />
        </SurfaceCard>

        {/* Desktop-aligned settings hub */}
        <SectionTitle title="更多设置（对齐桌面端）" />
        <SurfaceCard variant="default" radius="lg" padding={0} style={styles.groupCard}>
          {[
            {
              icon: 'desktop-outline' as const,
              title: '显示设置',
              subtitle: '主题、字号与布局偏好',
              href: '/settings/display',
            },
            {
              icon: 'person-outline' as const,
              title: 'Buddy 伴侣',
              subtitle: '人格、注入、语音与绑定',
              href: '/settings/companion',
            },
            {
              icon: 'server-outline' as const,
              title: '记忆管理',
              subtitle: '长期记忆与清理策略',
              href: '/settings/memory',
            },
            {
              icon: 'grid-outline' as const,
              title: '模板 / 智能体',
              subtitle: '模板与 Agent 配置',
              href: '/settings/agents',
            },
            {
              icon: 'git-branch-outline' as const,
              title: '工作流 / 定时',
              subtitle: '自动化与 schedules',
              href: '/settings/automation',
            },
            {
              icon: 'sparkles-outline' as const,
              title: '技能库',
              subtitle: 'Skills 与能力开关',
              href: '/settings/skills',
            },
            {
              icon: 'bar-chart-outline' as const,
              title: '用量与账单',
              subtitle: 'Token、费用与月报',
              href: '/settings/usage',
            },
            {
              icon: 'shield-checkmark-outline' as const,
              title: '安全与权限',
              subtitle: '权限规则与通知偏好',
              href: '/settings/security',
            },
            {
              icon: 'folder-outline' as const,
              title: '工作区',
              subtitle: '路径、过滤与桌面控制',
              href: '/settings/workspace',
            },
            {
              icon: 'extension-puzzle-outline' as const,
              title: '插件 / 资源',
              subtitle: '插件、MCP 扩展、资源中心',
              href: '/settings/plugins',
            },
            {
              icon: 'bug-outline' as const,
              title: '开发者工具',
              subtitle: '日志、诊断、Worker',
              href: '/settings/devtools',
            },
            {
              icon: 'information-circle-outline' as const,
              title: '关于',
              subtitle: '版本、检查更新、许可',
              href: '/settings/about',
            },
          ].map((item, index, arr) => (
            <View key={item.href}>
              <LinkRow
                icon={item.icon}
                title={item.title}
                subtitle={item.subtitle}
                onPress={() => router.push(item.href)}
              />
              {index < arr.length - 1 ? <View style={styles.divider} /> : null}
            </View>
          ))}
        </SurfaceCard>

        {/* App / OTA */}
        <SectionTitle title="应用" />
        <SurfaceCard variant="default" radius="lg" style={styles.groupCardPad}>
          <View style={styles.otaRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>应用更新</Text>
              <Text style={styles.linkSubtitle}>
                {otaState.status === 'idle' && '检查是否有新版本'}
                {otaState.status === 'checking' && '检查中…'}
                {otaState.status === 'downloading' && '下载更新中…'}
                {otaState.status === 'up-to-date' && '已是最新版本'}
                {otaState.status === 'ready' && '更新就绪 — 重启以应用'}
                {otaState.status === 'error' && `更新出错：${otaState.errorMessage ?? ''}`}
              </Text>
            </View>
            {otaState.status === 'ready' ? (
              <TouchableOpacity style={styles.otaBtn} onPress={applyUpdate}>
                <Text style={styles.otaBtnText}>重启</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.otaBtn}
                disabled={otaState.status === 'checking' || otaState.status === 'downloading'}
                onPress={() => {
                  void checkAndApply();
                }}
              >
                <Text style={styles.otaBtnText}>检查</Text>
              </TouchableOpacity>
            )}
          </View>
        </SurfaceCard>

        <TouchableOpacity style={styles.logoutBtn} onPress={() => void handleLogout()}>
          <Ionicons name="log-out-outline" size={16} color={colors.complement} />
          <Text style={styles.logoutText}>退出登录</Text>
        </TouchableOpacity>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { paddingBottom: 24 },
  pageHeader: { paddingHorizontal: 16, marginBottom: 8 },
  sectionTitle: {
    ...textPresets.label,
    color: colors.textMuted,
    fontWeight: '700',
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
  },
  accountCard: {
    marginHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.accentMuted,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  accountText: { flex: 1, gap: 3 },
  accountTitle: { ...textPresets.body, color: colors.textStrong, fontWeight: '700' },
  accountMeta: { ...textPresets.caption, color: colors.textMuted },
  onlineBadge: {
    borderRadius: radii.pill,
    backgroundColor: colors.successMuted,
    borderWidth: 1,
    borderColor: colors.successBorder,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  onlineText: { ...textPresets.caption, color: colors.success, fontWeight: '700' },
  offlineBadge: {
    backgroundColor: colors.surface2,
    borderColor: colors.lineDefault,
  },
  offlineText: { color: colors.textMuted },
  groupCard: {
    marginHorizontal: 16,
    overflow: 'hidden',
  },
  groupCardPad: {
    marginHorizontal: 16,
    gap: 12,
  },
  editBlock: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  fieldLabel: { ...textPresets.label, color: colors.textDefault },
  input: {
    backgroundColor: colors.surface2,
    color: colors.textStrong,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  secondaryAction: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.lineDefault,
  },
  secondaryActionText: { ...textPresets.label, color: colors.textDefault },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.lineSubtle },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  linkIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: { flex: 1, gap: 2 },
  linkTitle: { ...textPresets.body, color: colors.textStrong, fontWeight: '600' },
  linkSubtitle: { ...textPresets.caption, color: colors.textMuted },
  linkTrailing: { ...textPresets.caption, color: colors.textMuted },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  helperText: { ...textPresets.bodySmall, color: colors.textMuted, lineHeight: 18 },
  helperDanger: { color: colors.danger },
  optionGroup: { gap: 6 },
  otaRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  otaBtn: {
    backgroundColor: colors.accentMuted,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  otaBtnText: { ...textPresets.label, color: colors.accent, fontWeight: '700' },
  logoutBtn: {
    marginHorizontal: 16,
    marginTop: 20,
    height: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.complementBorder,
    backgroundColor: colors.surface1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  logoutText: { ...textPresets.body, color: colors.complement, fontWeight: '700' },
});
