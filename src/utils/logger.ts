import winston from 'winston';
import { config } from '../config';
import type { StructuredLog } from '../types';

// ── Secret redaction ──

// Patterns that identify known-secret values. Keep conservative to avoid false
// positives that could hide debugging signal, but broad enough to catch the
// credential shapes this codebase actually handles.
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{10,}\b/g,            // Anthropic API key
  /\bxoxb-[A-Za-z0-9-]{10,}\b/g,               // Slack bot token
  /\bxoxp-[A-Za-z0-9-]{10,}\b/g,               // Slack user token
  /\bxapp-[A-Za-z0-9-]{10,}\b/g,               // Slack app-level token
  /\bxoxe\.xoxp-[A-Za-z0-9-]{10,}\b/g,         // Slack refresh token
  /\bghp_[A-Za-z0-9]{20,}\b/g,                 // GitHub PAT
  /\bgho_[A-Za-z0-9]{20,}\b/g,                 // GitHub OAuth
  /\bghs_[A-Za-z0-9]{20,}\b/g,                 // GitHub app secret
  /\bAKIA[A-Z0-9]{16}\b/g,                     // AWS access key id
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, // JWT
];

// Field names whose values should always be redacted, regardless of shape.
const SECRET_FIELD_NAMES = new Set<string>([
  'api_key', 'apiKey', 'anthropicApiKey', 'anthropic_api_key',
  'bot_token', 'botToken', 'access_token', 'accessToken',
  'refresh_token', 'refreshToken', 'client_secret', 'clientSecret',
  'signing_secret', 'signingSecret', 'password', 'secret', 'token',
  'encryption_key', 'encryptionKey', 'authorization', 'cookie',
  'session_secret', 'sessionSecret', 'webhook_secret', 'webhookSecret',
]);

export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[redacted: max-depth]';
  if (value == null) return value;

  if (typeof value === 'string') {
    let out = value;
    for (const pat of SECRET_VALUE_PATTERNS) out = out.replace(pat, '[REDACTED_SECRET]');
    return out;
  }

  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_FIELD_NAMES.has(k)) {
        out[k] = '[REDACTED_SECRET]';
      } else {
        out[k] = redactSecrets(v, depth + 1);
      }
    }
    return out;
  }

  return value;
}

const redactFormat = winston.format((info) => {
  const redacted = redactSecrets(info) as winston.Logform.TransformableInfo;
  return redacted;
})();

export const logger = winston.createLogger({
  level: config.observability.logLevel,
  format: winston.format.combine(
    redactFormat,
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
});

export function logRunEvent(event: StructuredLog): void {
  logger.info('run_event', { ...event });
}
