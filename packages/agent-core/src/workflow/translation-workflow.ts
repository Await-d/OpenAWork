export type TranslationStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface TranslationTask {
  id: string;
  sourceLanguage: string;
  targetLanguage: string;
  fileName: string;
  content: string;
}

export interface TranslationResult {
  taskId: string;
  translatedContent: string;
  glossaryMatches?: number;
  status: TranslationStatus;
  completedAt: number;
}

export interface TranslationWorkflow {
  translate(task: TranslationTask): Promise<TranslationResult>;
  batchTranslate(tasks: TranslationTask[]): Promise<TranslationResult[]>;
}

export class TranslationWorkflowImpl implements TranslationWorkflow {
  constructor(private readonly callLLM: (prompt: string) => Promise<string>) {}

  async translate(task: TranslationTask): Promise<TranslationResult> {
    const metaPrompt = [
      `Translate the following ${task.sourceLanguage} text to ${task.targetLanguage}.`,
      'Return ONLY the translated text with no additional explanation.',
      `File: ${task.fileName}`,
      '',
      task.content,
    ].join('\n');

    const translated = await this.callLLM(metaPrompt);
    return {
      taskId: task.id,
      translatedContent: translated.trim(),
      status: 'completed',
      completedAt: Date.now(),
    };
  }

  async batchTranslate(tasks: TranslationTask[]): Promise<TranslationResult[]> {
    return Promise.all(tasks.map((task) => this.translate(task)));
  }
}
