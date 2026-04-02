/**
 * Abstracted file storage — currently uses PostgreSQL BYTEA,
 * but the interface is designed to be swapped to S3/filesystem later.
 */
import { v4 as uuid } from 'uuid';
import { execute, queryOne } from '../../db';
import type { PoolClient } from 'pg';

export async function storeFile(documentId: string, data: Buffer, client?: PoolClient): Promise<void> {
  if (client) {
    await client.query(
      'INSERT INTO document_files (id, document_id, data) VALUES ($1, $2, $3)',
      [uuid(), documentId, data]
    );
  } else {
    await execute(
      'INSERT INTO document_files (id, document_id, data) VALUES ($1, $2, $3)',
      [uuid(), documentId, data]
    );
  }
}

export async function getFile(documentId: string, client?: PoolClient): Promise<Buffer | null> {
  if (client) {
    const result = await client.query(
      'SELECT data FROM document_files WHERE document_id = $1 ORDER BY created_at DESC LIMIT 1',
      [documentId]
    );
    return result.rows[0]?.data ?? null;
  }
  const row = await queryOne<any>(
    'SELECT data FROM document_files WHERE document_id = $1 ORDER BY created_at DESC LIMIT 1',
    [documentId]
  );
  return row?.data ?? null;
}

export async function deleteFile(documentId: string, client?: PoolClient): Promise<void> {
  if (client) {
    await client.query('DELETE FROM document_files WHERE document_id = $1', [documentId]);
  } else {
    await execute('DELETE FROM document_files WHERE document_id = $1', [documentId]);
  }
}
