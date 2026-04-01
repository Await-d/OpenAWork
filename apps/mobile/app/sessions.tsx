import { useState, useEffect, useCallback } from 'react';
import { createSessionsClient } from '@openAwork/web-client';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../src/store/auth';
import { listSessions, upsertSession } from '../src/db/session-store';

interface Session {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export default function SessionsScreen() {
  const { accessToken, gatewayUrl, logout } = useAuthStore();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSessions = useCallback(async () => {
    const local = await listSessions();
    if (local.length > 0) {
      setSessions(
        local.map((s) => ({
          id: s.id,
          title: s.title,
          created_at: new Date(s.created_at).toISOString(),
          updated_at: new Date(s.updated_at).toISOString(),
        })),
      );
      setLoading(false);
    }

    if (!accessToken) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      let remote: Session[] = [];
      try {
        remote = (await createSessionsClient(gatewayUrl).list(
          accessToken ?? '',
        )) as unknown as Session[];
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('401')) {
          await logout();
          router.replace('/login');
          return;
        }
        throw e;
      }
      setSessions(remote);
      await Promise.all(
        remote.map((s) =>
          upsertSession({
            id: s.id,
            title: s.title,
            messages_json: '[]',
            draft: '',
            created_at: new Date(s.created_at).getTime(),
            updated_at: new Date(s.updated_at).getTime(),
          }),
        ),
      );
    } catch {
      if (local.length === 0) Alert.alert('Error', 'Failed to load sessions');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken, gatewayUrl, logout]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  async function createSession() {
    if (!accessToken) return;
    try {
      const session = await createSessionsClient(gatewayUrl).create(accessToken ?? '');
      router.push(`/chat/${session.id}`);
    } catch {
      Alert.alert('Error', 'Failed to create session');
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sessions.length === 0 ? styles.emptyContainer : styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void fetchSessions();
            }}
            tintColor="#6366f1"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✦</Text>
            <Text style={styles.emptyText}>No sessions yet</Text>
            <Text style={styles.emptySubtext}>Tap + to start a conversation</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.sessionItem}
            onPress={() => router.push(`/chat/${item.id}`)}
          >
            <Text style={styles.sessionTitle} numberOfLines={1}>
              {item.title ?? 'Untitled Session'}
            </Text>
            <Text style={styles.sessionDate}>{formatDate(item.updated_at)}</Text>
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.fab} onPress={() => void createSession()}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  list: { padding: 16, gap: 10 },
  emptyContainer: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 120 },
  emptyIcon: { fontSize: 36, color: '#6366f1', marginBottom: 12 },
  emptyText: { color: '#f8fafc', fontSize: 18, fontWeight: '600', marginBottom: 6 },
  emptySubtext: { color: '#64748b', fontSize: 14 },
  sessionItem: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  sessionTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '500', marginBottom: 4 },
  sessionDate: { color: '#64748b', fontSize: 12 },
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  fabText: { color: '#fff', fontSize: 28, fontWeight: '300', lineHeight: 32 },
});
