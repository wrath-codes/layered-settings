import { describe, expect, test } from "bun:test";
import {
  AuthError,
  ConfigNotFound,
  ConvexError,
  PermissionDenied,
  UserNotFound,
  ValidationError,
} from "../../src/effect/errors";

describe("TaggedError Behavior", () => {
  test('ConfigNotFound has correct _tag: "ConfigNotFound"', () => {
    const error = new ConfigNotFound({ id: "config-1" });
    expect(error._tag).toBe("ConfigNotFound");
  });

  test('UserNotFound has correct _tag: "UserNotFound"', () => {
    const error = new UserNotFound({ id: "user-1" });
    expect(error._tag).toBe("UserNotFound");
  });

  test('PermissionDenied has correct _tag: "PermissionDenied"', () => {
    const error = new PermissionDenied({ resource: "config", action: "write" });
    expect(error._tag).toBe("PermissionDenied");
  });

  test('ValidationError has correct _tag: "ValidationError"', () => {
    const error = new ValidationError({ field: "email", message: "Invalid email" });
    expect(error._tag).toBe("ValidationError");
  });

  test('AuthError has correct _tag: "AuthError"', () => {
    const error = new AuthError({ message: "Unauthorized" });
    expect(error._tag).toBe("AuthError");
  });

  test('ConvexError has correct _tag: "ConvexError"', () => {
    const error = new ConvexError({ message: "Database error" });
    expect(error._tag).toBe("ConvexError");
  });
});

describe("Field Access", () => {
  test("ConfigNotFound.id is accessible", () => {
    const error = new ConfigNotFound({ id: "config-123" });
    expect(error.id).toBe("config-123");
  });

  test("UserNotFound.id is accessible", () => {
    const error = new UserNotFound({ id: "user-456" });
    expect(error.id).toBe("user-456");
  });

  test("PermissionDenied.resource and .action accessible", () => {
    const error = new PermissionDenied({ resource: "settings", action: "delete" });
    expect(error.resource).toBe("settings");
    expect(error.action).toBe("delete");
  });

  test("ValidationError.field and .message accessible", () => {
    const error = new ValidationError({ field: "name", message: "Name is required" });
    expect(error.field).toBe("name");
    expect(error.message).toBe("Name is required");
  });

  test("AuthError.message accessible", () => {
    const error = new AuthError({ message: "Token expired" });
    expect(error.message).toBe("Token expired");
  });

  test("ConvexError.message accessible", () => {
    const error = new ConvexError({ message: "Connection failed" });
    expect(error.message).toBe("Connection failed");
  });
});
