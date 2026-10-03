export type KeyGenerator = () => string;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface RandomSource {
  randomUUID?: () => string;
  getRandomValues: (array: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
}

export function randomKey(source: RandomSource = crypto): string {
  if (source.randomUUID) return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const value = hex(bytes);
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join("-");
}

export class IdempotencyKeyManager {
  readonly #generate: KeyGenerator;
  #key: string | null = null;
  #fingerprint: string | null = null;

  constructor(generate: KeyGenerator = () => randomKey()) {
    this.#generate = generate;
  }

  get currentKey(): string | null {
    return this.#key;
  }

  keyFor(fingerprint: string): string {
    if (this.#key === null || this.#fingerprint !== fingerprint) {
      this.#key = this.#generate();
      this.#fingerprint = fingerprint;
    }
    return this.#key;
  }

  reset(): void {
    this.#key = null;
    this.#fingerprint = null;
  }
}
