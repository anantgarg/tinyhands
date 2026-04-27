import type { DatabaseColumnType } from '../../../types';

// Cheap type inference over a sample of cell values. We only infer logical
// types we can map to a Postgres column. Unknown / mixed → text (safe default).
export function inferColumnType(samples: unknown[]): DatabaseColumnType {
  const nonEmpty = samples
    .map(v => (v === null || v === undefined ? '' : String(v).trim()))
    .filter(s => s.length > 0);
  if (nonEmpty.length === 0) return 'text';

  const allMatch = (re: RegExp) => nonEmpty.every(v => re.test(v));

  if (allMatch(/^-?\d+$/)) {
    const asNum = nonEmpty.map(v => BigInt(v));
    const tooBig = asNum.some(n => n > 2_147_483_647n || n < -2_147_483_648n);
    return tooBig ? 'bigint' : 'integer';
  }
  if (allMatch(/^-?\d+\.\d+$/)) return 'numeric';
  if (allMatch(/^(true|false)$/i)) return 'boolean';
  if (allMatch(/^\d{4}-\d{2}-\d{2}$/)) return 'date';
  if (allMatch(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/)) return 'timestamptz';

  return 'text';
}

export function coerceValue(raw: unknown, type: DatabaseColumnType): { ok: true; value: any } | { ok: false; reason: string } {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: null };
  }
  const s = typeof raw === 'string' ? raw.trim() : raw;

  try {
    switch (type) {
      case 'text':
        return { ok: true, value: String(s) };
      case 'integer':
      case 'bigint':
        if (!/^-?\d+$/.test(String(s))) return { ok: false, reason: 'not an integer' };
        return { ok: true, value: Number(s) };
      case 'numeric':
        if (!/^-?\d+(\.\d+)?$/.test(String(s))) return { ok: false, reason: 'not a number' };
        return { ok: true, value: Number(s) };
      case 'boolean': {
        const v = String(s).toLowerCase();
        if (v === 'true' || v === '1' || v === 'yes') return { ok: true, value: true };
        if (v === 'false' || v === '0' || v === 'no') return { ok: true, value: false };
        return { ok: false, reason: 'not a boolean' };
      }
      case 'date':
      case 'timestamptz': {
        const d = new Date(String(s));
        if (isNaN(d.getTime())) return { ok: false, reason: 'not a date' };
        return { ok: true, value: d.toISOString() };
      }
      case 'json':
        if (typeof s === 'object') return { ok: true, value: JSON.stringify(s) };
        try {
          return { ok: true, value: JSON.stringify(JSON.parse(String(s))) };
        } catch {
          return { ok: false, reason: 'not valid JSON' };
        }
      default:
        return { ok: true, value: String(s) };
    }
  } catch (err: any) {
    return { ok: false, reason: err.message };
  }
}
