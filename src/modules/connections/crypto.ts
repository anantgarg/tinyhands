import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from '../../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey(): Buffer {
  const raw = config.encryption.key;
  if (!raw || raw.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 characters');
  }
  return Buffer.from(raw.slice(0, 32), 'utf8');
}

export function encrypt(plaintext: string): { encrypted: string; iv: string } {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encrypted: encrypted + '.' + authTag,
    iv: iv.toString('hex'),
  };
}

export function decrypt(encrypted: string, iv: string): string {
  const key = getKey();
  const dotIndex = encrypted.indexOf('.');
  if (dotIndex === -1) {
    throw new Error('Invalid encrypted data format');
  }
  const ciphertext = encrypted.slice(0, dotIndex);
  const authTagHex = encrypted.slice(dotIndex + 1);
  if (!authTagHex) {
    throw new Error('Invalid encrypted data format');
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
