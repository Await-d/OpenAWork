import { FrontendLogger } from '@openAwork/logger';

export const logger = new FrontendLogger({
  level: 'debug',
  ringBufferSize: 200,
  prefix: 'OpenAWork',
});
