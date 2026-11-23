import type { ChatMessage } from './message-model.js';
import {
  areStronglyIdenticalMessages,
  createSnapshotMessageComparator,
} from './message-equivalence.js';

function identityKeys(message: ChatMessage): string[] {
  const keys = [`id:${message.id}`];
  if (message.clientRequestId) {
    keys.push(`request:${message.role}:${message.clientRequestId}`);
  }
  if (message.role === 'assistant') {
    for (const part of message.parts ?? []) {
      keys.push(`part:${part.id}`);
      if (part.type === 'tool') keys.push(`tool:${part.toolCallId}`);
    }
  }
  return keys;
}

/**
 * 权威快照之间只比较强身份；模糊匹配仍仅用于本地副本。
 * 常见的全量快照不再为每条消息扫描整个前缀，且保留原来最早命中的语义。
 */
export class SnapshotDuplicateIndex {
  private readonly identities = new Map<string, Set<number>>();
  private readonly byRole = new Map<ChatMessage['role'], Set<number>>();
  private readonly localByRole = new Map<ChatMessage['role'], Set<number>>();

  constructor(
    private readonly snapshotIds: ReadonlySet<string>,
    private readonly equivalent = createSnapshotMessageComparator(),
  ) {}

  register(index: number, message: ChatMessage): void {
    for (const key of identityKeys(message)) this.add(this.identities, key, index);
    this.add(this.byRole, message.role, index);
    if (!this.snapshotIds.has(message.id)) this.add(this.localByRole, message.role, index);
  }

  replace(index: number, previous: ChatMessage, next: ChatMessage): void {
    for (const key of identityKeys(previous)) this.remove(this.identities, key, index);
    this.remove(this.byRole, previous.role, index);
    this.remove(this.localByRole, previous.role, index);
    this.register(index, next);
  }

  find(message: ChatMessage, output: readonly ChatMessage[]): number {
    const candidates = new Set<number>();
    for (const key of identityKeys(message)) {
      for (const index of this.identities.get(key) ?? []) candidates.add(index);
    }
    const isSnapshot = this.snapshotIds.has(message.id);
    const fuzzyCandidates = (isSnapshot ? this.localByRole : this.byRole).get(message.role);
    for (const index of fuzzyCandidates ?? []) candidates.add(index);

    let firstMatch = -1;
    for (const index of candidates) {
      if (firstMatch >= 0 && index >= firstMatch) continue;
      const existing = output[index]!;
      const matches =
        isSnapshot && this.snapshotIds.has(existing.id)
          ? areStronglyIdenticalMessages(existing, message)
          : areStronglyIdenticalMessages(existing, message) ||
            (!(existing.clientRequestId && message.clientRequestId) &&
              this.equivalent(existing, message));
      if (matches) firstMatch = index;
    }
    return firstMatch;
  }

  private add<K>(map: Map<K, Set<number>>, key: K, index: number): void {
    let indices = map.get(key);
    if (!indices) {
      indices = new Set<number>();
      map.set(key, indices);
    }
    indices.add(index);
  }

  private remove<K>(map: Map<K, Set<number>>, key: K, index: number): void {
    const indices = map.get(key);
    if (!indices) return;
    indices.delete(index);
    if (indices.size === 0) map.delete(key);
  }
}
