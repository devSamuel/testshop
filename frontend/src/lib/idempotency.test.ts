import { describe, expect, it } from "vitest";
import { IdempotencyKeyManager, randomKey } from "./idempotency";

function sequentialKeys() {
  let counter = 0;
  return () => {
    counter += 1;
    return `key-${counter}`;
  };
}

describe("IdempotencyKeyManager", () => {
  it("returns the same key for retries of the same payload", () => {
    const keys = new IdempotencyKeyManager(sequentialKeys());
    const first = keys.keyFor("payload-a");
    expect(keys.keyFor("payload-a")).toBe(first);
    expect(keys.keyFor("payload-a")).toBe(first);
    expect(keys.currentKey).toBe(first);
  });

  it("rotates the key when the payload changes", () => {
    const keys = new IdempotencyKeyManager(sequentialKeys());
    const first = keys.keyFor("payload-a");
    const second = keys.keyFor("payload-b");
    expect(second).not.toBe(first);
    expect(keys.keyFor("payload-a")).not.toBe(first);
  });

  it("rotates the key after a reset, even for an identical payload", () => {
    const keys = new IdempotencyKeyManager(sequentialKeys());
    const first = keys.keyFor("payload-a");
    keys.reset();
    expect(keys.currentKey).toBeNull();
    expect(keys.keyFor("payload-a")).not.toBe(first);
  });

  it("uses UUIDs by default", () => {
    const keys = new IdempotencyKeyManager();
    expect(keys.keyFor("x")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("randomKey", () => {
  it("prefers crypto.randomUUID when available", () => {
    expect(randomKey({ randomUUID: () => "fixed", getRandomValues: (array) => array })).toBe(
      "fixed",
    );
  });

  it("builds an RFC 4122 v4 UUID from random bytes in insecure contexts", () => {
    const key = randomKey({
      getRandomValues: (array) => {
        array.fill(0xff);
        return array;
      },
    });
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
