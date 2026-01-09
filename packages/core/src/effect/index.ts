// Schemas (runtime - imports Effect)
export {
  Config,
  ConfigInput,
  ConfigUpdate,
  decodeConfig,
  decodeConfigInput,
  decodeConfigUpdate,
} from "./config";

export {
  User,
  AuthenticatedUser,
  UserInput,
  decodeUser,
  decodeAuthenticatedUser,
  decodeUserInput,
} from "./user";

export {
  AccessLevel,
  SharedConfig,
  ShareInput,
  decodeSharedConfig,
  decodeShareInput,
} from "./share";

export {
  ConfigNotFound,
  UserNotFound,
  PermissionDenied,
  ValidationError,
  AuthError,
  ConvexError,
} from "./errors";

// Plain types (no runtime - type-only imports)
export type {
  ConfigType,
  ConfigInputType,
  ConfigUpdateType,
} from "./config";

export type {
  UserType,
  AuthenticatedUserType,
  UserInputType,
} from "./user";

export type {
  AccessLevelType,
  SharedConfigType,
  ShareInputType,
} from "./share";

export type {
  ConfigNotFoundType,
  UserNotFoundType,
  PermissionDeniedType,
  ValidationErrorType,
  AuthErrorType,
  ConvexErrorType,
} from "./errors";
