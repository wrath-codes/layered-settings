import { Schema } from "effect";

export const AccessLevel = Schema.Literal("read", "write");
export type AccessLevelType = typeof AccessLevel.Type;

export class SharedConfig extends Schema.Class<SharedConfig>("SharedConfig")({
  configId: Schema.String,
  userId: Schema.String,
  accessLevel: AccessLevel,
}) {}

export class ShareInput extends Schema.Class<ShareInput>("ShareInput")({
  configId: Schema.String,
  userId: Schema.String,
  accessLevel: AccessLevel,
}) {}

export type SharedConfigType = typeof SharedConfig.Type;
export type ShareInputType = typeof ShareInput.Type;

export const decodeSharedConfig = Schema.decodeUnknown(SharedConfig);
export const decodeShareInput = Schema.decodeUnknown(ShareInput);
