/**
 * LlamaParse cloud parser. Polling-based: upload → job id → poll for result.
 * Workspace key under kb_api_keys.provider = 'llamaparse'.
 */
import https from 'https';
import { logger } from '../../utils/logger';
import type { ParsedSource } from '../../types';
import { getApiKey } from '../kb-sources';

export interface LlamaParseInput {
  workspaceId: string;
  filename: string;
  mime: string;
  bytes: Buffer;
}

export async function parseLlamaParse(input: LlamaParseInput): Promise<ParsedSource> {
  const key = await getApiKey(input.workspaceId, 'llamaparse');
  if (!key || !key.setup_complete) {
    throw new Error('LlamaParse is not configured for this workspace');
  }
  const cfg = JSON.parse(key.config_json) as { api_key: string };
  if (!cfg.api_key) throw new Error('LlamaParse api_key missing');

  const host = 'api.cloud.llamaindex.ai';

  // Upload
  const boundary = `tinyhands-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${escapeFilename(input.filename)}"\r\n` +
    `Content-Type: ${input.mime || 'application/octet-stream'}\r\n\r\n`,
    'utf-8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
  const uploadBody = Buffer.concat([head, input.bytes, tail]);

  const upload = await httpsRequest(host, '/api/parsing/upload', 'POST', {
    'Authorization': `Bearer ${cfg.api_key}`,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': String(uploadBody.length),
    'Accept': 'application/json',
  }, uploadBody);

  if (upload.status >= 400) {
    throw new Error(`LlamaParse upload failed (${upload.status}): ${stringify(upload.data)}`);
  }
  const jobId: string = upload.data?.id;
  if (!jobId) throw new Error('LlamaParse did not return a job id');

  // Poll for completion
  const deadline = Date.now() + 180_000; // 3 minutes
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const status = await httpsRequest(host, `/api/parsing/job/${jobId}`, 'GET', {
      'Authorization': `Bearer ${cfg.api_key}`,
      'Accept': 'application/json',
    });
    if (status.data?.status === 'SUCCESS') break;
    if (status.data?.status === 'ERROR') {
      throw new Error(`LlamaParse job failed: ${stringify(status.data)}`);
    }
  }

  // Fetch markdown result
  const result = await httpsRequest(host, `/api/parsing/job/${jobId}/result/markdown`, 'GET', {
    'Authorization': `Bearer ${cfg.api_key}`,
    'Accept': 'application/json',
  });
  if (result.status >= 400) {
    throw new Error(`LlamaParse result fetch failed (${result.status}): ${stringify(result.data)}`);
  }
  const markdown: string = (typeof result.data === 'string' ? result.data : result.data?.markdown) || '';

  if (!markdown) {
    logger.warn('LlamaParse returned empty markdown', { filename: input.filename, jobId });
  }

  return {
    markdown: markdown.slice(0, 200_000),
    tables: [],
    metadata: { format: 'llamaparse', filename: input.filename, mime: input.mime, jobId },
    parser: 'llamaparse',
  };
}

function httpsRequest(
  hostname: string,
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: Buffer,
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method, headers }, (response) => {
      let buf = '';
      response.on('data', (c) => { buf += c; });
      response.on('end', () => {
        try { resolve({ status: response.statusCode || 0, data: JSON.parse(buf) }); }
        catch { resolve({ status: response.statusCode || 0, data: buf }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('LlamaParse request timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function stringify(data: any): string {
  if (typeof data === 'string') return data.slice(0, 200);
  try { return JSON.stringify(data).slice(0, 200); } catch { return String(data).slice(0, 200); }
}

function escapeFilename(name: string): string {
  return name.replace(/[\r\n"\\]/g, '_');
}
