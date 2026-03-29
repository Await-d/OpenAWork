export type AttributionStyle = 'assisted-by' | 'co-authored-by' | 'none';

export interface AttributionConfig {
  style: AttributionStyle;
  appName: string;
  appEmail?: string;
  includeModelName: boolean;
  generatedWith: boolean;
}

export interface AttributionManager {
  generateTrailer(modelId: string, config: AttributionConfig): string;
  applyToCommitMessage(message: string, modelId: string, config: AttributionConfig): string;
  applyToPRBody(body: string, modelId: string, config: AttributionConfig): string;
}

const DEFAULT_CONFIG: AttributionConfig = {
  style: 'assisted-by',
  appName: 'OpenAWork',
  includeModelName: true,
  generatedWith: true,
};

export class AttributionManagerImpl implements AttributionManager {
  generateTrailer(modelId: string, config: AttributionConfig): string {
    if (config.style === 'none') return '';

    const modelPart = config.includeModelName ? ` ${modelId}` : '';
    const emailPart = config.appEmail ? ` <${config.appEmail}>` : '';
    const via = `${config.appName}${emailPart}`;

    if (config.style === 'assisted-by') {
      return `Assisted-by:${modelPart} via ${via}`;
    }
    return `Co-Authored-By:${modelPart} via ${via}`;
  }

  applyToCommitMessage(message: string, modelId: string, config: AttributionConfig): string {
    if (config.style === 'none') return message;
    const trailer = this.generateTrailer(modelId, config);
    const prefix = config.generatedWith ? `Generated with ${config.appName}\n\n` : '';
    const base = message.trimEnd();
    return `${prefix}${base}\n\n${trailer}`;
  }

  applyToPRBody(body: string, modelId: string, config: AttributionConfig): string {
    if (config.style === 'none') return body;
    const trailer = this.generateTrailer(modelId, config);
    const prefix = config.generatedWith ? `> Generated with ${config.appName}\n\n` : '';
    return `${prefix}${body.trimEnd()}\n\n---\n${trailer}`;
  }
}

export { DEFAULT_CONFIG as DEFAULT_ATTRIBUTION_CONFIG };
