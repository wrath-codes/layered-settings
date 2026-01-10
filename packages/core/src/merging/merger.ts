import type {
  ArraySegmentProvenance,
  KeyProvenance,
  LayeredConfig,
  ProvenanceMap,
  Setting,
} from "../schemas/config";

export interface FileReader {
  readFile(path: string): string | null;
  exists(path: string): boolean;
  resolvePath(base: string, relative: string): string;
  dirname(path: string): string;
  basename(path: string): string;
  isAbsolute(path: string): boolean;
}

export interface MergerCallbacks {
  onCircularDependency?(path: string): void;
  onParseError?(path: string, error: unknown): void;
  onExtendNotFound?(path: string): void;
  onInvalidExtend?(message: string): void;
}

export class ConfigMergerCore {
  private finalSettings: Setting = {};
  private provenance: ProvenanceMap = new Map();
  private resolving: Set<string> = new Set();
  private extendedFiles: Set<string> = new Set();

  constructor(
    private readonly fileReader: FileReader,
    private readonly callbacks: MergerCallbacks = {}
  ) {}

  async mergeFromConfigChain(
    configs: { configPath: string; baseDir: string }[]
  ): Promise<void> {
    this.reset();
    for (const { configPath, baseDir } of configs) {
      await this.resolveConfigWithProvenance(configPath, baseDir);
    }
  }

  async mergeFromConfig(configPath: string, baseDir: string): Promise<void> {
    await this.mergeFromConfigChain([{ configPath, baseDir }]);
  }

  reset(): void {
    this.finalSettings = {};
    this.provenance = new Map();
    this.resolving = new Set();
    this.extendedFiles = new Set();
  }

  getSettings(): Setting {
    return { ...this.finalSettings };
  }

  getProvenance(): ProvenanceMap {
    return new Map(this.provenance);
  }

  getOwnedKeys(): Set<string> {
    return new Set(Object.keys(this.finalSettings));
  }

  getExtendedFiles(): Set<string> {
    return new Set(this.extendedFiles);
  }

  getConflictedKeys(): string[] {
    return [...this.provenance.entries()]
      .filter(([, prov]) => prov.overrides.length > 0)
      .map(([key]) => key);
  }

  private async resolveConfigWithProvenance(
    configPath: string,
    baseDir: string
  ): Promise<void> {
    const absolutePath = this.fileReader.isAbsolute(configPath)
      ? configPath
      : this.fileReader.resolvePath(baseDir, configPath);

    if (this.resolving.has(absolutePath)) {
      this.callbacks.onCircularDependency?.(absolutePath);
      return;
    }

    this.resolving.add(absolutePath);

    const config = this.parseConfigFile(absolutePath);
    if (!config) {
      this.resolving.delete(absolutePath);
      return;
    }

    if (config.extends) {
      const extendsList = Array.isArray(config.extends)
        ? config.extends
        : [config.extends];
      const configDir = this.fileReader.dirname(absolutePath);

      for (const extendPath of extendsList) {
        await this.resolveExtendPath(extendPath, configDir);
      }
    }

    if (config.settings) {
      this.mergeSettingsWithProvenance(config.settings, absolutePath);
    }

    this.resolving.delete(absolutePath);
  }

  private async resolveExtendPath(
    extendPath: string,
    baseDir: string
  ): Promise<void> {
    if (!extendPath.endsWith(".json")) {
      this.callbacks.onInvalidExtend?.("extends must point to a .json file");
      return;
    }

    if (extendPath.startsWith("http://") || extendPath.startsWith("https://")) {
      // URL fetching should be handled by the platform-specific implementation
      return;
    }

    const resolved = this.fileReader.isAbsolute(extendPath)
      ? extendPath
      : this.fileReader.resolvePath(baseDir, extendPath);

    if (!this.fileReader.exists(resolved)) {
      this.callbacks.onExtendNotFound?.(resolved);
      return;
    }

    this.extendedFiles.add(resolved);
    await this.resolveConfigWithProvenance(
      resolved,
      this.fileReader.dirname(resolved)
    );
  }

  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
  }

  private mergeSettingsWithProvenance(
    settings: Setting,
    sourcePath: string
  ): void {
    const normalizedPath = this.normalizePath(sourcePath);
    for (const [key, value] of Object.entries(settings)) {
      const isLanguageSpecific = /^\[.+\]$/.test(key);

      if (isLanguageSpecific && typeof value === "object" && value !== null) {
        this.finalSettings[key] = this.finalSettings[key] || {};
        Object.assign(this.finalSettings[key] as object, value);
      } else if (Array.isArray(value)) {
        // ARRAY HANDLING WITH SEGMENT PROVENANCE
        const existingValue = this.finalSettings[key];
        const prevLength = Array.isArray(existingValue)
          ? existingValue.length
          : 0;

        // Concatenate arrays
        const merged = Array.isArray(existingValue)
          ? [...existingValue, ...value]
          : [...value];
        this.finalSettings[key] = merged;

        // Create segment for this contribution
        const newSegment: ArraySegmentProvenance = {
          sourceFile: normalizedPath,
          start: prevLength,
          length: value.length,
        };

        const existing = this.provenance.get(key);
        if (existing) {
          // Append segment to existing provenance
          if (!existing.arraySegments) {
            existing.arraySegments = [];
          }
          existing.arraySegments.push(newSegment);
          // winner is single path (last contributor), NOT comma-separated
          existing.winner = normalizedPath;
          // winnerValue = full merged array (not just this contribution)
          existing.winnerValue = merged;
        } else {
          this.provenance.set(key, {
            winner: normalizedPath,
            winnerValue: merged,
            overrides: [],
            arraySegments: [newSegment],
          });
        }
      } else {
        const existing = this.provenance.get(key);

        if (existing) {
          existing.overrides.push({
            file: existing.winner,
            value: existing.winnerValue,
          });
          existing.winner = normalizedPath;
          existing.winnerValue = value;
        } else {
          this.provenance.set(key, {
            winner: normalizedPath,
            winnerValue: value,
            overrides: [],
          });
        }

        this.finalSettings[key] = value;
      }
    }
  }

  private parseConfigFile(configPath: string): LayeredConfig | null {
    try {
      const content = this.fileReader.readFile(configPath);
      if (!content) return null;
      return JSON.parse(content);
    } catch (error) {
      this.callbacks.onParseError?.(configPath, error);
      return null;
    }
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every((key) => bKeys.includes(key) && deepEqual(aObj[key], bObj[key]));
}

export function diffObjects(
  prev: Setting,
  curr: Setting
): { added: Setting; changed: Setting; removed: string[] } {
  const prevKeys = new Set(Object.keys(prev));
  const currKeys = new Set(Object.keys(curr));
  const currEntries = Object.entries(curr);

  const added = Object.fromEntries(
    currEntries.filter(([k]) => !prevKeys.has(k))
  );

  const changed = Object.fromEntries(
    currEntries.filter(([k]) => prevKeys.has(k) && !deepEqual(prev[k], curr[k]))
  );

  const removed = [...prevKeys].filter((k) => !currKeys.has(k));

  return { added, changed, removed };
}
