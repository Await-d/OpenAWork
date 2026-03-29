export type AttachmentType = 'image' | 'audio' | 'file';

export interface Attachment {
  id: string;
  type: AttachmentType;
  name: string;
  mimeType: string;
  sizeBytes: number;
  data: Uint8Array | string;
  url?: string;
}

export interface MultimodalInputManager {
  addAttachment(file: Attachment): void;
  removeAttachment(id: string): void;
  listAttachments(): Attachment[];
  getAttachment(id: string): Attachment | undefined;
  clearAttachments(): void;
}

export class MultimodalInputManagerImpl implements MultimodalInputManager {
  private attachments = new Map<string, Attachment>();

  addAttachment(file: Attachment): void {
    this.attachments.set(file.id, file);
  }

  removeAttachment(id: string): void {
    this.attachments.delete(id);
  }

  listAttachments(): Attachment[] {
    return Array.from(this.attachments.values());
  }

  getAttachment(id: string): Attachment | undefined {
    return this.attachments.get(id);
  }

  clearAttachments(): void {
    this.attachments.clear();
  }
}
