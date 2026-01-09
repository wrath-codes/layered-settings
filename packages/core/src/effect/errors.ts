import { Schema } from "effect";

export class ConfigNotFound extends Schema.TaggedError<ConfigNotFound>()(
  "ConfigNotFound",
  {
    id: Schema.String,
  }
) {}

export class UserNotFound extends Schema.TaggedError<UserNotFound>()(
  "UserNotFound",
  {
    id: Schema.String,
  }
) {}

export class PermissionDenied extends Schema.TaggedError<PermissionDenied>()(
  "PermissionDenied",
  {
    resource: Schema.String,
    action: Schema.String,
  }
) {}

export class ValidationError extends Schema.TaggedError<ValidationError>()(
  "ValidationError",
  {
    field: Schema.String,
    message: Schema.String,
  }
) {}

export class AuthError extends Schema.TaggedError<AuthError>()(
  "AuthError",
  {
    message: Schema.String,
  }
) {}

export class ConvexError extends Schema.TaggedError<ConvexError>()(
  "ConvexError",
  {
    message: Schema.String,
  }
) {}

export type ConfigNotFoundType = typeof ConfigNotFound.Type;
export type UserNotFoundType = typeof UserNotFound.Type;
export type PermissionDeniedType = typeof PermissionDenied.Type;
export type ValidationErrorType = typeof ValidationError.Type;
export type AuthErrorType = typeof AuthError.Type;
export type ConvexErrorType = typeof ConvexError.Type;
