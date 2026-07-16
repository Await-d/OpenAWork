export interface ConversationLayoutStateInput {
  readonly editorMode: boolean;
  readonly isFusionLayout: boolean;
  readonly showDockedReviewPanel: boolean;
}

export interface ConversationLayoutState {
  readonly centerContent: boolean;
  readonly contentMaxWidth: number | 'fluid';
}

export function resolveConversationLayoutState({
  editorMode,
  isFusionLayout,
  showDockedReviewPanel,
}: ConversationLayoutStateInput): ConversationLayoutState {
  if (isFusionLayout) {
    return {
      centerContent: !showDockedReviewPanel,
      contentMaxWidth: showDockedReviewPanel ? 'fluid' : 720,
    };
  }

  return {
    centerContent: true,
    contentMaxWidth: editorMode ? 720 : 1024,
  };
}
