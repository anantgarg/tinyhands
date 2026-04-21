/**
 * Reducto cloud parser. Workspace brings its own API key under
 * kb_api_keys.provider = 'reducto'. We POST the binary to the parse endpoint
 * and receive back structured Markdown + tables.
 */
import https from 'https';
import { logger } from '../../utils/logger';
import type { ParsedSource } from '../../types';
import { getApiKey } from '../kb-sources';

export interface ReductoInput {
  workspaceId: string;
  filename: string;
  mime: string;
  bytes: Buffer;
}

export async function parseReducto(input: ReductoInput): Promise<ParsedSource> {
  const key = await getApiKey(input.workspaceId, 'reducto');
  if (!key || !key.setup_complete) {
    throw new Error('Reducto is not configured for this workspace');
  }
  const cfg = JSON.parse(key.config_json) as { api_key: string; endpoint?: string };
  if (!cfg.api_key) throw new Error('Reducto api_key missing');

  const endpointHost = (cfg.endpoint && new URL(cfg.endpoint).hostname) || 'api.reducto.ai';
  const endpointPath = '/parse';

  // Reducto accepts multipart/form-data with the file. Build the body manually
  // to keep the request inside Node built-ins (Docker runner only ships them).
  const boundary = `tinyhands-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="document"; filename="${escapeFilename(input.filename)}"\r\n` +
    `Content-Type: ${input.mime || 'application/octet-stream'}\r\n\r\n`,
    'utf-8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
  const body = Buffer.concat([head, input.bytes, tail]);

  const res = await new Promise<{ status: number; data: any }>((resolve, reject) => {
    const req = https.request(
      {
        hostname: endpointHost,
        path: endpointPath,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.api_key}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(body.length),
          'Accept': 'application/json',
        },
      },
      (response) => {
        let buf = '';
        response.on('data', (c) => { buf += c; });
        response.on('end', () => {
          try { resolve({ status: response.statusCode || 0, data: JSON.parse(buf) }); }
          catch { resolve({ status: response.statusCode || 0, data: buf }); }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Reducto request timeout')); });
    req.write(body);
    req.end();
  });

  if (res.status >= 400) {
    throw new Error(`Reducto API error (${res.status}): ${typeof res.data === 'string' ? res.data.slice(0, 200) : JSON.stringify(res.data).slice(0, 200)}`);
  }

  const markdown: string = res.data?.markdown || res.data?.text || '';
  const tables = Array.isArray(res.data?.tables) ? res.data.tables.map((t: any) => ({
    name: t.name || t.title || undefined,
    markdown: typeof t === 'string' ? t : (t.markdown || t.html || ''),
  })) : [];

  if (!markdown && !tables.length) {
    logger.warn('Reducto returned empty result', { filename: input.filename });
  }

  return {
    markdown: markdown.slice(0, 200_000),
    tables,
    metadata: { format: 'reducto', filename: input.filename, mime: input.mime },
    parser: 'reducto',
  };
}

function escapeFilename(name: string): string {
  return name.replace(/[\r\n"\\]/g, '_');
}
