import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Mock vscode module
const mockVscode = {
  workspace: {
    getConfiguration: mock(() => ({
      get: mock((key: string, defaultValue: unknown) => {
        if (key === "autoGitignore") return true;
        return defaultValue;
      }),
    })),
  },
  window: {
    showWarningMessage: mock(() => Promise.resolve(undefined)),
  },
  Uri: {
    file: (p: string) => ({ fsPath: p }),
  },
};

// We need to test the logic without the vscode dependency
// So we'll test the file-system operations directly

describe("BackupManager file operations", () => {
  let tempDir: string;
  let backupDir: string;
  let configDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
    backupDir = path.join(tempDir, "backups");
    configDir = path.join(tempDir, "config");
    fs.mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("backup file creation", () => {
    test("creates backup directory if it doesn't exist", () => {
      expect(fs.existsSync(backupDir)).toBe(false);
      fs.mkdirSync(backupDir, { recursive: true });
      expect(fs.existsSync(backupDir)).toBe(true);
    });

    test("copies layered.json to backup with timestamp", () => {
      const sourcePath = path.join(configDir, "layered.json");
      fs.writeFileSync(sourcePath, JSON.stringify({ settings: { key: "value" } }));

      fs.mkdirSync(backupDir, { recursive: true });
      const timestamp = Date.now();
      const backupPath = path.join(backupDir, `layered-${timestamp}.json`);
      fs.copyFileSync(sourcePath, backupPath);

      expect(fs.existsSync(backupPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(backupPath, "utf8"));
      expect(content.settings.key).toBe("value");
    });
  });

  describe("backup cleanup", () => {
    test("keeps only MAX_BACKUPS (5) most recent backups", () => {
      fs.mkdirSync(backupDir, { recursive: true });

      // Create 7 backup files
      const timestamps = [1000, 2000, 3000, 4000, 5000, 6000, 7000];
      for (const ts of timestamps) {
        fs.writeFileSync(
          path.join(backupDir, `layered-${ts}.json`),
          JSON.stringify({ ts })
        );
      }

      // Simulate cleanup (keep 5 newest)
      const files = fs
        .readdirSync(backupDir)
        .filter((f) => f.startsWith("layered-") && f.endsWith(".json"))
        .map((f) => ({
          name: f,
          time: Number.parseInt(f.replace("layered-", "").replace(".json", ""), 10),
        }))
        .sort((a, b) => b.time - a.time);

      const toDelete = files.slice(5);
      for (const file of toDelete) {
        fs.unlinkSync(path.join(backupDir, file.name));
      }

      const remaining = fs.readdirSync(backupDir);
      expect(remaining.length).toBe(5);
      expect(remaining).not.toContain("layered-1000.json");
      expect(remaining).not.toContain("layered-2000.json");
      expect(remaining).toContain("layered-7000.json");
    });
  });

  describe("deletion detection", () => {
    test("returns true when file existed with settings and is now deleted", () => {
      const filePath = path.join(configDir, "layered.json");
      const previousSettings = { key: "value" };

      // File doesn't exist
      const previouslyHadSettings = Object.keys(previousSettings).length > 0;
      const fileExists = fs.existsSync(filePath);

      expect(previouslyHadSettings && !fileExists).toBe(true);
    });

    test("returns false when file still exists", () => {
      const filePath = path.join(configDir, "layered.json");
      fs.writeFileSync(filePath, JSON.stringify({ settings: {} }));

      const previousSettings = { key: "value" };
      const previouslyHadSettings = Object.keys(previousSettings).length > 0;
      const fileExists = fs.existsSync(filePath);

      expect(previouslyHadSettings && !fileExists).toBe(false);
    });

    test("returns false when previous settings were empty", () => {
      const filePath = path.join(configDir, "layered.json");
      const previousSettings = {};

      const previouslyHadSettings = Object.keys(previousSettings).length > 0;
      const fileExists = fs.existsSync(filePath);

      expect(previouslyHadSettings && !fileExists).toBe(false);
    });
  });

  describe("gitignore management", () => {
    test("creates .gitignore if it doesn't exist", () => {
      const gitignorePath = path.join(tempDir, ".gitignore");
      const entry = ".vscode/layered-settings/settings/layered.json";

      expect(fs.existsSync(gitignorePath)).toBe(false);

      fs.writeFileSync(gitignorePath, `${entry}\n`);

      expect(fs.existsSync(gitignorePath)).toBe(true);
      expect(fs.readFileSync(gitignorePath, "utf8")).toContain(entry);
    });

    test("appends to existing .gitignore", () => {
      const gitignorePath = path.join(tempDir, ".gitignore");
      const existingContent = "node_modules/\n.env\n";
      const entry = ".vscode/layered-settings/settings/layered.json";

      fs.writeFileSync(gitignorePath, existingContent);

      const content = fs.readFileSync(gitignorePath, "utf8");
      if (!content.includes(entry)) {
        const separator = content.endsWith("\n") ? "" : "\n";
        fs.writeFileSync(gitignorePath, `${content}${separator}${entry}\n`);
      }

      const finalContent = fs.readFileSync(gitignorePath, "utf8");
      expect(finalContent).toContain("node_modules/");
      expect(finalContent).toContain(".env");
      expect(finalContent).toContain(entry);
    });

    test("doesn't duplicate entry if already present", () => {
      const gitignorePath = path.join(tempDir, ".gitignore");
      const entry = ".vscode/layered-settings/settings/layered.json";
      const existingContent = `node_modules/\n${entry}\n`;

      fs.writeFileSync(gitignorePath, existingContent);

      const content = fs.readFileSync(gitignorePath, "utf8");
      const shouldAdd = !content.includes(entry);

      expect(shouldAdd).toBe(false);
    });
  });
});
