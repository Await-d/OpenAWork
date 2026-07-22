import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Switch,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  loadMcpServers,
  saveMcpServers,
  type MobileMcpServer,
} from '../../src/store/providerPersistence';
import { colors } from '../../src/theme/colors';
import { radii } from '../../src/theme/radii';
import { textPresets } from '../../src/theme/typography';

/** S10: MCP 服务管理 */
export default function McpServiceScreen() {
  const [servers, setServers] = useState<MobileMcpServer[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    void loadMcpServers().then(setServers);
  }, []);

  const persist = useCallback((next: MobileMcpServer[]) => {
    setServers(next);
    void saveMcpServers(next);
  }, []);

  function addServer() {
    if (!name.trim() || !url.trim()) {
      Alert.alert('错误', '请输入名称和 URL');
      return;
    }
    persist([
      ...servers,
      { id: `mcp-${Date.now()}`, name: name.trim(), url: url.trim(), enabled: true },
    ]);
    setName('');
    setUrl('');
    setShowAdd(false);
  }

  function toggleServer(id: string) {
    persist(servers.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  }

  function removeServer(id: string) {
    Alert.alert('确认删除', '删除后不可恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => persist(servers.filter((s) => s.id !== id)),
      },
    ]);
  }

  const enabledCount = servers.filter((s) => s.enabled).length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={18} color={colors.textDefault} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>MCP 服务管理</Text>
        <TouchableOpacity onPress={() => setShowAdd((v) => !v)} style={styles.addBtn}>
          <Ionicons name={showAdd ? 'close' : 'add'} size={20} color={colors.accent} />
        </TouchableOpacity>
      </View>

      {/* Status bar */}
      <View style={styles.statusBar}>
        <Ionicons name="hardware-chip-outline" size={16} color={colors.aux} />
        <Text style={styles.statusText}>
          {enabledCount} / {servers.length} 个服务已启用
        </Text>
      </View>

      {/* Add form */}
      {showAdd && (
        <View style={styles.addCard}>
          <Text style={styles.addTitle}>添加 MCP 服务</Text>
          <TextInput
            style={styles.input}
            placeholder="服务名称"
            placeholderTextColor={colors.textSubtle}
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={styles.input}
            placeholder="服务 URL（如 http://localhost:3001）"
            placeholderTextColor={colors.textSubtle}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TouchableOpacity style={styles.addConfirmBtn} onPress={addServer}>
            <Ionicons name="add-circle-outline" size={16} color={colors.white} />
            <Text style={styles.addConfirmText}>添加</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Server list */}
      <FlatList
        data={servers}
        keyExtractor={(s) => s.id}
        contentContainerStyle={servers.length === 0 ? styles.emptyWrap : styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="cube-outline" size={40} color={colors.textSubtle} />
            <Text style={styles.emptyText}>暂无 MCP 服务</Text>
            <Text style={styles.emptySubtext}>点击右上角 + 添加第一个服务</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.serverCard}>
            <View style={styles.serverIconWrap}>
              <Ionicons
                name="cube-outline"
                size={18}
                color={item.enabled ? colors.accent : colors.textSubtle}
              />
            </View>
            <View style={styles.serverInfo}>
              <Text style={styles.serverName}>{item.name}</Text>
              <Text style={styles.serverUrl} numberOfLines={1}>
                {item.url}
              </Text>
            </View>
            <Switch
              value={item.enabled}
              onValueChange={() => toggleServer(item.id)}
              trackColor={{ true: colors.accent }}
            />
            <TouchableOpacity onPress={() => removeServer(item.id)} style={styles.removeBtn}>
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...textPresets.cardTitle, color: colors.textStrong },
  addBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.auxMuted,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.auxBorder,
    padding: 10,
  },
  statusText: { ...textPresets.label, color: colors.aux },

  addCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 12,
    gap: 8,
  },
  addTitle: { ...textPresets.label, color: colors.textStrong },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 10,
    color: colors.textStrong,
    fontSize: 14,
  },
  addConfirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
  },
  addConfirmText: { ...textPresets.body, color: colors.white, fontWeight: '600' },

  listContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 100 },
  emptyWrap: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 120, gap: 8 },
  emptyText: { ...textPresets.subheading, color: colors.textStrong },
  emptySubtext: { ...textPresets.body, color: colors.textMuted },

  serverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    padding: 12,
  },
  serverIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverInfo: { flex: 1, gap: 2 },
  serverName: { ...textPresets.body, color: colors.textStrong, fontWeight: '600' },
  serverUrl: { ...textPresets.caption, color: colors.textMuted },
  removeBtn: { padding: 6 },
});
