import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface TestWorkspace {
  rootPath: string;
  configDir: string;
  settingsPath: string;
  layeredJsonPath: string;
  readConfig: (filename: string) => Record<string, unknown>;
  writeConfig: (filename: string, config: Record<string, unknown>) => void;
  readSettings: () => Record<string, unknown>;
  writeSettings: (settings: Record<string, unknown>) => void;
  cleanupLayeredJson: () => void;
  dispose: () => void;
}

const CANONICAL_CONFIG = {
  root: true,
  extends: ["base.json"],
  settings: {
    "editor.fontSize": 14,
    "editor.tabSize": 2,
    "test.duplicate": [],
    "test.restore": ["a", "b"],
    "editor.rulers": [80, 120],
  },
};

const CANONICAL_BASE = {
  settings: {
    "editor.wordWrap": "on",
    "editor.minimap.enabled": false,
    "files.autoSave": "afterDelay",
    "test.duplicate": [],
    "editor.rulers": [80, 100],
  },
};

const CANONICAL_SETTINGS = {};

export function createTestWorkspace(prefix = "layered-test"): TestWorkspace {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const vscodeDir = path.join(rootPath, ".vscode");
  const configDir = path.join(vscodeDir, "layered-settings", "settings");
  const settingsPath = path.join(vscodeDir, "settings.json");
  const layeredJsonPath = path.join(configDir, "layered.json");

  fs.mkdirSync(configDir, { recursive: true });

  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify(CANONICAL_CONFIG, null, 2)
  );
  fs.writeFileSync(
    path.join(configDir, "base.json"),
    JSON.stringify(CANONICAL_BASE, null, 2)
  );
  fs.writeFileSync(settingsPath, JSON.stringify(CANONICAL_SETTINGS, null, 2));

  function readConfig(filename: string): Record<string, unknown> {
    const content = fs.readFileSync(path.join(configDir, filename), "utf8");
    return JSON.parse(content);
  }

  function writeConfig(filename: string, config: Record<string, unknown>): void {
    fs.writeFileSync(
      path.join(configDir, filename),
      JSON.stringify(config, null, 2)
    );
  }

  function readSettings(): Record<string, unknown> {
    try {
      const content = fs.readFileSync(settingsPath, "utf8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  function writeSettings(settings: Record<string, unknown>): void {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }

  function cleanupLayeredJson(): void {
    if (fs.existsSync(layeredJsonPath)) {
      fs.unlinkSync(layeredJsonPath);
    }
  }

  function dispose(): void {
    try {
      fs.rmSync(rootPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  return {
    rootPath,
    configDir,
    settingsPath,
    layeredJsonPath,
    readConfig,
    writeConfig,
    readSettings,
    writeSettings,
    cleanupLayeredJson,
    dispose,
  };
}

export function resetSharedWorkspace(
  configDir: string,
  settingsPath: string
): void {
  const layeredJsonPath = path.join(configDir, "layered.json");

  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify(CANONICAL_CONFIG, null, 2)
  );
  fs.writeFileSync(
    path.join(configDir, "base.json"),
    JSON.stringify(CANONICAL_BASE, null, 2)
  );
  fs.writeFileSync(settingsPath, JSON.stringify(CANONICAL_SETTINGS, null, 2));

  if (fs.existsSync(layeredJsonPath)) {
    fs.unlinkSync(layeredJsonPath);
  }
}

const CANONICAL_PARENT_OWNED_CONFIG = {
  root: true,
  extends: ["../../../../shared-configs/root-config.json"],
  settings: {
    "editor.tabSize": 2,
    "files.exclude": ["node_modules"],
    "editor.rulers": [120],
    "search.exclude": ["**/dist"],
  },
};

const CANONICAL_PARENT_ROOT_CONFIG = {
  settings: {
    "editor.fontSize": 16,
    "editor.wordWrap": "on",
    "editor.rulers": [80, 100],
    "files.exclude": ["node_modules", ".git"],
    "search.exclude": ["**/node_modules"],
  },
};

export function resetParentOwnedWorkspace(
  configDir: string,
  parentConfigDir: string,
  settingsPath: string
): void {
  const layeredJsonPath = path.join(configDir, "layered.json");

  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify(CANONICAL_PARENT_OWNED_CONFIG, null, 2)
  );
  fs.writeFileSync(
    path.join(parentConfigDir, "root-config.json"),
    JSON.stringify(CANONICAL_PARENT_ROOT_CONFIG, null, 2)
  );
  fs.writeFileSync(settingsPath, JSON.stringify({}, null, 2));

  if (fs.existsSync(layeredJsonPath)) {
    fs.unlinkSync(layeredJsonPath);
  }
}

export {
  CANONICAL_CONFIG,
  CANONICAL_BASE,
  CANONICAL_SETTINGS,
  CANONICAL_PARENT_OWNED_CONFIG,
  CANONICAL_PARENT_ROOT_CONFIG,
};
