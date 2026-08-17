import { LLMEvent } from '../../schema/index.js';
export const initial = () => ({ stepStarted: false, text: new Set(), reasoning: new Set() });
export const stepStart = (state, events) => {
  if (state.stepStarted) return state;
  events.push(LLMEvent.stepStart({ index: 0 }));
  return { ...state, stepStarted: true };
};
export const textDelta = (state, events, id, text) => {
  const stepped = stepStart(state, events);
  if (stepped.text.has(id)) {
    events.push(LLMEvent.textDelta({ id, text }));
    return stepped;
  }
  events.push(LLMEvent.textStart({ id }), LLMEvent.textDelta({ id, text }));
  return { ...stepped, text: new Set([...stepped.text, id]) };
};
export const reasoningStart = (state, events, id, providerMetadata) => {
  if (state.reasoning.has(id)) return state;
  const stepped = stepStart(state, events);
  events.push(LLMEvent.reasoningStart({ id, providerMetadata }));
  return { ...stepped, reasoning: new Set([...stepped.reasoning, id]) };
};
export const reasoningDelta = (state, events, id, text, providerMetadata) => {
  const started = reasoningStart(state, events, id, providerMetadata);
  events.push(LLMEvent.reasoningDelta({ id, text }));
  return started;
};
export const reasoningEnd = (state, events, id, providerMetadata) => {
  if (!state.reasoning.has(id)) return state;
  const stepped = stepStart(state, events);
  events.push(LLMEvent.reasoningEnd({ id, providerMetadata }));
  const reasoning = new Set(stepped.reasoning);
  reasoning.delete(id);
  return { ...stepped, reasoning };
};
export const textEnd = (state, events, id, providerMetadata) => {
  if (!state.text.has(id)) return state;
  const stepped = stepStart(state, events);
  events.push(LLMEvent.textEnd({ id, providerMetadata }));
  const text = new Set(stepped.text);
  text.delete(id);
  return { ...stepped, text };
};
const closeOpenBlocks = (state, events) => {
  for (const id of state.reasoning) events.push(LLMEvent.reasoningEnd({ id }));
  for (const id of state.text) events.push(LLMEvent.textEnd({ id }));
  return { ...state, text: new Set(), reasoning: new Set() };
};
export const finish = (state, events, input) => {
  const stepped = closeOpenBlocks(stepStart(state, events), events);
  events.push(
    LLMEvent.stepFinish({
      index: 0,
      reason: input.reason,
      usage: input.usage,
      providerMetadata: input.providerMetadata,
    }),
    LLMEvent.finish(input),
  );
  return { ...stepped, stepStarted: false };
};
export * as Lifecycle from './lifecycle.js';
//# sourceMappingURL=lifecycle.js.map
