import crypto from 'node:crypto';

interface EncryptedPayload {
  iv: string;
  tag: string;
  content: string;
}

function getEncryptionKey(): Buffer {
  const secret = process.env['CONNECTOR_CREDENTIALS_SECRET'];
  if (!secret) {
    throw new Error('CONNECTOR_CREDENTIALS_SECRET environment variable is required');
  }

  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptConnectorCredentials(credentials: Record<string, unknown>): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const serialized = Buffer.from(JSON.stringify(credentials), 'utf8');
  const encrypted = Buffer.concat([cipher.update(serialized), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    content: encrypted.toString('base64url'),
  };

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decryptConnectorCredentials(payload: string): Record<string, unknown> {
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as EncryptedPayload;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(parsed.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.content, 'base64url')),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8')) as Record<string, unknown>;
}
