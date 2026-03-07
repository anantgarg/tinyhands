import winston from 'winston';
import { config } from '../config';
import type { StructuredLog } from '../types';

export const logger = winston.createLogger({
  level: config.observability.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

export function logRunEvent(event: StructuredLog): void {
  logger.info('run_event', { ...event });
}
