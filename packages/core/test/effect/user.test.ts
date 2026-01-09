import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { AuthenticatedUser, User, UserInput } from "../../src/effect/user";

describe("User", () => {
  test("valid decode with all fields", () => {
    const input = {
      id: "user-1",
      clerkId: "clerk-123",
      email: "test@example.com",
      name: "John Doe",
      createdAt: 1234567890,
    };
    const result = Schema.decodeUnknownSync(User)(input);
    expect(result.id).toBe("user-1");
    expect(result.clerkId).toBe("clerk-123");
    expect(result.email).toBe("test@example.com");
    expect(result.name).toBe("John Doe");
    expect(result.createdAt).toBe(1234567890);
  });

  test("invalid: missing required fields", () => {
    const input = { id: "user-1", email: "test@example.com" };
    expect(() => Schema.decodeUnknownSync(User)(input)).toThrow();
  });

  test("invalid: wrong types (createdAt as string)", () => {
    const input = {
      id: "user-1",
      clerkId: "clerk-123",
      email: "test@example.com",
      name: "John Doe",
      createdAt: "2024-01-01",
    };
    expect(() => Schema.decodeUnknownSync(User)(input)).toThrow();
  });
});

describe("AuthenticatedUser", () => {
  test("valid decode with all fields", () => {
    const input = {
      id: "user-1",
      email: "test@example.com",
      name: "John Doe",
    };
    const result = Schema.decodeUnknownSync(AuthenticatedUser)(input);
    expect(result.id).toBe("user-1");
    expect(result.email).toBe("test@example.com");
    expect(result.name).toBe("John Doe");
  });

  test("invalid: missing required fields", () => {
    const input = { id: "user-1" };
    expect(() => Schema.decodeUnknownSync(AuthenticatedUser)(input)).toThrow();
  });
});

describe("UserInput", () => {
  test("valid decode with all fields", () => {
    const input = {
      clerkId: "clerk-123",
      email: "test@example.com",
      name: "John Doe",
    };
    const result = Schema.decodeUnknownSync(UserInput)(input);
    expect(result.clerkId).toBe("clerk-123");
    expect(result.email).toBe("test@example.com");
    expect(result.name).toBe("John Doe");
  });

  test("invalid: missing email", () => {
    const input = { clerkId: "clerk-123", name: "John Doe" };
    expect(() => Schema.decodeUnknownSync(UserInput)(input)).toThrow();
  });

  test("invalid: wrong types", () => {
    const input = {
      clerkId: 123,
      email: "test@example.com",
      name: "John Doe",
    };
    expect(() => Schema.decodeUnknownSync(UserInput)(input)).toThrow();
  });
});
