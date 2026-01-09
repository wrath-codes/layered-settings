import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { AccessLevel, SharedConfig, ShareInput } from "../../src/effect/share";

describe("AccessLevel", () => {
  test('"read" is valid', () => {
    const result = Schema.decodeUnknownSync(AccessLevel)("read");
    expect(result).toBe("read");
  });

  test('"write" is valid', () => {
    const result = Schema.decodeUnknownSync(AccessLevel)("write");
    expect(result).toBe("write");
  });

  test('"admin" is invalid', () => {
    expect(() => Schema.decodeUnknownSync(AccessLevel)("admin")).toThrow();
  });

  test('"READ" (uppercase) is invalid', () => {
    expect(() => Schema.decodeUnknownSync(AccessLevel)("READ")).toThrow();
  });
});

describe("SharedConfig", () => {
  test('valid decode with accessLevel: "read"', () => {
    const input = {
      configId: "config-1",
      userId: "user-1",
      accessLevel: "read",
    };
    const result = Schema.decodeUnknownSync(SharedConfig)(input);
    expect(result.configId).toBe("config-1");
    expect(result.userId).toBe("user-1");
    expect(result.accessLevel).toBe("read");
  });

  test('valid decode with accessLevel: "write"', () => {
    const input = {
      configId: "config-1",
      userId: "user-1",
      accessLevel: "write",
    };
    const result = Schema.decodeUnknownSync(SharedConfig)(input);
    expect(result.accessLevel).toBe("write");
  });

  test("invalid: wrong accessLevel", () => {
    const input = {
      configId: "config-1",
      userId: "user-1",
      accessLevel: "admin",
    };
    expect(() => Schema.decodeUnknownSync(SharedConfig)(input)).toThrow();
  });
});

describe("ShareInput", () => {
  test("valid decode with all fields", () => {
    const input = {
      configId: "config-1",
      userId: "user-1",
      accessLevel: "read",
    };
    const result = Schema.decodeUnknownSync(ShareInput)(input);
    expect(result.configId).toBe("config-1");
    expect(result.userId).toBe("user-1");
    expect(result.accessLevel).toBe("read");
  });

  test("invalid: missing required fields", () => {
    const input = { configId: "config-1" };
    expect(() => Schema.decodeUnknownSync(ShareInput)(input)).toThrow();
  });

  test("invalid: wrong accessLevel", () => {
    const input = {
      configId: "config-1",
      userId: "user-1",
      accessLevel: "admin",
    };
    expect(() => Schema.decodeUnknownSync(ShareInput)(input)).toThrow();
  });
});
