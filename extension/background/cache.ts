import type { Evidence } from '../../shared/types';

export interface EncryptedEvidenceRecord {
  version: 1;
  url: string;
  capturedAt: number;
  iv: string;
  ciphertext: string;
}

export interface SessionStorageLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export function cacheRecordKey(tabId: number): string {
  return `devsnitcher:evidence-cache:v1:${tabId}`;
}

export function cacheAdditionalData(tabId: number) {
  return new TextEncoder().encode(`devsnitcher-evidence-cache:v1:${tabId}`);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function isEvidenceShape(value: unknown): value is Evidence {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const env = v.environment as Record<string, unknown> | undefined;
  if (!env || typeof env !== 'object') return false;
  if (typeof env.url !== 'string' || typeof env.title !== 'string') return false;
  if (typeof env.timestamp !== 'number') return false;
  if (!Array.isArray(v.console) || !Array.isArray(v.network) || !Array.isArray(v.jsErrors)) {
    return false;
  }
  if (v.dom !== null && (typeof v.dom !== 'object' || Array.isArray(v.dom))) return false;
  if (v.screenshot !== null && (typeof v.screenshot !== 'object' || Array.isArray(v.screenshot))) {
    return false;
  }
  return true;
}

function isEncryptedEvidenceRecord(value: unknown): value is EncryptedEvidenceRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.url === 'string' &&
    typeof v.capturedAt === 'number' &&
    typeof v.iv === 'string' &&
    v.iv.length > 0 &&
    typeof v.ciphertext === 'string' &&
    v.ciphertext.length > 0
  );
}

export class EvidenceCache {
  private readonly storage: SessionStorageLike;
  private readonly getKey: () => Promise<CryptoKey>;

  constructor(storage: SessionStorageLike, getKey: () => Promise<CryptoKey>) {
    this.storage = storage;
    this.getKey = getKey;
  }

  async store(tabId: number, url: string, evidence: Evidence): Promise<void> {
    if (!Number.isFinite(tabId) || typeof url !== 'string' || !isEvidenceShape(evidence)) {
      throw new Error('Rejected malformed evidence cache write');
    }

    const key = await this.getKey();
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
    const plaintext = new TextEncoder().encode(JSON.stringify(evidence));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: cacheAdditionalData(tabId) },
      key,
      plaintext,
    );

    const record: EncryptedEvidenceRecord = {
      version: 1,
      url,
      capturedAt: Date.now(),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    };

    await this.storage.set({ [cacheRecordKey(tabId)]: record });
  }

  async load(tabId: number, expectedUrl: string): Promise<Evidence> {
    const storageKey = cacheRecordKey(tabId);
    const stored = await this.storage.get(storageKey);
    const record = stored[storageKey];

    if (!isEncryptedEvidenceRecord(record)) {
      throw new Error('No encrypted evidence cache is available for this tab');
    }

    if (record.url !== expectedUrl) {
      await this.storage.remove(storageKey);
      throw new Error('Encrypted evidence cache does not match the active page');
    }

    const key = await this.getKey();
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(record.iv),
        additionalData: cacheAdditionalData(tabId),
      },
      key,
      base64ToBytes(record.ciphertext),
    );

    const evidence = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
    if (!isEvidenceShape(evidence)) {
      throw new Error('Decrypted evidence failed validation');
    }

    return evidence;
  }

  async clear(tabId: number): Promise<void> {
    try {
      await this.storage.remove(cacheRecordKey(tabId));
    } catch {
      // storage failures must not break the caller
    }
  }
}
