import type { DecideProposalInput, MemoriesClient, MemoryProposal } from '@openAwork/web-client';

type Client = Pick<MemoriesClient, 'listProposals' | 'getProposal' | 'decideProposal'>;
export interface MemoryApprovalState {
  proposals: MemoryProposal[];
  detail: MemoryProposal | null;
  busy: boolean;
  loaded: boolean;
  error: string | null;
  message: string | null;
}

function snapshot(proposal: MemoryProposal): string {
  return JSON.stringify([
    proposal.id,
    proposal.payloadDigest,
    proposal.payload,
    proposal.scope,
    proposal.action,
    proposal.targetMemoryId,
    proposal.expectedRevision,
    proposal.revision,
    proposal.relations,
  ]);
}

export function createMemoryApprovalController(input: {
  client: Client;
  token: string;
  isCurrent: () => boolean;
  onChange: (state: MemoryApprovalState) => void;
}) {
  let alive = true;
  let sequence = 0;
  let state: MemoryApprovalState = {
    proposals: [],
    detail: null,
    busy: false,
    loaded: false,
    error: null,
    message: null,
  };
  const current = () => alive && input.isCurrent();
  const emit = (patch: Partial<MemoryApprovalState>) => {
    if (!current()) return;
    state = { ...state, ...patch };
    input.onChange(state);
  };
  const fail = (cause: unknown) =>
    emit({ error: cause instanceof Error ? cause.message : '操作失败，未保存', busy: false });
  return {
    dispose() {
      alive = false;
      sequence += 1;
    },
    async load() {
      if (!current() || state.busy) return;
      const id = ++sequence;
      emit({ busy: true, loaded: false, error: null, message: null });
      try {
        const proposals = await input.client.listProposals(input.token, { status: 'pending' });
        if (current() && id === sequence) emit({ proposals, loaded: true, busy: false });
      } catch (cause) {
        if (id === sequence) fail(cause);
      }
    },
    async open(proposalId: string) {
      if (!current() || state.busy) return;
      const id = ++sequence;
      emit({ busy: true, error: null, message: null, detail: null });
      try {
        const result = await input.client.getProposal(input.token, proposalId);
        if (current() && id === sequence) {
          emit({
            detail: {
              ...result.proposal,
              relations: result.relations ?? result.proposal.relations,
            },
            busy: false,
          });
        }
      } catch (cause) {
        if (id === sequence) fail(cause);
      }
    },
    async decide(decision: DecideProposalInput) {
      if (!current() || state.busy || !state.detail) return;
      const shown = state.detail;
      const id = ++sequence;
      emit({ busy: true, error: null, message: null });
      try {
        const result = await input.client.getProposal(input.token, shown.id);
        if (!current() || id !== sequence) return;
        const latest = {
          ...result.proposal,
          relations: result.relations ?? result.proposal.relations,
        };
        if (snapshot(latest) !== snapshot(shown)) {
          emit({
            detail: { ...result.proposal, relations: result.relations },
            busy: false,
            error: '内容或作用域已变化，请重新查看后确认。',
          });
          return;
        }
        if (result.proposal.status !== 'pending') {
          emit({ busy: false, error: '该提议已处理，请刷新列表。' });
          return;
        }
        const response = await input.client.decideProposal(input.token, shown.id, {
          ...decision,
          ...(shown.expectedRevision !== null ? { expectedRevision: shown.expectedRevision } : {}),
        });
        if (!current() || id !== sequence) return;
        if (!response.ok) {
          emit({ busy: false, error: '处理失败，未确认保存。' });
          return;
        }
        emit({
          busy: false,
          detail: null,
          proposals: state.proposals.filter((entry) => entry.id !== shown.id),
          message: decision.decision === 'approve' ? '已确认并保存' : '已保留原状，不写入记忆',
        });
      } catch (cause) {
        if (id === sequence) fail(cause);
      }
    },
  };
}
