export type ContextItemType = 'file' | 'url' | 'clipboard' | 'text';

export interface ContextItem {
  id: string;
  type: ContextItemType;
  label: string;
  path?: string;
  url?: string;
  content: string;
  tokenEstimate: number;
  addedAt: number;
}

export interface ContextManager {
  getItems(): ContextItem[];
  addItem(item: Omit<ContextItem, 'id' | 'addedAt'>): ContextItem;
  addFile(path: string): Promise<ContextItem>;
  addUrl(url: string): Promise<ContextItem>;
  addClipboard(content: string): Promise<ContextItem>;
  removeItem(id: string): boolean;
  clearItems(): void;
  getTotalTokenEstimate(): number;
  buildContextBlock(): string;
}
