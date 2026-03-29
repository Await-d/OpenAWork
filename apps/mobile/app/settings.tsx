import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Switch,
} from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../src/store/auth';

const MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-6',
  'gpt-4o',
  'gpt-4o-mini',
  'gemini-2.0-flash',
];

const MODEL_KEY = 'openwork_selected_model';
const MCP_SERVERS_KEY = 'openwork_mcp_servers';

interface McpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export default function SettingsScreen() {
  const { gatewayUrl, setGatewayUrl, logout } = useAuthStore();
  const [urlInput, setUrlInput] = useState(gatewayUrl);
  const [saving, setSaving] = useState(false);
  const [selectedModel, setSelectedModel] = useState(MODELS[0] ?? '');
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpUrl, setNewMcpUrl] = useState('');

  useEffect(() => {
    async function loadPersistedSettings() {
      const [model, serversJson] = await Promise.all([
        SecureStore.getItemAsync(MODEL_KEY),
        SecureStore.getItemAsync(MCP_SERVERS_KEY),
      ]);
      if (model) setSelectedModel(model);
      if (serversJson) {
        try {
          setMcpServers(JSON.parse(serversJson) as McpServer[]);
        } catch {
          setMcpServers([]);
        }
      }
    }
    void loadPersistedSettings();
  }, []);

  async function saveGatewayUrl() {
    if (!urlInput.trim()) return;
    setSaving(true);
    try {
      await setGatewayUrl(urlInput.trim().replace(/\/$/, ''));
      Alert.alert('Saved', 'Gateway URL updated');
    } finally {
      setSaving(false);
    }
  }

  const selectModel = useCallback(async (model: string) => {
    setSelectedModel(model);
    await SecureStore.setItemAsync(MODEL_KEY, model);
  }, []);

  const persistServers = useCallback(async (servers: McpServer[]) => {
    await SecureStore.setItemAsync(MCP_SERVERS_KEY, JSON.stringify(servers));
  }, []);

  const addMcpServer = useCallback(async () => {
    if (!newMcpName.trim() || !newMcpUrl.trim()) return;
    const updated = [
      ...mcpServers,
      { id: crypto.randomUUID(), name: newMcpName.trim(), url: newMcpUrl.trim(), enabled: true },
    ];
    setMcpServers(updated);
    setNewMcpName('');
    setNewMcpUrl('');
    await persistServers(updated);
  }, [mcpServers, newMcpName, newMcpUrl, persistServers]);

  const toggleMcpServer = useCallback(
    async (id: string) => {
      const updated = mcpServers.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
      setMcpServers(updated);
      await persistServers(updated);
    },
    [mcpServers, persistServers],
  );

  const removeMcpServer = useCallback(
    async (id: string) => {
      const updated = mcpServers.filter((s) => s.id !== id);
      setMcpServers(updated);
      await persistServers(updated);
    },
    [mcpServers, persistServers],
  );

  async function handleLogout() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/login');
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Gateway</Text>
        <Text style={styles.label}>Gateway URL</Text>
        <TextInput
          style={styles.input}
          value={urlInput}
          onChangeText={setUrlInput}
          placeholder="http://localhost:3000"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <TouchableOpacity
          style={[styles.button, saving && styles.buttonDisabled]}
          onPress={() => void saveGatewayUrl()}
          disabled={saving}
        >
          <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Model</Text>
        {MODELS.map((model) => {
          const selected = model === selectedModel;
          return (
            <TouchableOpacity
              key={model}
              style={[styles.modelRow, selected && styles.modelRowSelected]}
              onPress={() => void selectModel(model)}
            >
              <Text style={[styles.modelName, selected && styles.modelNameSelected]}>{model}</Text>
              {selected ? <Text style={styles.checkmark}>✓</Text> : null}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>MCP Servers</Text>
        <View style={styles.mcpInputRow}>
          <TextInput
            style={[styles.input, styles.mcpNameInput]}
            value={newMcpName}
            onChangeText={setNewMcpName}
            placeholder="Name"
            placeholderTextColor="#64748b"
          />
          <TextInput
            style={[styles.input, styles.mcpUrlInput]}
            value={newMcpUrl}
            onChangeText={setNewMcpUrl}
            placeholder="wss://host/mcp"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </View>
        <TouchableOpacity
          style={[
            styles.button,
            (!newMcpName.trim() || !newMcpUrl.trim()) && styles.buttonDisabled,
          ]}
          onPress={() => void addMcpServer()}
          disabled={!newMcpName.trim() || !newMcpUrl.trim()}
        >
          <Text style={styles.buttonText}>Add Server</Text>
        </TouchableOpacity>

        {mcpServers.length === 0 ? (
          <Text style={styles.emptyText}>No MCP servers configured.</Text>
        ) : (
          mcpServers.map((s) => (
            <View key={s.id} style={styles.mcpServerRow}>
              <Switch
                value={s.enabled}
                onValueChange={() => void toggleMcpServer(s.id)}
                trackColor={{ false: '#334155', true: '#6366f1' }}
                thumbColor="#f8fafc"
              />
              <View style={styles.mcpServerInfo}>
                <Text style={styles.mcpServerName}>{s.name}</Text>
                <Text style={styles.mcpServerUrl} numberOfLines={1}>
                  {s.url}
                </Text>
              </View>
              <TouchableOpacity onPress={() => void removeMcpServer(s.id)}>
                <Text style={styles.removeButton}>×</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <TouchableOpacity style={styles.dangerButton} onPress={() => void handleLogout()}>
          <Text style={styles.dangerButtonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.version}>OpenAWork Mobile v0.0.1</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 20, gap: 24 },
  section: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 10,
  },
  sectionTitle: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  label: { color: '#f8fafc', fontSize: 14, fontWeight: '500' },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    color: '#f8fafc',
    fontSize: 14,
  },
  button: {
    backgroundColor: '#6366f1',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 12,
  },
  modelRowSelected: {
    borderColor: '#6366f1',
    backgroundColor: '#1e1b4b',
  },
  modelName: { color: '#94a3b8', fontSize: 14 },
  modelNameSelected: { color: '#c7d2fe', fontWeight: '600' },
  checkmark: { color: '#6366f1', fontSize: 16, fontWeight: '700' },
  mcpInputRow: { flexDirection: 'row', gap: 8 },
  mcpNameInput: { width: 110 },
  mcpUrlInput: { flex: 1 },
  emptyText: { color: '#475569', fontSize: 13, textAlign: 'center', paddingVertical: 8 },
  mcpServerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 10,
  },
  mcpServerInfo: { flex: 1, minWidth: 0 },
  mcpServerName: { color: '#f8fafc', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  mcpServerUrl: { color: '#64748b', fontSize: 11 },
  removeButton: { color: '#64748b', fontSize: 20, paddingHorizontal: 4 },
  dangerButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  dangerButtonText: { color: '#ef4444', fontSize: 14, fontWeight: '600' },
  version: { color: '#475569', fontSize: 12, textAlign: 'center', marginTop: 8 },
});
