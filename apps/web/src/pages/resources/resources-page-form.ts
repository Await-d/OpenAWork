import type { ResourceArea } from '@openAwork/web-client';
import { UPLOAD_RESOURCE_AREAS } from './resource-center-utils.js';

export interface UploadFormState {
  readonly status: 'idle' | 'saved';
  readonly message: string;
}

export const INITIAL_FORM_STATE: UploadFormState = { status: 'idle', message: '' };

export function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function formArea(formData: FormData): ResourceArea {
  const value = formString(formData, 'area');
  return UPLOAD_RESOURCE_AREAS.find((option) => option.value === value)?.value ?? 'prompts';
}
