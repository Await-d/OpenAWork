export const COMPOSER_REFERENCE_EVENT_NAME = 'openawork:composer-reference';

export interface ComposerReferenceEventDetail {
  text: string;
}

export function dispatchComposerReference(text: string): void {
  window.dispatchEvent(
    new CustomEvent<ComposerReferenceEventDetail>(COMPOSER_REFERENCE_EVENT_NAME, {
      detail: { text },
    }),
  );
}

export function isComposerReferenceEvent(
  event: Event,
): event is CustomEvent<ComposerReferenceEventDetail> {
  if (!(event instanceof CustomEvent)) {
    return false;
  }

  const detail = event.detail as Partial<ComposerReferenceEventDetail> | null;
  return typeof detail?.text === 'string';
}
