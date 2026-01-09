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
import type { LayeredConfig, ProvenanceMap, Setting } from "./types";
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
    await this.core.mergeFromConfig(configPath, this.configDir);
  }

  reset(): void {
    this.core.reset();
  }

  getSettings(): Setting {
    return this.core.getSettings();
  }

  getProvenance(): ProvenanceMap {
    return this.core.getProvenance();
  }

  getOwnedKeys(): Set<string> {
    return this.core.getOwnedKeys();
  }

  getExtendedFiles(): Set<string> {
    return this.core.getExtendedFiles();
  }

  getConflictedKeys(): string[] {
    return this.core.getConflictedKeys();
  }
}

export { coreDeepEqual as deepEqual };
