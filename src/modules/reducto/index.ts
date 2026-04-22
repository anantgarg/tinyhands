/**
 * Reducto integration — optional high-fidelity document parsing.
 *
 * Reducto is a third-party document-parsing service that materially
 * outperforms local parsers on messy PDFs and scanned documents. Admins
 * opt in per workspace by pasting an API key and flipping the enable
 * toggle in Settings → Document Parsing. The key is encrypted at rest
 * alongside the Anthropic key.
 *
 * Security invariant: we never send bytes to Reducto unless both
 * `reducto_enabled === 'true'` AND a decryptable key is present. Callers
 * should gate on `isReductoEnabledAndConfigured(workspaceId)` before
 * handing us sensitive content.
 *
 * ── API Contract (pinned from https://docs.reducto.ai, verified 2026-04) ──
 *
 *  - Base URL:     https://platform.reducto.ai
 *  - Auth header:  Authorization: Bearer <REDUCTO_API_KEY>
 *  - Two-step flow:
 *      1. POST /upload  (multipart/form-data, field `file`)
 *         → { "file_id": "reducto://<opaque>" }
 *         Direct upload cap: 100 MB. (Larger files require the
 *         /upload/large-files presigned flow, out of scope for this plan.)
 *      2. POST /parse   (JSON: { "input": "reducto://<id>" })
 *         Synchronous — returns ParseResponse in the HTTP response.
 *         Extracted markdown at:   result.result.chunks[].content
 *  - Async fallback: POST /parse_async → { job_id }, poll GET /job/{id}
 *    until status === 'Completed' | 'Failed' | 'Idle'. We flip to this
 *    only when the sync /parse exceeds REDUCTO_SYNC_TIMEOUT_MS.
 *  - Rate limits: 200 concurrent sync requests across /parse, 500 rps.
 *    We enforce a per-workspace concurrency guard (REDUCTO_MAX_CONCURRENT)
 *    to stay well below both during bulk re-parse.
 *  - Refs: https://docs.reducto.ai/api-reference/parse
 *          https://docs.reducto.ai/api-reference/upload
 *          https://docs.reducto.ai/api-reference/async-parse
 */

import { encrypt, decrypt } from '../connections/crypto';
import { getSetting, setSetting } from '../workspace-settings';
import { logger } from '../../utils/logger';
import type { ParseInput, ParseResult } from '../kb-sources/parsers/types';
import { truncateText } from '../kb-sources/parsers/types';

const KEY_NAME = 'reducto_api_key';
const IV_NAME = 'reducto_api_key_iv';
const ENABLED_NAME = 'reducto_enabled';

const DEFAULT_BASE_URL = 'https://platform.reducto.ai';

// 100 MB direct-upload cap, per Reducto's /upload docs. Files above this
// fall back to the local parser with a warning. The /upload/large-files
// presigned flow for files up to 5 GB is deferred to a future plan.
export const REDUCTO_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

// Timeouts — sync parse has a generous 60s window before we flip the file
// over to /parse_async; the async poll then gives it another 2 minutes.
const REDUCTO_SYNC_TIMEOUT_MS = 60_000;
const REDUCTO_ASYNC_POLL_MS = 3_000;
const REDUCTO_ASYNC_TIMEOUT_MS = 120_000;
const REDUCTO_UPLOAD_TIMEOUT_MS = 120_000;

// Per-workspace concurrency guard — bulk re-parse can fan out dozens of
// files at once; this keeps us well below Reducto's 200-concurrent limit
// and also limits damage from a pathological source.
const REDUCTO_MAX_CONCURRENT = 8;

function reductoBaseUrl(): string {
  return process.env.REDUCTO_API_URL || DEFAULT_BASE_URL;
}

export interface ReductoStatus {
  enabled: boolean;
  configured: boolean;
}

export async function getReductoStatus(workspaceId: string): Promise<ReductoStatus> {
  const [encrypted, enabled] = await Promise.all([
    getSetting(workspaceId, KEY_NAME),
    getSetting(workspaceId, ENABLED_NAME),
  ]);
  return {
    configured: !!encrypted,
    enabled: enabled === 'true' && !!encrypted,
  };
}

export async function isReductoEnabledAndConfigured(workspaceId: string): Promise<boolean> {
  const status = await getReductoStatus(workspaceId);
  return status.enabled && status.configured;
}

export async function getReductoApiKey(workspaceId: string): Promise<string | null> {
  const [encrypted, iv] = await Promise.all([
    getSetting(workspaceId, KEY_NAME),
    getSetting(workspaceId, IV_NAME),
  ]);
  if (!encrypted || !iv) return null;
  try {
    return decrypt(encrypted, iv);
  } catch (err: any) {
    logger.error('Failed to decrypt Reducto key', { workspaceId, error: err.message });
    return null;
  }
}

export async function setReductoApiKey(workspaceId: string, apiKey: string, updatedBy?: string): Promise<void> {
  const { encrypted, iv } = encrypt(apiKey);
  await setSetting(workspaceId, KEY_NAME, encrypted, updatedBy);
  await setSetting(workspaceId, IV_NAME, iv, updatedBy);
  logger.info('Reducto API key set', { workspaceId, updatedBy });
}

export async function setReductoEnabled(workspaceId: string, enabled: boolean, updatedBy?: string): Promise<void> {
  await setSetting(workspaceId, ENABLED_NAME, enabled ? 'true' : 'false', updatedBy);
}

/**
 * Validate a candidate Reducto API key by doing a lightweight /upload
 * against a 4-byte fixture. The `/parse` endpoint would burn credits on
 * every test click; `/upload` alone is free and confirms auth is good.
 * Never throws — returns `{ ok, reason }` so the admin sees a friendly
 * explanation when the key is bad.
 */
export async function testReductoApiKey(apiKey: string): Promise<{ ok: boolean; reason?: string }> {
  if (!apiKey || apiKey.length < 8) {
    return { ok: false, reason: 'Key is empty or too short.' };
  }
  try {
    const form = new FormData();
    const blob = new Blob([Buffer.from('test')], { type: 'text/plain' });
    form.append('file', blob, 'tinyhands-probe.txt');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(`${reductoBaseUrl()}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'Reducto rejected the key (unauthorized).' };
    return { ok: false, reason: `Reducto returned ${res.status}. Check the key and try again.` };
  } catch (err: any) {
    if (err.name === 'AbortError') return { ok: false, reason: 'Reducto timed out after 15s.' };
    return { ok: false, reason: `Network error reaching Reducto: ${err.message}` };
  }
}

// ── Concurrency guard ──
//
// Per-workspace in-flight counter. The bulk re-parse path can enqueue many
// files at once; this caps the number simultaneously talking to Reducto.

const inFlight = new Map<string, number>();
const waiters = new Map<string, Array<() => void>>();

async function acquireReductoSlot(workspaceId: string): Promise<void> {
  const current = inFlight.get(workspaceId) ?? 0;
  if (current < REDUCTO_MAX_CONCURRENT) {
    inFlight.set(workspaceId, current + 1);
    return;
  }
  await new Promise<void>((resolve) => {
    const q = waiters.get(workspaceId) ?? [];
    q.push(resolve);
    waiters.set(workspaceId, q);
  });
  inFlight.set(workspaceId, (inFlight.get(workspaceId) ?? 0) + 1);
}

function releaseReductoSlot(workspaceId: string): void {
  const current = inFlight.get(workspaceId) ?? 1;
  inFlight.set(workspaceId, Math.max(0, current - 1));
  const q = waiters.get(workspaceId);
  if (q && q.length > 0) {
    const next = q.shift()!;
    waiters.set(workspaceId, q);
    // Release one slot to the next waiter — they'll re-increment inFlight
    // in their acquire() epilogue. We decrement here to avoid racing that.
    inFlight.set(workspaceId, Math.max(0, (inFlight.get(workspaceId) ?? 0) - 1));
    next();
  }
}

/**
 * Parse a document via Reducto's two-step upload→parse flow. Returns the
 * same shape as the local parsers so callers can treat them interchangeably.
 * Throws on any non-2xx response or network error — the caller (parser
 * dispatcher) catches and falls back to the local parser.
 */
export async function parseWithReducto(input: ParseInput): Promise<ParseResult> {
  const apiKey = await getReductoApiKey(input.workspaceId);
  if (!apiKey) throw new Error('Reducto key not configured for this workspace');

  const enabled = await getSetting(input.workspaceId, ENABLED_NAME);
  if (enabled !== 'true') {
    // Defense in depth — the dispatcher already gates on this, but never let
    // a stale toggle leak bytes to the vendor.
    throw new Error('Reducto is not enabled for this workspace');
  }

  if (input.bytes.length > REDUCTO_MAX_UPLOAD_BYTES) {
    throw new Error(
      `file is ${(input.bytes.length / 1024 / 1024).toFixed(1)} MB, larger than Reducto's 100 MB direct-upload cap`,
    );
  }

  await acquireReductoSlot(input.workspaceId);
  try {
    const fileId = await uploadToReducto(input, apiKey);
    const payload = await parseWithFileId(fileId, apiKey);
    const raw = extractReductoText(payload);
    if (!raw.trim()) throw new Error('Reducto returned empty text');
    const { text, truncated } = truncateText(raw);
    const warnings: string[] = [];
    if (truncated) warnings.push(`${input.filename}: Reducto text too large — truncated to ${text.length.toLocaleString()} chars`);
    const usage = payload?.usage ?? payload?.result?.usage;
    return {
      text,
      warnings,
      metadata: {
        parser: 'reducto',
        ...(usage ? { reductoUsage: usage } : {}),
      },
    };
  } finally {
    releaseReductoSlot(input.workspaceId);
  }
}

async function uploadToReducto(input: ParseInput, apiKey: string): Promise<string> {
  const form = new FormData();
  const blob = new Blob([input.bytes], { type: input.mimeType || 'application/octet-stream' });
  form.append('file', blob, input.filename);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REDUCTO_UPLOAD_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${reductoBaseUrl()}/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Reducto /upload ${res.status}: ${body.slice(0, 200)}`);
  }
  const payload = await res.json().catch(() => null) as { file_id?: string } | null;
  if (!payload?.file_id) throw new Error('Reducto /upload response missing file_id');
  return payload.file_id;
}

async function parseWithFileId(fileId: string, apiKey: string): Promise<ReductoParseResponse> {
  // Synchronous first. If it exceeds our timeout we switch the same file
  // to /parse_async and poll until it's done or we give up.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REDUCTO_SYNC_TIMEOUT_MS);
  try {
    const res = await fetch(`${reductoBaseUrl()}/parse`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: fileId }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Reducto /parse ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json().catch(() => null)) as ReductoParseResponse;
  } catch (err: any) {
    clearTimeout(timeout);
    // Sync parse took too long (or the connection dropped while the server
    // was still chewing on the doc). Retry the same file_id via async and
    // poll until completion — this gives complex documents a longer budget
    // without tying up our socket.
    if (err?.name === 'AbortError' || /timeout/i.test(err?.message || '')) {
      logger.info('Reducto /parse timed out; switching to /parse_async', { fileId });
      return await parseAsyncAndPoll(fileId, apiKey);
    }
    throw err;
  }
}

async function parseAsyncAndPoll(fileId: string, apiKey: string): Promise<ReductoParseResponse> {
  const res = await fetch(`${reductoBaseUrl()}/parse_async`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: fileId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Reducto /parse_async ${res.status}: ${body.slice(0, 200)}`);
  }
  const kick = await res.json().catch(() => null) as { job_id?: string } | null;
  const jobId = kick?.job_id;
  if (!jobId) throw new Error('Reducto /parse_async response missing job_id');

  const deadline = Date.now() + REDUCTO_ASYNC_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(REDUCTO_ASYNC_POLL_MS);
    const pollRes = await fetch(`${reductoBaseUrl()}/job/${encodeURIComponent(jobId)}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollRes.ok) {
      const body = await pollRes.text().catch(() => '');
      throw new Error(`Reducto /job ${pollRes.status}: ${body.slice(0, 200)}`);
    }
    const job = await pollRes.json().catch(() => null) as ReductoJobResponse | null;
    if (!job) continue;
    if (job.status === 'Completed' && job.result) {
      // /job/{id} wraps the ParseResponse in .result — unwrap for callers.
      return job.result;
    }
    if (job.status === 'Failed') {
      throw new Error(`Reducto async job failed: ${job.error || 'unknown error'}`);
    }
    // Pending | Idle → keep polling.
  }
  throw new Error(`Reducto async job timed out after ${REDUCTO_ASYNC_TIMEOUT_MS / 1000}s`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface ReductoParseResponse {
  result?: {
    type?: string;
    content?: string;
    chunks?: Array<{ content?: string; text?: string; blocks?: Array<{ content?: string }> }>;
    usage?: unknown;
  };
  usage?: unknown;
  text?: string;
  content?: string;
}

interface ReductoJobResponse {
  status: 'Pending' | 'Completed' | 'Failed' | 'Idle';
  result?: ReductoParseResponse;
  error?: string;
}

function extractReductoText(payload: ReductoParseResponse | null): string {
  if (!payload) return '';
  if (typeof payload.text === 'string' && payload.text) return payload.text;
  if (typeof payload.content === 'string' && payload.content) return payload.content;
  const result = payload.result;
  if (!result) return '';
  if (typeof result.content === 'string' && result.content) return result.content;
  const chunks = result.chunks || [];
  const parts: string[] = [];
  for (const c of chunks) {
    if (typeof c.content === 'string' && c.content) { parts.push(c.content); continue; }
    if (typeof c.text === 'string' && c.text) { parts.push(c.text); continue; }
    for (const b of c.blocks || []) {
      if (typeof b.content === 'string' && b.content) parts.push(b.content);
    }
  }
  return parts.join('\n\n');
}
