import type { JSONSchema } from '@openAwork/skill-types';

export const EMPTY_SCHEMA = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
} satisfies JSONSchema;

export const WORKSPACE_ROOT_FIELD = {
  type: 'string',
  description: '可选工作区根目录；省略时使用当前会话工作目录。',
} satisfies JSONSchema;

export const FILE_POSITION_FIELDS = {
  filePath: { type: 'string', description: '源文件路径。' },
  line: { type: 'integer', minimum: 1, description: '1-based 行号。' },
  character: { type: 'integer', minimum: 0, description: '0-based 列号。' },
} satisfies Record<string, JSONSchema>;
