import * as fs from "node:fs";
import * as path from "node:path";
import type { LayeredConfig } from "./types";

const RESERVED_NAME = "layered.json";

const TEMPLATE: LayeredConfig = {
  settings: {},
};

export class CaptureFileManager {
  constructor(private readonly configDir: string) {}

  isReservedName(filename: string): boolean {
    return filename === RESERVED_NAME;
  }

  getLayeredJsonPath(): string {
    return path.join(this.configDir, RESERVED_NAME);
  }

  async ensureLayeredJsonExists(): Promise<string> {
    const filePath = this.getLayeredJsonPath();

    if (!fs.existsSync(filePath)) {
      this.createLayeredJson(filePath);
      return filePath;
    }

    // Validate and repair if needed
    const repaired = this.repairIfInvalid(filePath);
    if (repaired) {
      return filePath;
    }

    return filePath;
  }

  private createLayeredJson(filePath: string): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(TEMPLATE, null, 2));
  }

  private repairIfInvalid(filePath: string): boolean {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(content) as LayeredConfig;

      if (typeof parsed.settings !== "object" || parsed.settings === null) {
        const repaired: LayeredConfig = {
          ...parsed,
          settings: parsed.settings ?? {},
        };
        fs.writeFileSync(filePath, JSON.stringify(repaired, null, 2));
        return true;
      }

      return false;
    } catch {
      // File is corrupted, recreate it
      fs.writeFileSync(filePath, JSON.stringify(TEMPLATE, null, 2));
      return true;
    }
  }

  layeredJsonExists(): boolean {
    return fs.existsSync(this.getLayeredJsonPath());
  }

  getLayeredJsonSettings(): Record<string, unknown> {
    const filePath = this.getLayeredJsonPath();

    if (!fs.existsSync(filePath)) {
      return {};
    }

    try {
      const content = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(content) as LayeredConfig;
      return parsed.settings ?? {};
    } catch {
      return {};
    }
  }

  async addSettingToLayeredJson(
    key: string,
    value: unknown
  ): Promise<void> {
    const filePath = await this.ensureLayeredJsonExists();

    const content = fs.readFileSync(filePath, "utf8");
    const config = JSON.parse(content) as LayeredConfig;

    config.settings = config.settings ?? {};
    config.settings[key] = value;

    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
  }

  async appendToArraySetting(
    key: string,
    elements: unknown[]
  ): Promise<void> {
    if (elements.length === 0) return;

    const filePath = await this.ensureLayeredJsonExists();

    const content = fs.readFileSync(filePath, "utf8");
    const config = JSON.parse(content) as LayeredConfig;

    config.settings = config.settings ?? {};
    const existing = config.settings[key];

    if (Array.isArray(existing)) {
      config.settings[key] = [...existing, ...elements];
    } else {
      config.settings[key] = elements;
    }

    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
  }
}
