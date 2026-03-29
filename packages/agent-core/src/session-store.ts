import type { ConversationSession, SessionCheckpoint, AgentStatus } from './types.js';
import type { Message } from '@openAwork/shared';

export interface SessionStore {
  create(
    partial: Omit<ConversationSession, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ConversationSession>;
  get(id: string): Promise<ConversationSession | null>;
  list(limit?: number, offset?: number): Promise<ConversationSession[]>;
  update(
    id: string,
    patch: Partial<Pick<ConversationSession, 'messages' | 'state' | 'metadata'>>,
  ): Promise<ConversationSession>;
  delete(id: string): Promise<void>;
  checkpoint(sessionId: string): Promise<SessionCheckpoint>;
  restoreFromCheckpoint(checkpoint: SessionCheckpoint): Promise<ConversationSession>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, ConversationSession>();

  async create(
    partial: Omit<ConversationSession, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ConversationSession> {
    const now = Date.now();
    const session: ConversationSession = {
      ...partial,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async get(id: string): Promise<ConversationSession | null> {
    return this.sessions.get(id) ?? null;
  }

  async list(limit = 20, offset = 0): Promise<ConversationSession[]> {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(offset, offset + limit);
  }

  async update(
    id: string,
    patch: Partial<Pick<ConversationSession, 'messages' | 'state' | 'metadata'>>,
  ): Promise<ConversationSession> {
    const existing = this.sessions.get(id);
    if (!existing) {
      throw new SessionNotFoundError(id);
    }
    const updated: ConversationSession = {
      ...existing,
      ...patch,
      id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    this.sessions.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async checkpoint(sessionId: string): Promise<SessionCheckpoint> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }
    return {
      sessionId: session.id,
      checkpointAt: Date.now(),
      messages: [...session.messages],
      stateStatus: session.state.status as AgentStatus,
      metadata: { ...session.metadata },
    };
  }

  async restoreFromCheckpoint(checkpoint: SessionCheckpoint): Promise<ConversationSession> {
    const messages: Message[] = checkpoint.messages.map((m) => ({ ...m }));
    return this.create({
      messages,
      state: { status: 'idle' },
      metadata: { ...checkpoint.metadata, restoredFrom: checkpoint.checkpointAt },
    });
  }
}

export class SessionNotFoundError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session "${sessionId}" not found`);
    this.name = 'SessionNotFoundError';
    this.sessionId = sessionId;
  }
}
