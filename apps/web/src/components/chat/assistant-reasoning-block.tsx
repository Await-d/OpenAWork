import React from 'react';
import {
  buildLocalReasoningBlockKey,
  getLocalReasoningLabel,
} from './assistant-reasoning-block.helpers.js';

const reasoningOpenStateCache = new Map<string, boolean>();

export const buildReasoningBlockKey = buildLocalReasoningBlockKey;

export function resetReasoningOpenStateCacheForTests() {
  reasoningOpenStateCache.clear();
}

export function AssistantReasoningBlock({
  content,
  index,
  renderBody,
  streaming = false,
  total,
}: {
  content: string;
  index: number;
  renderBody: (content: string, streaming: boolean) => React.ReactNode;
  stateKey?: string;
  streaming?: boolean;
  total: number;
}) {
  const label = getLocalReasoningLabel({ index, streaming, total });
  const labeledContent = `*${label}* ${content}`;

  return (
    <section className="assistant-reasoning-block" data-streaming={streaming ? 'true' : 'false'}>
      <div className="assistant-reasoning-body">{renderBody(labeledContent, streaming)}</div>
    </section>
  );
}
