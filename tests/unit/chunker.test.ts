import { describe, it, expect } from 'vitest';
import { chunkText, hashContent } from '../../src/utils/chunker';

describe('Chunker', () => {
  it('should return single chunk for small text', () => {
    const chunks = chunkText('Hello world', 'test.md');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Hello world');
    expect(chunks[0].filePath).toBe('test.md');
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it('should split large text into overlapping chunks', () => {
    const words = Array.from({ length: 1200 }, (_, i) => `word${i}`);
    const text = words.join(' ');
    const chunks = chunkText(text, 'large.md', 500, 50);

    expect(chunks.length).toBeGreaterThan(1);
    // Verify overlap — last words of chunk 0 should appear in chunk 1
    const chunk0Words = chunks[0].content.split(' ');
    const chunk1Words = chunks[1].content.split(' ');
    const overlapWords = chunk0Words.slice(-50);
    expect(chunk1Words.slice(0, 50)).toEqual(overlapWords);
  });

  it('should produce deterministic hashes', () => {
    const hash1 = hashContent('test content');
    const hash2 = hashContent('test content');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(16);
  });

  it('should produce different hashes for different content', () => {
    const hash1 = hashContent('content A');
    const hash2 = hashContent('content B');
    expect(hash1).not.toBe(hash2);
  });
});
