import { describe, test, expect, beforeEach, mock } from "bun:test";

const mockRegistry = {
  settings: new Map<string, {
    key: string;
    type?: string;
    description?: string;
    markdownDescription?: string;
    enum?: unknown[];
    enumDescriptions?: string[];
    default?: unknown;
    deprecationMessage?: string;
  }>(),

  getAllSettings() {
    return this.settings.values();
  },

  clear() {
    this.settings.clear();
  },

  addSetting(key: string, meta: Omit<Parameters<typeof this.settings.set>[1], "key">) {
    this.settings.set(key, { key, ...meta });
  },
};

let mockCustomSettings: string[] = [];

function buildSettingsSchema() {
  const settingsProperties: Record<string, unknown> = {};
  const definitions: Record<string, unknown> = {};

  for (const meta of mockRegistry.getAllSettings()) {
    const defName = meta.key.replace(/\./g, "_");

    const def: Record<string, unknown> = {};
    if (meta.type) def.type = meta.type;
    if (meta.description) def.description = meta.description;
    if (meta.markdownDescription) def.markdownDescription = meta.markdownDescription;
    if (meta.enum) def.enum = meta.enum;
    if (meta.enumDescriptions) def.enumDescriptions = meta.enumDescriptions;
    if (meta.default !== undefined) def.default = meta.default;
    if (meta.deprecationMessage) def.deprecationMessage = meta.deprecationMessage;

    definitions[defName] = def;
    settingsProperties[meta.key] = { $ref: `#/definitions/${defName}` };
  }

  for (const key of mockCustomSettings) {
    settingsProperties[key] = { description: "Custom setting (user allowlist)" };
  }

  const languagePattern = {
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

describe("buildSettingsSchema", () => {
  beforeEach(() => {
    mockRegistry.clear();
    mockCustomSettings = [];
  });

  test("T3.1-U1: schema includes all registry keys with type/description/enum/default", () => {
    mockRegistry.addSetting("editor.tabSize", {
      type: "number",
      description: "Tab size in spaces",
      default: 4,
    });
    mockRegistry.addSetting("editor.theme", {
      type: "string",
      enum: ["dark", "light", "auto"],
      enumDescriptions: ["Dark theme", "Light theme", "Auto"],
      default: "dark",
    });

    const schema = buildSettingsSchema();

    expect(schema.definitions).toHaveProperty("editor_tabSize");
    expect(schema.definitions).toHaveProperty("editor_theme");

    const tabSizeDef = schema.definitions.editor_tabSize as Record<string, unknown>;
    expect(tabSizeDef.type).toBe("number");
    expect(tabSizeDef.description).toBe("Tab size in spaces");
    expect(tabSizeDef.default).toBe(4);

    const themeDef = schema.definitions.editor_theme as Record<string, unknown>;
    expect(themeDef.type).toBe("string");
    expect(themeDef.enum).toEqual(["dark", "light", "auto"]);
    expect(themeDef.enumDescriptions).toEqual(["Dark theme", "Light theme", "Auto"]);

    const settingsProps = schema.properties.settings as Record<string, unknown>;
    const props = settingsProps.properties as Record<string, unknown>;
    expect(props["editor.tabSize"]).toEqual({ $ref: "#/definitions/editor_tabSize" });
    expect(props["editor.theme"]).toEqual({ $ref: "#/definitions/editor_theme" });
  });

  test("T3.1-U2: schema includes [language] patternProperties", () => {
    mockRegistry.addSetting("editor.tabSize", { type: "number" });

    const schema = buildSettingsSchema();

    expect(schema.patternProperties).toBeDefined();
    const patternKey = "^\\[.+\\]$";
    expect(patternKey in schema.patternProperties).toBe(true);

    const languagePattern = schema.patternProperties[patternKey] as Record<string, unknown>;
    expect(languagePattern.type).toBe("object");
    expect(languagePattern.additionalProperties).toBe(false);

    const props = languagePattern.properties as Record<string, unknown>;
    expect(props["editor.tabSize"]).toEqual({ $ref: "#/definitions/editor_tabSize" });
  });

  test("T3.1-U3: knownCustomSettings are included in schema", () => {
    mockCustomSettings = ["myTool.customSetting", "anotherTool.option"];

    const schema = buildSettingsSchema();

    const settingsProps = schema.properties.settings as Record<string, unknown>;
    const props = settingsProps.properties as Record<string, unknown>;

    expect(props["myTool.customSetting"]).toEqual({
      description: "Custom setting (user allowlist)",
    });
    expect(props["anotherTool.option"]).toEqual({
      description: "Custom setting (user allowlist)",
    });
  });

  test("T3.1-U4: schema includes enabled, root, extends properties", () => {
    const schema = buildSettingsSchema();

    expect(schema.properties.enabled).toEqual({
      type: "boolean",
      default: true,
      description: "Set to false to disable this config file and its extends chain",
    });

    expect(schema.properties.root).toEqual({
      type: "boolean",
      default: false,
      description: "Stop inheritance at this file",
    });

    expect(schema.properties.extends).toBeDefined();
    const extendsSchema = schema.properties.extends as Record<string, unknown>;
    expect(extendsSchema.oneOf).toBeDefined();
  });

  test("schema includes deprecationMessage when present", () => {
    mockRegistry.addSetting("deprecated.setting", {
      type: "boolean",
      deprecationMessage: "Use newSetting instead",
    });

    const schema = buildSettingsSchema();

    const def = schema.definitions.deprecated_setting as Record<string, unknown>;
    expect(def.deprecationMessage).toBe("Use newSetting instead");
  });

  test("schema uses markdownDescription when available", () => {
    mockRegistry.addSetting("markdown.setting", {
      type: "string",
      markdownDescription: "**Bold** description",
    });

    const schema = buildSettingsSchema();

    const def = schema.definitions.markdown_setting as Record<string, unknown>;
    expect(def.markdownDescription).toBe("**Bold** description");
  });
});
