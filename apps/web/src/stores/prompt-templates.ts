import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface PromptTemplate {
  id: string;
  label: string;
  content: string;
  category?: string;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
}

interface PromptTemplateStore {
  templates: PromptTemplate[];
  addTemplate: (template: Pick<PromptTemplate, 'label' | 'content' | 'category'>) => void;
  updateTemplate: (
    id: string,
    updates: Partial<Pick<PromptTemplate, 'label' | 'content' | 'category'>>,
  ) => void;
  removeTemplate: (id: string) => void;
  incrementUsage: (id: string) => void;
  getByCategory: (category: string) => PromptTemplate[];
  reorderTemplates: (ids: string[]) => void;
}

function generateId(): string {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const usePromptTemplateStore = create<PromptTemplateStore>()(
  persist(
    (set, get) => ({
      templates: [],

      addTemplate: (template) =>
        set((state) => ({
          templates: [
            ...state.templates,
            {
              ...template,
              id: generateId(),
              createdAt: Date.now(),
              updatedAt: Date.now(),
              usageCount: 0,
            },
          ],
        })),

      updateTemplate: (id, updates) =>
        set((state) => ({
          templates: state.templates.map((t) =>
            t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t,
          ),
        })),

      removeTemplate: (id) =>
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
        })),

      incrementUsage: (id) =>
        set((state) => ({
          templates: state.templates.map((t) =>
            t.id === id ? { ...t, usageCount: t.usageCount + 1 } : t,
          ),
        })),

      getByCategory: (category) => get().templates.filter((t) => t.category === category),

      reorderTemplates: (ids) =>
        set((state) => {
          const templateMap = new Map(state.templates.map((t) => [t.id, t]));
          const reordered = ids
            .map((id) => templateMap.get(id))
            .filter((t): t is PromptTemplate => t !== undefined);
          const remaining = state.templates.filter((t) => !ids.includes(t.id));
          return { templates: [...reordered, ...remaining] };
        }),
    }),
    {
      name: 'openAwork-prompt-templates',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
