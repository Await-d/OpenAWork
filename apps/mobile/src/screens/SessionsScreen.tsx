import { useEffect, useState, useCallback } from 'react';
import { login as apiLogin, createSessionsClient } from '@openAwork/web-client';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useAuthStore } from '../store/auth';
import { listSessions, upsertSession } from '../db/session-store';
import type { LocalSession } from '../db/session-store';

interface SessionsScreenProps {
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
}

export function SessionsScreen({ onSelectSession, onNewSession }: SessionsScreenProps) {
  const { accessToken, gatewayUrl } = useAuthStore();
  const [sessions, setSessions] = useState<LocalSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadLocal = useCallback(async () => {
    const local = await listSessions();
    setSessions(local);
  }, []);

  const syncRemote = useCallback(async () => {
    if (!accessToken) return;
    try {
      const sessionList = await createSessionsClient(gatewayUrl).list(accessToken ?? '');
      for (const s of sessionList as Array<{
        id: string;
        title: string | null;
        created_at: number;
        updated_at: number;
      }>) {
        await upsertSession({
          id: s.id,
          title: s.title,
          messages_json: '[]',
          draft: '',
          created_at: s.created_at,
          updated_at: s.updated_at,
        });
      }
      setSessions(await listSessions());
    } catch {}
  }, [accessToken, gatewayUrl]);

  useEffect(() => {
    void loadLocal()
      .then(() => setLoading(false))
      .then(() => syncRemote());
  }, [loadLocal, syncRemote]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await syncRemote();
    setRefreshing(false);
  }, [syncRemote]);

  const createSession = async () => {
    if (!accessToken) return;
    try {
      const newSession = await createSessionsClient(gatewayUrl).create(accessToken ?? '', {
        title: '新对话',
      });
      if (!newSession.id) return;
      const data = { sessionId: newSession.id };
      await upsertSession({
        id: data.sessionId,
        title: '新对话',
        messages_json: '[]',
        draft: '',
        created_at: Date.now(),
        updated_at: Date.now(),
      });
      setSessions(await listSessions());
      onSelectSession(data.sessionId);
    } catch {}
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>会话</Text>
        <TouchableOpacity onPress={createSession} style={styles.newBtn}>
          <Text style={styles.newBtnText}>+ 新建</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
        }
        ListEmptyComponent={<Text style={styles.empty}>暂无会话</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.item} onPress={() => onSelectSession(item.id)}>
            <Text style={styles.itemTitle} numberOfLines={1}>
              {item.title ?? '未命名'}
            </Text>
            <Text style={styles.itemDate}>{new Date(item.updated_at).toLocaleDateString()}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: { fontSize: 18, fontWeight: '600', color: '#f8fafc' },
  newBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  newBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 40, fontSize: 14 },
  item: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  itemTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '500', marginBottom: 2 },
  itemDate: { color: '#64748b', fontSize: 12 },
});
