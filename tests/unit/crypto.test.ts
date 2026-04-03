import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config', () => ({
  config: {
    encryption: {
      key: 'a]B$c9dEf0gH1iJ2kL3mN4oP5qR6sT7u',
    },
  },
}));

import { encrypt, decrypt } from '../../src/modules/connections/crypto';

describe('encrypt', () => {
  it('should return encrypted string and iv', () => {
    const result = encrypt('hello world');

    expect(result.encrypted).toBeTruthy();
    expect(result.iv).toBeTruthy();
    expect(result.encrypted).toContain('.'); // ciphertext.authTag format
    expect(result.encrypted).not.toBe('hello world');
  });

  it('should produce different ciphertexts for same input', () => {
    const r1 = encrypt('test');
    const r2 = encrypt('test');

    // Different IVs should produce different ciphertexts
    expect(r1.iv).not.toBe(r2.iv);
    expect(r1.encrypted).not.toBe(r2.encrypted);
  });
});

describe('decrypt', () => {
  it('should decrypt back to original plaintext', () => {
    const original = 'Hello, World! Special chars: @#$%^&*()';
    const { encrypted, iv } = encrypt(original);
    const decrypted = decrypt(encrypted, iv);

    expect(decrypted).toBe(original);
  });

  it('should handle JSON payloads', () => {
    const payload = JSON.stringify({ api_key: 'sk-123', site: 'test.example.com' });
    const { encrypted, iv } = encrypt(payload);
    const decrypted = decrypt(encrypted, iv);

    expect(JSON.parse(decrypted)).toEqual({ api_key: 'sk-123', site: 'test.example.com' });
  });

  it('should handle empty strings', () => {
    const { encrypted, iv } = encrypt('');
    const decrypted = decrypt(encrypted, iv);

    expect(decrypted).toBe('');
  });

  it('should detect tampered ciphertext', () => {
    const { encrypted, iv } = encrypt('secret data');
    const [ciphertext, authTag] = encrypted.split('.');
    // Tamper with auth tag to guarantee GCM authentication failure
    const flippedTag = authTag.split('').map((c: string) => c === '0' ? '1' : '0').join('');
    const tampered = ciphertext + '.' + flippedTag;

    expect(() => decrypt(tampered, iv)).toThrow();
  });

  it('should reject invalid format (no dot separator)', () => {
    expect(() => decrypt('invalidformat', 'aabbcc')).toThrow('Invalid encrypted data format');
  });
});

describe('key validation', () => {
  it('should work with exactly 32-char key', () => {
    const { encrypted, iv } = encrypt('test');
    const decrypted = decrypt(encrypted, iv);
    expect(decrypted).toBe('test');
  });
});
