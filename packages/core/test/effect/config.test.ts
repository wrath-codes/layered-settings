import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { Config, ConfigInput, ConfigUpdate } from "../../src/effect/config";

describe("Config", () => {
  test("valid decode with all fields", () => {
    const input = {
      id: "config-1",
      name: "My Config",
      projectType: "web",
      content: { key1: "value1" },
      ownerId: "user-1",
      isPublic: true,
      isDefault: false,
      createdAt: 1234567890,
      updatedAt: 1234567891,
    };
    const result = Schema.decodeUnknownSync(Config)(input);
    expect(result.id).toBe("config-1");
    expect(result.name).toBe("My Config");
    expect(result.projectType).toBe("web");
    expect(result.ownerId).toBe("user-1");
    expect(result.isPublic).toBe(true);
    expect(result.isDefault).toBe(false);
  });

  test("invalid: missing required fields", () => {
    const input = { id: "config-1", name: "My Config" };
    expect(() => Schema.decodeUnknownSync(Config)(input)).toThrow();
  });

  test("invalid: wrong types", () => {
    const input = {
      id: 123,
      name: "My Config",
      projectType: "web",
      content: { key1: "value1" },
      ownerId: "user-1",
      isPublic: "yes",
      isDefault: false,
      createdAt: "now",
      updatedAt: 1234567891,
    };
    expect(() => Schema.decodeUnknownSync(Config)(input)).toThrow();
  });
});

describe("ConfigInput", () => {
  test("valid decode with all fields", () => {
    const input = {
      name: "My Config",
      projectType: "web",
      content: { key1: "value1" },
      isPublic: true,
      isDefault: true,
    };
    const result = Schema.decodeUnknownSync(ConfigInput)(input);
    expect(result.name).toBe("My Config");
    expect(result.projectType).toBe("web");
    expect(result.isPublic).toBe(true);
    expect(result.isDefault).toBe(true);
  });

  test("default values: isPublic defaults to false", () => {
    const input = {
      name: "My Config",
      projectType: "web",
      content: { key1: "value1" },
    };
    const result = Schema.decodeUnknownSync(ConfigInput)(input);
    expect(result.isPublic).toBe(false);
  });

  test("default values: isDefault defaults to false", () => {
    const input = {
      name: "My Config",
      projectType: "web",
      content: { key1: "value1" },
    };
    const result = Schema.decodeUnknownSync(ConfigInput)(input);
    expect(result.isDefault).toBe(false);
  });

  test("explicit values override defaults", () => {
    const input = {
      name: "My Config",
      projectType: "web",
      content: { key1: "value1" },
      isPublic: true,
      isDefault: true,
    };
    const result = Schema.decodeUnknownSync(ConfigInput)(input);
    expect(result.isPublic).toBe(true);
    expect(result.isDefault).toBe(true);
  });

  test("invalid: missing required fields", () => {
    const input = { name: "My Config" };
    expect(() => Schema.decodeUnknownSync(ConfigInput)(input)).toThrow();
  });

  test("invalid: wrong types (name: 123)", () => {
    const input = {
      name: 123,
      projectType: "web",
      content: { key1: "value1" },
    };
    expect(() => Schema.decodeUnknownSync(ConfigInput)(input)).toThrow();
  });
});

describe("ConfigUpdate", () => {
  test("valid: partial update with only name", () => {
    const input = { name: "Updated Name" };
    const result = Schema.decodeUnknownSync(ConfigUpdate)(input);
    expect(result.name).toBe("Updated Name");
    expect(result.content).toBeUndefined();
  });

  test("valid: partial update with only content", () => {
    const input = { content: { newKey: "newValue" } };
    const result = Schema.decodeUnknownSync(ConfigUpdate)(input);
    expect(result.content).toEqual({ newKey: "newValue" });
    expect(result.name).toBeUndefined();
  });

  test("valid: empty object {}", () => {
    const input = {};
    const result = Schema.decodeUnknownSync(ConfigUpdate)(input);
    expect(result.name).toBeUndefined();
    expect(result.content).toBeUndefined();
    expect(result.isPublic).toBeUndefined();
    expect(result.isDefault).toBeUndefined();
  });

  test("omitted optional fields are undefined", () => {
    const input = { name: "Test" };
    const result = Schema.decodeUnknownSync(ConfigUpdate)(input);
    expect(result.content).toBeUndefined();
    expect(result.isPublic).toBeUndefined();
    expect(result.isDefault).toBeUndefined();
  });

  test("invalid: wrong types", () => {
    const input = { name: 123 };
    expect(() => Schema.decodeUnknownSync(ConfigUpdate)(input)).toThrow();
  });
});
