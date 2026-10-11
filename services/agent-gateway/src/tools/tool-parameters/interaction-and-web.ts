import type { ToolParameters } from './tool-parameter-schema.js';

export function buildInteractionAndWebParameters(name: string): ToolParameters | undefined {
  switch (name) {
    case 'websearch':
      return {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          maxResults: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: '返回结果数量上限',
          },
          provider: {
            type: 'string',
            enum: [
              'duckduckgo',
              'tavily',
              'exa',
              'serper',
              'searxng',
              'bocha',
              'zhipu',
              'google',
              'bing',
            ],
          },
          apiKey: { type: 'string' },
          baseUrl: { type: 'string' },
        },
        required: ['query'],
        additionalProperties: false,
      };
    case 'webfetch':
      return {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要请求的完整 URL' },
          format: {
            type: 'string',
            enum: ['markdown', 'text', 'html', 'image-preview'],
            description: '返回的响应格式',
          },
          timeout: {
            type: 'integer',
            minimum: 1,
            maximum: 120,
            description: '请求超时（秒）',
          },
        },
        required: ['url'],
        additionalProperties: false,
      };
    case 'Skill':
      return {
        type: 'object',
        properties: {
          skill: { type: 'string', description: '要执行的已安装 skill 名称' },
        },
        required: ['skill'],
        additionalProperties: false,
      };
    case 'AskUserQuestion':
      return {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                header: { type: 'string' },
                multiSelect: { type: 'boolean' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      description: { type: 'string' },
                      preview: { type: 'string' },
                    },
                    required: ['label', 'description'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['question', 'header', 'options'],
              additionalProperties: false,
            },
          },
          annotations: {
            type: 'object',
            description: '询问流程的可选元数据或 UI 标注',
          },
        },
        required: ['questions'],
        additionalProperties: false,
      };
    case 'EnterPlanMode':
      return {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      };
    case 'ExitPlanMode':
      return {
        type: 'object',
        properties: {
          allowedPrompts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                tool: { type: 'string', enum: ['Bash'] },
                prompt: { type: 'string' },
              },
              required: ['tool', 'prompt'],
              additionalProperties: false,
            },
          },
          plan: { type: 'string' },
        },
        required: [],
        additionalProperties: false,
      };
    default:
      return undefined;
  }
}
