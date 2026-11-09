import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export type HrSealedValue = { version: 1; keyId: string; iv: string; tag: string; data: string };
export type HrSensitivePurpose = 'IDENTITY' | 'BANK';

function decodeKey(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new ServiceUnavailableException('HR data key is invalid');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value)
    throw new ServiceUnavailableException('HR data key is invalid');
  return key;
}

function context(employeeId: bigint, purpose: HrSensitivePurpose): Buffer {
  if (employeeId <= 0n || !['IDENTITY', 'BANK'].includes(purpose))
    throw new BadRequestException('Invalid HR data context');
  return Buffer.from(`HR2.1:${purpose}:${employeeId}`, 'utf8');
}

function onboardingIntakeContext(actorId: bigint, storeId: bigint): Buffer {
  if (actorId <= 0n || storeId <= 0n) throw new BadRequestException('Invalid HR data context');
  return Buffer.from(`HR2.1:ONBOARDING_INTAKE:${actorId}:${storeId}`, 'utf8');
}

/** This service handles small structured fields. Document images need a separate encrypted object store. */
@Injectable()
export class HrSensitiveCrypto {
  private readonly activeKeyId: string;
  private readonly keys = new Map<string, Buffer>();
  private readonly lookupKey: Buffer;

  constructor(config: { activeKeyId: string; keys: Record<string, string>; lookupKey: string }) {
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(config.activeKeyId))
      throw new ServiceUnavailableException('HR data key id is invalid');
    this.activeKeyId = config.activeKeyId;
    for (const [id, encoded] of Object.entries(config.keys)) {
      if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id))
        throw new ServiceUnavailableException('HR data key id is invalid');
      this.keys.set(id, decodeKey(encoded));
    }
    if (!this.keys.has(this.activeKeyId)) throw new ServiceUnavailableException('HR active data key is missing');
    this.lookupKey = decodeKey(config.lookupKey);
  }

  seal(employeeId: bigint, purpose: HrSensitivePurpose, value: Record<string, unknown>): HrSealedValue {
    return this.sealWithContext(context(employeeId, purpose), value);
  }

  sealOnboardingIntake(actorId: bigint, storeId: bigint, value: Record<string, unknown>): HrSealedValue {
    return this.sealWithContext(onboardingIntakeContext(actorId, storeId), value);
  }

  openOnboardingIntake(actorId: bigint, storeId: bigint, sealed: HrSealedValue): Record<string, unknown> {
    return this.openWithContext(onboardingIntakeContext(actorId, storeId), sealed);
  }

  private sealWithContext(aad: Buffer, value: Record<string, unknown>): HrSealedValue {
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    if (plaintext.length === 0 || plaintext.length > 64 * 1024)
      throw new BadRequestException('HR data payload is invalid');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeKeyId)!, iv);
    cipher.setAAD(aad);
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    plaintext.fill(0);
    return { version: 1, keyId: this.activeKeyId, iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }

  open(employeeId: bigint, purpose: HrSensitivePurpose, sealed: HrSealedValue): Record<string, unknown> {
    return this.openWithContext(context(employeeId, purpose), sealed);
  }

  private openWithContext(aad: Buffer, sealed: HrSealedValue): Record<string, unknown> {
    const key = this.keys.get(sealed?.keyId);
    if (sealed?.version !== 1 || !key || !sealed.iv || !sealed.tag || !sealed.data)
      throw new BadRequestException('HR encrypted data is unavailable');
    try {
      const iv = Buffer.from(sealed.iv, 'base64');
      const tag = Buffer.from(sealed.tag, 'base64');
      const data = Buffer.from(sealed.data, 'base64');
      if (iv.length !== 12 || tag.length !== 16 || data.length > 64 * 1024)
        throw new Error('Invalid envelope');
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
      let result: unknown;
      try { result = JSON.parse(plaintext.toString('utf8')); }
      finally { plaintext.fill(0); }
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid payload');
      return result as Record<string, unknown>;
    } catch {
      throw new BadRequestException('HR encrypted data is unavailable');
    }
  }

  identityFingerprint(idNumber: string): string {
    const normalized = idNumber.trim().toUpperCase();
    if (!/^\d{17}[\dX]$/.test(normalized)) throw new BadRequestException('Invalid identity number');
    return createHmac('sha256', this.lookupKey).update(`IDCARD:${normalized}`, 'utf8').digest('hex');
  }
}

/** Loaded only when the sensitive-intake gate is on; startup of 1.0 needs no HR keys. */
export function loadHrSensitiveCryptoFromEnv(env: NodeJS.ProcessEnv): HrSensitiveCrypto {
  const activeKeyId = env.HR_DATA_ACTIVE_KEY_ID;
  const lookupKey = env.HR_DATA_LOOKUP_KEY;
  if (!activeKeyId || !lookupKey || !env.HR_DATA_KEYS_JSON)
    throw new ServiceUnavailableException('HR data protection is not configured');
  let keys: unknown;
  try { keys = JSON.parse(env.HR_DATA_KEYS_JSON); }
  catch { throw new ServiceUnavailableException('HR data protection is not configured'); }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys))
    throw new ServiceUnavailableException('HR data protection is not configured');
  return new HrSensitiveCrypto({ activeKeyId, lookupKey, keys: keys as Record<string, string> });
}

export function maskBankCard(cardNumber: string): string {
  const digits = cardNumber.replace(/\s/g, '');
  if (!/^\d{12,25}$/.test(digits)) throw new BadRequestException('Invalid bank card number');
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}
