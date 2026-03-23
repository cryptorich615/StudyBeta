import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function getKey() {
  const secret = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? process.env.JWT_SECRET ?? 'studyclaw-dev-secret';
  return createHash('sha256').update(secret).digest();
}

export function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptToken(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const [ivRaw, tagRaw, encryptedRaw] = value.split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) {
    return value;
  }

  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
