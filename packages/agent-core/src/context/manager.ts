import fs from 'fs/promises';
import type { ContextItem, ContextManager } from './types.js';

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class ContextManagerImpl implements ContextManager {
  private items: ContextItem[] = [];

  getItems(): ContextItem[] {
    return [...this.items];
  }

  addItem(item: Omit<ContextItem, 'id' | 'addedAt'>): ContextItem {
    const newItem: ContextItem = {
      ...item,
      id: generateId(),
      addedAt: Date.now(),
    };
    this.items.push(newItem);
    return newItem;
  }

  async addFile(path: string): Promise<ContextItem> {
    const content = await fs.readFile(path, 'utf8');
    const tokenEstimate = content.length / 4;
    return this.addItem({
      type: 'file',
      label: path,
      path,
      content,
      tokenEstimate,
    });
  }

  async addUrl(url: string): Promise<ContextItem> {
    const response = await fetch(url);
    const text = await response.text();
    const content = text.slice(0, 5000);
    const tokenEstimate = content.length / 4;
    return this.addItem({
      type: 'url',
      label: url,
      url,
      content,
      tokenEstimate,
    });
  }

  async addClipboard(content: string): Promise<ContextItem> {
    return this.addItem({
      type: 'clipboard',
      label: 'Clipboard',
      content,
      tokenEstimate: content.length / 4,
    });
  }

  removeItem(id: string): boolean {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return false;
    this.items.splice(idx, 1);
    return true;
  }

  clearItems(): void {
    this.items = [];
  }

  getTotalTokenEstimate(): number {
    return this.items.reduce((sum, item) => sum + item.tokenEstimate, 0);
  }

  buildContextBlock(): string {
    if (this.items.length === 0) return '<context>\n</context>';
    const inner = this.items
      .map((item) => `<item type="${item.type}" label="${item.label}">${item.content}</item>`)
      .join('\n');
    return `<context>\n${inner}\n</context>`;
  }
}
