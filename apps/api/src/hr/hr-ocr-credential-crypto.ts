import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

export type HrOcrCredentialEnvelope = {
  version: 1;
  iv: string;
  tag: string;
  data: string;
};

export type AliyunOcrCredentials = { accessKeyId: string; accessKeySecret: string };

function encryptionKey(env: NodeJS.ProcessEnv): Buffer {
  const encoded = env.HR_OCR_CREDENTIAL_ENCRYPTION_KEY;
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded))
    throw new ServiceUnavailableException('OCR credential protection is not configured');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded)
    throw new ServiceUnavailableException('OCR credential protection is not configured');
  return key;
}

const aad = Buffer.from('HR2.1:ALIYUN_OCR_CREDENTIALS:1', 'utf8');

export function sealAliyunOcrCredentials(
  value: AliyunOcrCredentials,
  env: NodeJS.ProcessEnv,
): HrOcrCredentialEnvelope {
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv);
  cipher.setAAD(aad);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  plaintext.fill(0);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64') };
}

export function openAliyunOcrCredentials(
  sealed: unknown,
  env: NodeJS.ProcessEnv,
): AliyunOcrCredentials {
  const envelope = sealed as Partial<HrOcrCredentialEnvelope> | null;
  if (!envelope || envelope.version !== 1 || typeof envelope.iv !== 'string' ||
      typeof envelope.tag !== 'string' || typeof envelope.data !== 'string')
    throw new ServiceUnavailableException('OCR credentials are unavailable');
  try {
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const data = Buffer.from(envelope.data, 'base64');
    if (iv.length !== 12 || tag.length !== 16 || data.length > 4096)
      throw new Error('Invalid envelope');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(env), iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    let decoded: unknown;
    try { decoded = JSON.parse(plaintext.toString('utf8')); }
    finally { plaintext.fill(0); }
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Invalid credentials');
    const value = decoded as Record<string, unknown>;
    if (typeof value.accessKeyId !== 'string' || typeof value.accessKeySecret !== 'string')
      throw new Error('Invalid credentials');
    return { accessKeyId: value.accessKeyId, accessKeySecret: value.accessKeySecret };
  } catch {
    throw new ServiceUnavailableException('OCR credentials are unavailable');
  }
}
