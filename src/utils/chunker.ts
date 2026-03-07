import crypto from 'crypto';

export interface Chunk {
  content: string;
  filePath: string;
  chunkIndex: number;
  contentHash: string;
}

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_OVERLAP = 50;

export function chunkText(
  text: string,
  filePath: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_OVERLAP
): Chunk[] {
  const words = text.split(/\s+/);
  const chunks: Chunk[] = [];

  if (words.length <= chunkSize) {
    chunks.push({
      content: text,
      filePath,
      chunkIndex: 0,
      contentHash: hashContent(text),
    });
    return chunks;
  }

  let start = 0;
  let index = 0;

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    const content = words.slice(start, end).join(' ');

    chunks.push({
      content,
      filePath,
      chunkIndex: index,
      contentHash: hashContent(content),
    });

    start = end - overlap;
    index++;

    if (end >= words.length) break;
  }

  return chunks;
}

export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}
