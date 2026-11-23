import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { createMemoriesClient } from '@openAwork/web-client';
import type { DecideProposalInput } from '@openAwork/web-client';
import { useAuthStore } from '../../store/auth';
import { colors } from '../../theme/colors';
import { createMemoryApprovalController } from './memory-approval-controller';
import type { MemoryApprovalState } from './memory-approval-controller';
import { MemoryApprovalPayload } from './MemoryApprovalPayload';

export function MemoryApprovalPanel({ gatewayUrl, token }: { gatewayUrl: string; token: string }) {
  return <Approval key={`${gatewayUrl}:${token}`} gatewayUrl={gatewayUrl} token={token} />;
}

function Approval({ gatewayUrl, token }: { gatewayUrl: string; token: string }) {
  const [state, setState] = useState<MemoryApprovalState>({
    proposals: [],
    detail: null,
    busy: false,
    loaded: false,
    error: null,
    message: null,
  });
  const controller = useRef<ReturnType<typeof createMemoryApprovalController> | null>(null);
  useEffect(() => {
    const instance = createMemoryApprovalController({
      client: createMemoriesClient(gatewayUrl),
      token,
      isCurrent: () => {
        const auth = useAuthStore.getState();
        return auth.accessToken === token && auth.gatewayUrl === gatewayUrl;
      },
      onChange: setState,
    });
    controller.current = instance;
    void instance.load();
    return () => {
      instance.dispose();
      controller.current = null;
    };
  }, [gatewayUrl, token]);
  const decision = (input: DecideProposalInput) => {
    void controller.current?.decide(input);
  };
  const detail = state.detail;
  const payload = detail?.payload;
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>待确认记忆</Text>
      <Text>只有明确确认才保存；忽略或退出不会自动批准。</Text>
      {state.busy && <ActivityIndicator color={colors.accent} />}
      {state.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {state.error}
        </Text>
      )}
      {state.message && <Text accessibilityRole="alert">{state.message}</Text>}
      <TouchableOpacity
        accessibilityRole="button"
        disabled={state.busy}
        onPress={() => void controller.current?.load()}
      >
        <Text style={styles.action}>刷新待确认列表</Text>
      </TouchableOpacity>
      {state.loaded && !state.busy && !state.error && state.proposals.length === 0 && (
        <Text>暂无待确认项</Text>
      )}
      {state.proposals.map((proposal) => (
        <TouchableOpacity
          accessibilityRole="button"
          key={proposal.id}
          disabled={state.busy}
          onPress={() => void controller.current?.open(proposal.id)}
        >
          <Text style={styles.action}>
            查看：{proposal.payload.name ?? proposal.payload.key ?? proposal.action}
          </Text>
        </TouchableOpacity>
      ))}
      {detail && (
        <View style={styles.detail}>
          <Text style={styles.title}>{payload?.name ?? payload?.key}</Text>
          <Text selectable>
            操作：{detail.action}；来源：{detail.origin}
          </Text>
          <Text selectable>
            影响范围：{detail.scope.type} / {detail.scope.id}
          </Text>
          <Text selectable>理由：{detail.reason}</Text>
          <Text selectable>{payload?.body ?? payload?.value}</Text>
          <MemoryApprovalPayload proposal={detail} />
          {detail.relations?.map((relation) => (
            <Text selectable key={`${relation.kind}:${relation.memoryId}`}>
              既有记录（{relation.kind}）：{relation.key}：{relation.value}
            </Text>
          ))}
          <TouchableOpacity
            accessibilityRole="button"
            disabled={state.busy}
            onPress={() => decision({ decision: 'approve' })}
          >
            <Text style={styles.action}>确认保存以上内容</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={state.busy}
            onPress={() => decision({ decision: 'reject', keepOriginal: true })}
          >
            <Text style={styles.action}>保留原状</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={state.busy}
            onPress={() => decision({ decision: 'reject' })}
          >
            <Text style={styles.action}>拒绝</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 16,
    gap: 12,
    backgroundColor: colors.surface1,
    borderRadius: 12,
    marginBottom: 16,
  },
  title: { fontSize: 16, fontWeight: '600', color: colors.textStrong },
  action: { color: colors.accent, paddingVertical: 10 },
  error: { color: colors.danger },
  detail: { gap: 10, borderTopWidth: 1, borderColor: colors.lineDefault, paddingTop: 12 },
});
