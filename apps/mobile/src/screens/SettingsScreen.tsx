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
import { useOtaUpdate } from '../hooks/useOtaUpdate';
import ExpoPersistenceAdapter, {
  buildMobileProviderConfig,
  loadMcpServers,
  restoreMobileProviderSelection,
  saveMcpServers,
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

type MobileProviderOption = (typeof PRESET_PROVIDERS)[number];

const persistence = new ExpoPersistenceAdapter();

interface SettingsScreenProps {
  onLogout?: () => void;
}

export function SettingsScreen({ onLogout }: SettingsScreenProps) {
  const { gatewayUrl, setGatewayUrl, logout } = useAuthStore();
  const { state: otaState, checkAndApply, applyUpdate } = useOtaUpdate();
  const [gatewayInput, setGatewayInput] = useState(gatewayUrl);
  const [selectedProvider, setSelectedProvider] = useState<MobileProviderOption>(
    PRESET_PROVIDERS[0],
  );
  const [apiKey, setApiKey] = useState('');
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

      if (cancelled) return;

      setSelectedProvider(
        PRESET_PROVIDERS.find((provider) => provider.id === restored.selectedProviderId) ??
          PRESET_PROVIDERS[0],
      );
      setApiKey(restored.apiKey);
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
    const config = buildMobileProviderConfig(selectedProvider.id, apiKey.trim());
    await persistence.saveProviderConfig(config.providers, config.active);
    await persistence.saveApiKey(selectedProvider.id, apiKey.trim());
    Alert.alert('已保存', `${selectedProvider.name} 的配置已保存`);
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
