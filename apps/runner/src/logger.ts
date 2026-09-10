import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'secrets',
      '*.secrets',
      '*.*.secrets',
      'storageState',
      'httpCredentials',
      '*.storageState',
      '*.httpCredentials',
    ],
    censor: '[REDACTED]',
  },
  ...(config.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});
