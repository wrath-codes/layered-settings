import * as vscode from "vscode";

export interface SettingMetadata {
  key: string;
  extensionId: string;
  extensionDisplayName?: string;
  extensionUri: vscode.Uri;
  sourceFile?: vscode.Uri;
  type?: string | string[];
  description?: string;
  markdownDescription?: string;
  enum?: unknown[];
  enumDescriptions?: string[];
  default?: unknown;
  deprecationMessage?: string;
}

class SettingsRegistryImpl {
  private settings = new Map<string, SettingMetadata>();
  private initialized = false;

  rebuild(): void {
    this.settings.clear();

    for (const ext of vscode.extensions.all) {
      const contributes = ext.packageJSON?.contributes;
      if (!contributes?.configuration) continue;

      const configs = Array.isArray(contributes.configuration)
        ? contributes.configuration
        : [contributes.configuration];

      for (const config of configs) {
        const props = config.properties;
        if (!props || typeof props !== "object") continue;

        for (const [key, schema] of Object.entries(props)) {
          const s = schema as Record<string, unknown>;
          this.settings.set(key, {
            key,
            extensionId: ext.id,
            extensionDisplayName: ext.packageJSON?.displayName,
            extensionUri: ext.extensionUri,
            sourceFile: vscode.Uri.joinPath(ext.extensionUri, "package.json"),
            type: s.type as string | string[] | undefined,
            description: s.description as string | undefined,
            markdownDescription: s.markdownDescription as string | undefined,
            enum: s.enum as unknown[] | undefined,
            enumDescriptions: s.enumDescriptions as string[] | undefined,
            default: s.default,
            deprecationMessage: s.deprecationMessage as string | undefined,
          });
        }
      }
    }

    this.initialized = true;
  }

  isKnownKey(key: string): boolean {
    if (!this.initialized) this.rebuild();
    return this.settings.has(key);
  }

  getMetadata(key: string): SettingMetadata | undefined {
    if (!this.initialized) this.rebuild();
    return this.settings.get(key);
  }

  getAllSettings(): IterableIterator<SettingMetadata> {
    if (!this.initialized) this.rebuild();
    return this.settings.values();
  }

  getAllKeys(): string[] {
    if (!this.initialized) this.rebuild();
    return [...this.settings.keys()];
  }

  getSettingsCount(): number {
    if (!this.initialized) this.rebuild();
    return this.settings.size;
  }
}

export const SettingsRegistry = new SettingsRegistryImpl();

export function activateSettingsRegistry(
  context: vscode.ExtensionContext
): void {
  SettingsRegistry.rebuild();

  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      SettingsRegistry.rebuild();
    })
  );
}
