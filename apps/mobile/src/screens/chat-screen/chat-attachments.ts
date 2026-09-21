import type { MobileAttachmentItem } from '../../components/MobileAttachmentBar';

export function inferMimeTypeFromFileName(fileName: string): string | undefined {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lowerName.endsWith('.png')) {
    return 'image/png';
  }
  if (lowerName.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lowerName.endsWith('.gif')) {
    return 'image/gif';
  }
  return undefined;
}

export function resolveAttachmentMimeType(input: {
  mimeType?: string;
  name: string;
}): string | undefined {
  const mimeType = input.mimeType || inferMimeTypeFromFileName(input.name);
  return mimeType?.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mimeType;
}

export function inferAttachmentType(input: {
  mimeType?: string;
  name: string;
}): MobileAttachmentItem['type'] {
  const mimeType = resolveAttachmentMimeType(input);
  if (mimeType?.startsWith('image/')) {
    return 'image';
  }
  if (mimeType?.startsWith('audio/')) {
    return 'audio';
  }
  return 'file';
}
