import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import { useAuthStore } from '../store/auth';
import {
  IMAGE_GENERATION_SIZE_PRESET_GROUPS,
  resolveImageGenerationSizePresetId,
  sizeForPreset,
  validateImageGenerationSize,
} from '@openAwork/shared';
import { useOtaUpdate } from '../hooks/useOtaUpdate';
import ExpoPersistenceAdapter, {
  buildMobileProviderConfig,
  DEFAULT_MOBILE_IMAGE_GENERATION_DEFAULTS,
  loadImageGenerationDefaults,
  loadMcpServers,
  restoreMobileProviderSelection,
  saveImageGenerationDefaults,
  saveMcpServers,
  type MobileImageGenerationDefaults,
  type MobileMcpServer,
} from '../store/providerPersistence';

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

export function SettingsScreen({ onLogout }: SettingsScreenProps) {
  const { accessToken, gatewayUrl, setGatewayUrl, logout } = useAuthStore();
  const { state: otaState, checkAndApply, applyUpdate } = useOtaUpdate();
  const [gatewayInput, setGatewayInput] = useState(gatewayUrl);
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
  const [mcpName, setMcpName] = useState('');
  const [mcpUrl, setMcpUrl] = useState('');

  useEffect(() => {
    setGatewayInput(gatewayUrl);
  }, [gatewayUrl]);

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

  const persistMcpServers = (next: MobileMcpServer[]) => {
    setMcpServers(next);
    void saveMcpServers(next);
  };

  const addMcp = () => {
    if (!mcpName || !mcpUrl) return;
    persistMcpServers([
      ...mcpServers,
      { id: `mcp-${Date.now()}`, name: mcpName, url: mcpUrl, enabled: true },
    ]);
    setMcpName('');
    setMcpUrl('');
  };

  const toggleMcp = (id: string) => {
    persistMcpServers(
      mcpServers.map((server) =>
        server.id === id ? { ...server, enabled: !server.enabled } : server,
      ),
    );
  };

  const removeMcp = (id: string) => {
    persistMcpServers(mcpServers.filter((server) => server.id !== id));
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
        const response = await fetch(`${gatewayUrl}/settings/providers`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            providers: config.providers,
            activeSelection: config.active,
            imageGenerationDefaults: imageDefaults,
          }),
        });
        syncedToGateway = response.ok;
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.section}>网关</Text>
      <TextInput
        style={styles.input}
        value={gatewayInput}
        onChangeText={setGatewayInput}
        placeholder="http://localhost:3000"
        placeholderTextColor="#64748b"
        autoCapitalize="none"
        keyboardType="url"
      />
      <TouchableOpacity style={styles.btn} onPress={saveGateway}>
        <Text style={styles.btnText}>保存网关地址</Text>
      </TouchableOpacity>

      <Text style={styles.section}>AI 提供商</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.providerRow}>
        {PRESET_PROVIDERS.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={[styles.providerChip, selectedProvider.id === p.id && styles.providerChipActive]}
            onPress={() => setSelectedProvider(p)}
          >
            <Text
              style={[
                styles.providerChipText,
                selectedProvider.id === p.id && styles.providerChipTextActive,
              ]}
            >
              {p.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <TextInput
        style={styles.input}
        value={apiKey}
        onChangeText={setApiKey}
        placeholder={`${selectedProvider.name} API 密钥`}
        placeholderTextColor="#64748b"
        secureTextEntry
        autoCapitalize="none"
      />
      <TouchableOpacity
        style={styles.btn}
        onPress={() => {
          void saveProvider();
        }}
      >
        <Text style={styles.btnText}>保存 API 密钥</Text>
      </TouchableOpacity>

      <Text style={styles.section}>图片生成</Text>
      <Text style={styles.helperText}>
        图片模式使用独立的 OpenAI / GPT Image 2 配置与默认参数。
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.providerRow}>
        {IMAGE_PROVIDER_OPTIONS.map((provider) => (
          <TouchableOpacity
            key={provider.id}
            style={[
              styles.providerChip,
              selectedImageProvider.id === provider.id && styles.providerChipActive,
            ]}
            onPress={() => setSelectedImageProvider(provider)}
          >
            <Text
              style={[
                styles.providerChipText,
                selectedImageProvider.id === provider.id && styles.providerChipTextActive,
              ]}
            >
              {provider.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Text style={styles.subtleLabel}>模型：GPT Image 2</Text>
      <View style={styles.imageDefaultsGrid}>
        <View style={styles.imageField}>
          <Text style={styles.fieldLabel}>尺寸（1K / 2K / 4K / 自定义）</Text>
          <View style={styles.imagePresetGroups}>
            {IMAGE_GENERATION_SIZE_PRESET_GROUPS.map((group) => (
              <View key={group.tier} style={styles.imagePresetGroup}>
                <Text style={styles.imagePresetGroupTitle}>{group.label}</Text>
                <Text style={styles.imagePresetGroupHint}>{group.description}</Text>
                <View style={styles.optionRow}>
                  {group.presets.map((preset) => (
                    <TouchableOpacity
                      key={preset.id}
                      style={[
                        styles.optionChip,
                        resolveImageGenerationSizePresetId(imageDefaults.size) === preset.id &&
                          styles.optionChipActive,
                      ]}
                      onPress={() => setImageDefaults((prev) => ({ ...prev, size: preset.size }))}
                    >
                      <Text
                        style={[
                          styles.optionChipText,
                          resolveImageGenerationSizePresetId(imageDefaults.size) === preset.id &&
                            styles.optionChipTextActive,
                        ]}
                      >
                        {preset.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
            <TouchableOpacity
              style={[
                styles.optionChip,
                resolveImageGenerationSizePresetId(imageDefaults.size) === 'custom' &&
                  styles.optionChipActive,
              ]}
              onPress={() =>
                setImageDefaults((prev) => ({
                  ...prev,
                  size:
                    resolveImageGenerationSizePresetId(prev.size) === 'custom'
                      ? prev.size
                      : sizeForPreset('1k'),
                }))
              }
            >
              <Text
                style={[
                  styles.optionChipText,
                  resolveImageGenerationSizePresetId(imageDefaults.size) === 'custom' &&
                    styles.optionChipTextActive,
                ]}
              >
                自定义尺寸
              </Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            value={imageDefaults.size}
            onChangeText={(size) => setImageDefaults((prev) => ({ ...prev, size }))}
            placeholder="例如 2560x1440"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text
            style={[
              styles.helperText,
              !validateImageGenerationSize(imageDefaults.size).valid && styles.helperTextDanger,
            ]}
          >
            {validateImageGenerationSize(imageDefaults.size).valid
              ? '合法范围：最长边 ≤ 3840、宽高为 16 的倍数、比例不超过 3:1。'
              : validateImageGenerationSize(imageDefaults.size).message}
          </Text>
        </View>
        <View style={styles.imageField}>
          <Text style={styles.fieldLabel}>质量</Text>
          <View style={styles.optionRow}>
            {(['low', 'medium', 'high'] as const).map((quality) => (
              <TouchableOpacity
                key={quality}
                style={[
                  styles.optionChip,
                  imageDefaults.quality === quality && styles.optionChipActive,
                ]}
                onPress={() => setImageDefaults((prev) => ({ ...prev, quality }))}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    imageDefaults.quality === quality && styles.optionChipTextActive,
                  ]}
                >
                  {quality}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.imageField}>
          <Text style={styles.fieldLabel}>格式</Text>
          <View style={styles.optionRow}>
            {(['png', 'jpeg', 'webp'] as const).map((outputFormat) => (
              <TouchableOpacity
                key={outputFormat}
                style={[
                  styles.optionChip,
                  imageDefaults.outputFormat === outputFormat && styles.optionChipActive,
                ]}
                onPress={() => setImageDefaults((prev) => ({ ...prev, outputFormat }))}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    imageDefaults.outputFormat === outputFormat && styles.optionChipTextActive,
                  ]}
                >
                  {outputFormat.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.imageField}>
          <Text style={styles.fieldLabel}>背景</Text>
          <View style={styles.optionRow}>
            {(['auto', 'opaque'] as const).map((background) => (
              <TouchableOpacity
                key={background}
                style={[
                  styles.optionChip,
                  imageDefaults.background === background && styles.optionChipActive,
                ]}
                onPress={() => setImageDefaults((prev) => ({ ...prev, background }))}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    imageDefaults.background === background && styles.optionChipTextActive,
                  ]}
                >
                  {background === 'auto' ? '自动' : '不透明'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <Text style={styles.section}>MCP 服务器</Text>
      {mcpServers.map((s) => (
        <View key={s.id} style={styles.mcpRow}>
          <View style={styles.mcpInfo}>
            <Text style={styles.mcpName}>{s.name}</Text>
            <Text style={styles.mcpUrl} numberOfLines={1}>
              {s.url}
            </Text>
          </View>
          <Switch
            value={s.enabled}
            onValueChange={() => toggleMcp(s.id)}
            trackColor={{ true: '#6366f1' }}
          />
          <TouchableOpacity onPress={() => removeMcp(s.id)} style={styles.removeBtn}>
            <Text style={styles.removeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
      <View style={styles.mcpAddRow}>
        <TextInput
          style={[styles.input, { flex: 1, marginBottom: 0 }]}
          value={mcpName}
          onChangeText={setMcpName}
          placeholder="名称"
          placeholderTextColor="#64748b"
        />
        <TextInput
          style={[styles.input, { flex: 2, marginBottom: 0, marginLeft: 6 }]}
          value={mcpUrl}
          onChangeText={setMcpUrl}
          placeholder="URL"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
        />
        <TouchableOpacity
          style={[styles.btn, { marginBottom: 0, marginLeft: 6, paddingHorizontal: 10 }]}
          onPress={addMcp}
        >
          <Text style={styles.btnText}>+</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>应用</Text>
      <View style={styles.updateRow}>
        <Text style={styles.updateLabel}>
          {otaState.status === 'idle' && '检查更新'}
          {otaState.status === 'checking' && '检查中…'}
          {otaState.status === 'downloading' && '下载更新中…'}
          {otaState.status === 'up-to-date' && '已是最新版本'}
          {otaState.status === 'ready' && '更新就绪 — 重启以应用'}
          {otaState.status === 'error' && `更新出错：${otaState.errorMessage ?? ''}`}
        </Text>
        {otaState.status === 'ready' ? (
          <TouchableOpacity style={styles.btn} onPress={applyUpdate}>
            <Text style={styles.btnText}>重启</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              styles.btn,
              (otaState.status === 'checking' || otaState.status === 'downloading') &&
                styles.btnDisabled,
            ]}
            onPress={() => {
              void checkAndApply();
            }}
            disabled={otaState.status === 'checking' || otaState.status === 'downloading'}
          >
            <Text style={styles.btnText}>立即检查</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={[styles.btn, styles.logoutBtn]} onPress={handleLogout}>
        <Text style={styles.logoutBtnText}>退出登录</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, paddingBottom: 40 },
  section: {
    color: '#6366f1',
    fontWeight: '600',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 20,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 8,
  },
  btn: {
    backgroundColor: '#6366f1',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    marginBottom: 4,
  },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  providerRow: { marginBottom: 8 },
  providerChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginRight: 6,
    backgroundColor: '#1e293b',
  },
  providerChipActive: { borderColor: '#6366f1', backgroundColor: '#6366f122' },
  providerChipText: { color: '#94a3b8', fontSize: 13 },
  providerChipTextActive: { color: '#6366f1', fontWeight: '600' },
  helperText: { color: '#94a3b8', fontSize: 12, lineHeight: 18, marginBottom: 8 },
  helperTextDanger: { color: '#f87171' },
  subtleLabel: { color: '#cbd5e1', fontSize: 12, marginBottom: 8, fontWeight: '600' },
  imageDefaultsGrid: { gap: 10, marginBottom: 8 },
  imageField: { gap: 6 },
  imagePresetGroups: { gap: 10 },
  imagePresetGroup: { gap: 6 },
  imagePresetGroupTitle: { color: '#e2e8f0', fontSize: 12, fontWeight: '700' },
  imagePresetGroupHint: { color: '#94a3b8', fontSize: 11, lineHeight: 16 },
  fieldLabel: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1e293b',
  },
  optionChipActive: { borderColor: '#6366f1', backgroundColor: '#6366f122' },
  optionChipText: { color: '#94a3b8', fontSize: 12 },
  optionChipTextActive: { color: '#6366f1', fontWeight: '600' },
  mcpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 8,
  },
  mcpInfo: { flex: 1, minWidth: 0 },
  mcpName: { color: '#f8fafc', fontSize: 13, fontWeight: '500' },
  mcpUrl: { color: '#64748b', fontSize: 11 },
  mcpAddRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 0 },
  removeBtn: { padding: 4 },
  removeBtnText: { color: '#f87171', fontSize: 14 },
  logoutBtn: { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#f87171', marginTop: 24 },
  logoutBtnText: { color: '#f87171', fontSize: 14, fontWeight: '600' },
  updateRow: { marginBottom: 8 },
  updateLabel: { color: '#94a3b8', fontSize: 13, marginBottom: 6 },
  btnDisabled: { opacity: 0.5 },
});
