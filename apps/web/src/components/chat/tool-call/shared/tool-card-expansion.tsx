import { createContext, useContext, type ReactNode } from 'react';

/**
 * Marks a subtree as living inside an *expanded* tool-call card body.
 *
 * The outer card is the only disclosure control a user should need: once it
 * is open, every nested output renderer (line-cap toggles, `显示全部`
 * buttons, fade masks, `<details>` drawers) must render its full content
 * instead of asking for a second click.
 *
 * Providers always set the value to `true` because they only wrap a body
 * that is rendered when the card is already expanded. Components used
 * outside any provider keep their standalone collapse behaviour.
 */
export const ToolCardExpansionContext = createContext(false);

export function ToolCardExpansionProvider({ children }: { children: ReactNode }) {
  return <ToolCardExpansionContext value={true}>{children}</ToolCardExpansionContext>;
}

/** True when rendered inside an expanded tool-call card body. */
export function useIsInsideExpandedToolCard(): boolean {
  return useContext(ToolCardExpansionContext);
}
