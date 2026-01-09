import { Schema } from "effect";

export class Config extends Schema.Class<Config>("Config")({
  id: Schema.String,
  name: Schema.String,
  projectType: Schema.String,
  content: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ownerId: Schema.String,
  isPublic: Schema.Boolean,
  isDefault: Schema.Boolean,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class ConfigInput extends Schema.Class<ConfigInput>("ConfigInput")({
  name: Schema.String,
  projectType: Schema.String,
  content: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  isPublic: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  isDefault: Schema.optionalWith(Schema.Boolean, { default: () => false }),
}) {}

export class ConfigUpdate extends Schema.Class<ConfigUpdate>("ConfigUpdate")({
  name: Schema.optional(Schema.String),
  content: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  isPublic: Schema.optional(Schema.Boolean),
  isDefault: Schema.optional(Schema.Boolean),
}) {}

export type ConfigType = typeof Config.Type;
export type ConfigInputType = typeof ConfigInput.Type;
export type ConfigUpdateType = typeof ConfigUpdate.Type;

export const decodeConfig = Schema.decodeUnknown(Config);
export const decodeConfigInput = Schema.decodeUnknown(ConfigInput);
export const decodeConfigUpdate = Schema.decodeUnknown(ConfigUpdate);
