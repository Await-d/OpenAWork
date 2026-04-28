import type { ToolDefinition } from '@openAwork/agent-core';
import { webSearchTool } from '@openAwork/agent-core';

export const websearchTool: ToolDefinition<
  typeof webSearchTool.inputSchema,
  typeof webSearchTool.outputSchema
> = {
  ...webSearchTool,
  name: 'websearch',
  description:
    'Search the web for current information, news, and live facts. When searching for recent information, include the current year in the query.',
};
