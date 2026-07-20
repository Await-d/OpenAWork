export interface ClassicConversationLayoutStateInput {
  readonly editorMode: boolean;
}

export interface FusionConversationLayoutStateInput {
  readonly showDockedReviewPanel: boolean;
}

export interface ConversationLayoutState {
  readonly centerContent: boolean;
  readonly contentMaxWidth: number | 'fluid';
}

export function resolveClassicConversationLayoutState({
  editorMode,
}: ClassicConversationLayoutStateInput): ConversationLayoutState {
  return {
    centerContent: true,
    contentMaxWidth: editorMode ? 720 : 1024,
  };
}

export function resolveFusionConversationLayoutState({
  showDockedReviewPanel,
}: FusionConversationLayoutStateInput): ConversationLayoutState {
  return {
    centerContent: !showDockedReviewPanel,
    contentMaxWidth: showDockedReviewPanel ? 'fluid' : 720,
  };
}
