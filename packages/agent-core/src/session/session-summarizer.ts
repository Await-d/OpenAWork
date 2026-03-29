export type MessageRole = 'user' | 'assistant' | 'tool';

export interface SessionMessage {
  role: MessageRole;
  content: string;
  timestamp: number;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  keyPoints: string[];
  artifacts: string[];
  tokenCount: number;
  duration: number;
}

const ARTIFACT_PATTERN = /artifact[:\s]+([a-zA-Z0-9_.-]+)/gi;

function extractTitle(messages: SessionMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return 'Untitled Session';
  const text = first.content.trim();
  return text.length > 80 ? text.slice(0, 77) + '...' : text;
}

function extractArtifacts(messages: SessionMessage[]): string[] {
  const ids = new Set<string>();
  for (const msg of messages) {
    const re = new RegExp(ARTIFACT_PATTERN.source, 'gi');
    let match = re.exec(msg.content);
    while (match !== null) {
      if (match[1]) ids.add(match[1]);
      match = re.exec(msg.content);
    }
  }
  return Array.from(ids);
}

function estimateTokens(messages: SessionMessage[]): number {
  return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
}

export class SessionSummarizer {
  async summarize(sessionId: string, messages: SessionMessage[]): Promise<SessionSummary> {
    const title = extractTitle(messages);
    const artifacts = extractArtifacts(messages);
    const tokenCount = estimateTokens(messages);

    const timestamps = messages.map((m) => m.timestamp).filter((t) => t > 0);
    const duration = timestamps.length >= 2 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;

    const userMessages = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content.trim().slice(0, 120));

    const keyPoints = userMessages.slice(0, 5);

    return {
      sessionId,
      title,
      keyPoints,
      artifacts,
      tokenCount,
      duration,
    };
  }
}

export const sessionSummarizer = new SessionSummarizer();
