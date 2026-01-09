import * as fs from "node:fs";
import * as https from "node:https";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  ConfigMergerCore,
  deepEqual as coreDeepEqual,
  type FileReader,
  type MergerCallbacks,
} from "@layered/core";
import type {
  KeyProvenance,
  LayeredConfig,
  ProvenanceMap,
  Setting,
} from "./types";
import { log, logError } from "../utils/logger";

class NodeFileReader implements FileReader {
  readFile(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  }

  exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  resolvePath(base: string, relative: string): string {
    return path.resolve(base, relative);
  }

  dirname(filePath: string): string {
    return path.dirname(filePath);
  }

  basename(filePath: string): string {
    return path.basename(filePath);
  }

  isAbsolute(filePath: string): boolean {
    return path.isAbsolute(filePath);
  }
}

export class ConfigMerger {
  private core: ConfigMergerCore;
  private finalSettings: Setting = {};
  private provenance: ProvenanceMap = new Map();
  private resolving: Set<string> = new Set();
  private extendedFiles: Set<string> = new Set();

  constructor(private readonly configDir: string) {
    const callbacks: MergerCallbacks = {
      onCircularDependency: (p: string) => {
        vscode.window.showWarningMessage(`Circular dependency detected: ${p}`);
      },
      onParseError: (p: string, error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to parse ${p}: ${message}`);
        logError(`Parse error for ${p}`, error);
      },
      onExtendNotFound: (p: string) => {
        vscode.window.showErrorMessage(`Extended file not found: ${p}`);
      },
      onInvalidExtend: (msg: string) => {
        vscode.window.showErrorMessage(msg);
      },
    };

    this.core = new ConfigMergerCore(new NodeFileReader(), callbacks);
  }

  async mergeFromConfig(configPath: string): Promise<void> {
    this.reset();
    await this.resolveConfigWithProvenance(configPath, this.configDir);
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
    const conflicted: string[] = [];
    for (const [key, prov] of this.provenance.entries()) {
      if (prov.overrides.length > 0) {
        conflicted.push(key);
      }
    }
    return conflicted;
  }

  private async resolveConfigWithProvenance(
    configPath: string,
    baseDir: string
  ): Promise<void> {
    const absolutePath = path.isAbsolute(configPath)
      ? configPath
      : path.resolve(baseDir, configPath);

    if (this.resolving.has(absolutePath)) {
      vscode.window.showWarningMessage(
        `Circular dependency detected: ${absolutePath}`
      );
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
      const configFileDir = path.dirname(absolutePath);

      for (const extendPath of extendsList) {
        await this.resolveExtendPath(extendPath, configFileDir);
      }
    }

    if (config.settings) {
      const fileName = path.basename(absolutePath);
      this.mergeSettingsWithProvenance(config.settings, fileName);
    }

    this.resolving.delete(absolutePath);
  }

  private async resolveExtendPath(
    extendPath: string,
    baseDir: string
  ): Promise<void> {
    if (!extendPath.endsWith(".json")) {
      vscode.window.showErrorMessage("extends must point to a .json file");
      return;
    }

    if (extendPath.startsWith("http://") || extendPath.startsWith("https://")) {
      const settings = await this.fetchFromUrl(extendPath);
      this.mergeSettingsWithProvenance(settings, extendPath);
      return;
    }

    const resolved = path.isAbsolute(extendPath)
      ? extendPath
      : path.resolve(baseDir, extendPath);

    if (!fs.existsSync(resolved)) {
      vscode.window.showErrorMessage(`Extended file not found: ${resolved}`);
      return;
    }

    this.extendedFiles.add(resolved);
    await this.resolveConfigWithProvenance(resolved, path.dirname(resolved));
  }

  private mergeSettingsWithProvenance(
    settings: Setting,
    sourceFile: string
  ): void {
    for (const [key, value] of Object.entries(settings)) {
      const isLanguageSpecific = /^\[.+\]$/.test(key);

      if (isLanguageSpecific && typeof value === "object" && value !== null) {
        this.finalSettings[key] = this.finalSettings[key] || {};
        Object.assign(this.finalSettings[key] as object, value);
      } else if (Array.isArray(value)) {
        const existingValue = this.finalSettings[key];
        if (Array.isArray(existingValue)) {
          this.finalSettings[key] = [...existingValue, ...value];
        } else {
          this.finalSettings[key] = value;
        }

        const existing = this.provenance.get(key);
        if (existing) {
          existing.winner = `${existing.winner}, ${sourceFile}`;
          existing.winnerValue = this.finalSettings[key];
        } else {
          this.provenance.set(key, {
            winner: sourceFile,
            winnerValue: value,
            overrides: [],
          });
        }
      } else {
        const existing = this.provenance.get(key);

        if (existing) {
          existing.overrides.push({
            file: existing.winner,
            value: existing.winnerValue,
          });
          existing.winner = sourceFile;
          existing.winnerValue = value;
        } else {
          this.provenance.set(key, {
            winner: sourceFile,
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
      const content = fs.readFileSync(configPath, "utf8");
      return JSON.parse(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to parse ${configPath}: ${message}`
      );
      logError(`Parse error for ${configPath}`, error);
      return null;
    }
  }

  private fetchFromUrl(url: string): Promise<Setting> {
    return new Promise((resolve) => {
      const request = https.get(url, (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer) => chunks.push(chunk));

        response.on("end", () => {
          try {
            const data = Buffer.concat(chunks).toString();
            const config = JSON.parse(data) as LayeredConfig;

            if (config.settings) {
              resolve(config.settings);
            } else if (!config.extends) {
              resolve(config as Setting);
            } else {
              resolve({});
            }
          } catch {
            vscode.window.showErrorMessage(`Failed to parse URL: ${url}`);
            resolve({});
          }
        });

        response.on("error", () => {
          vscode.window.showErrorMessage(`Failed to fetch: ${url}`);
          resolve({});
        });
      });

      request.on("error", () => {
        vscode.window.showErrorMessage(`Failed to fetch: ${url}`);
        resolve({});
      });

      request.setTimeout(5000, () => {
        request.destroy();
        vscode.window.showErrorMessage(`Timeout fetching: ${url}`);
        resolve({});
      });
    });
  }
}

export { coreDeepEqual as deepEqual };
