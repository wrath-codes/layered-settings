import type { JSONSchema } from "vscode-json-languageservice";
import { SettingsRegistry } from "./settings-registry";

export function buildSettingsSchema(): JSONSchema {
  const settingsProperties: Record<string, JSONSchema> = {};
  const definitions: Record<string, JSONSchema> = {};

  for (const meta of SettingsRegistry.getAllSettings()) {
    const defName = meta.key.replace(/[./]/g, "_");

    const def: JSONSchema = {};
    if (meta.type) def.type = meta.type as JSONSchema["type"];
    if (meta.description) def.description = meta.description;
    if (meta.markdownDescription) def.markdownDescription = meta.markdownDescription;
    if (meta.enum) def.enum = meta.enum;
    if (meta.enumDescriptions) def.enumDescriptions = meta.enumDescriptions;
    if (meta.default !== undefined) def.default = meta.default;
    if (meta.deprecationMessage) def.deprecationMessage = meta.deprecationMessage;

    definitions[defName] = def;
    settingsProperties[meta.key] = { $ref: `#/definitions/${defName}` };
  }

  const languagePattern: JSONSchema = {
    type: "object",
    properties: settingsProperties,
    additionalProperties: false,
  };

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    definitions,
    type: "object",
    properties: {
      enabled: {
        type: "boolean",
        default: true,
        description: "Set to false to disable this config file and its extends chain",
      },
      root: {
        type: "boolean",
        default: false,
        description: "Stop inheritance at this file",
      },
      extends: {
        oneOf: [
          { type: "string", format: "uri-reference" },
          {
            type: "array",
            items: { type: "string", format: "uri-reference" },
          },
        ],
        description: "Config files to inherit from",
      },
      settings: {
        type: "object",
        properties: settingsProperties,
        additionalProperties: false,
        description: "VS Code settings to apply",
      },
    },
    patternProperties: {
      "^\\[.+\\]$": languagePattern,
    },
    additionalProperties: false,
  };
}
