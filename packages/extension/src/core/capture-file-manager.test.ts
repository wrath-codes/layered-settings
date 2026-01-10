import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { CaptureFileManager } from "./capture-file-manager";

describe("CaptureFileManager", () => {
  let tempDir: string;
  let configDir: string;
  let manager: CaptureFileManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "capture-test-"));
    configDir = path.join(tempDir, ".vscode", "layered-settings", "settings");
    manager = new CaptureFileManager(configDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("isReservedName", () => {
    test("returns true for layered.json", () => {
      expect(manager.isReservedName("layered.json")).toBe(true);
    });

    test("returns false for other names", () => {
      expect(manager.isReservedName("config.json")).toBe(false);
      expect(manager.isReservedName("base.json")).toBe(false);
      expect(manager.isReservedName("layered.json.bak")).toBe(false);
    });
  });

  describe("getLayeredJsonPath", () => {
    test("returns correct path", () => {
      const expected = path.join(configDir, "layered.json");
      expect(manager.getLayeredJsonPath()).toBe(expected);
    });
  });

  describe("ensureLayeredJsonExists", () => {
    test("creates file with template if it doesn't exist", async () => {
      const filePath = await manager.ensureLayeredJsonExists();

      expect(fs.existsSync(filePath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
      expect(content).toEqual({ settings: {} });
    });

    test("creates config directory if it doesn't exist", async () => {
      expect(fs.existsSync(configDir)).toBe(false);

      await manager.ensureLayeredJsonExists();

      expect(fs.existsSync(configDir)).toBe(true);
    });

    test("returns existing file path if file exists", async () => {
      fs.mkdirSync(configDir, { recursive: true });
      const existingContent = { settings: { existing: "value" } };
      fs.writeFileSync(
        path.join(configDir, "layered.json"),
        JSON.stringify(existingContent)
      );

      const filePath = await manager.ensureLayeredJsonExists();

      const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
      expect(content.settings.existing).toBe("value");
    });

    test("repairs file if settings is missing", async () => {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, "layered.json"),
        JSON.stringify({ name: "invalid" })
      );

      await manager.ensureLayeredJsonExists();

      const content = JSON.parse(
        fs.readFileSync(path.join(configDir, "layered.json"), "utf8")
      );
      expect(content.settings).toEqual({});
      expect(content.name).toBe("invalid");
    });

    test("repairs corrupted JSON", async () => {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, "layered.json"), "{ invalid json");

      await manager.ensureLayeredJsonExists();

      const content = JSON.parse(
        fs.readFileSync(path.join(configDir, "layered.json"), "utf8")
      );
      expect(content).toEqual({ settings: {} });
    });
  });

  describe("layeredJsonExists", () => {
    test("returns false when file doesn't exist", () => {
      expect(manager.layeredJsonExists()).toBe(false);
    });

    test("returns true when file exists", async () => {
      await manager.ensureLayeredJsonExists();
      expect(manager.layeredJsonExists()).toBe(true);
    });
  });

  describe("getLayeredJsonSettings", () => {
    test("returns empty object when file doesn't exist", () => {
      expect(manager.getLayeredJsonSettings()).toEqual({});
    });

    test("returns settings from file", async () => {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, "layered.json"),
        JSON.stringify({ settings: { key: "value", num: 42 } })
      );

      expect(manager.getLayeredJsonSettings()).toEqual({ key: "value", num: 42 });
    });

    test("returns empty object for corrupted file", async () => {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, "layered.json"), "not json");

      expect(manager.getLayeredJsonSettings()).toEqual({});
    });
  });

  describe("addSettingToLayeredJson", () => {
    test("creates file and adds setting", async () => {
      await manager.addSettingToLayeredJson("editor.fontSize", 14);

      const content = JSON.parse(
        fs.readFileSync(path.join(configDir, "layered.json"), "utf8")
      );
      expect(content.settings["editor.fontSize"]).toBe(14);
    });

    test("adds to existing settings", async () => {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, "layered.json"),
        JSON.stringify({ settings: { existing: true } })
      );

      await manager.addSettingToLayeredJson("newKey", "newValue");

      const content = JSON.parse(
        fs.readFileSync(path.join(configDir, "layered.json"), "utf8")
      );
      expect(content.settings.existing).toBe(true);
      expect(content.settings.newKey).toBe("newValue");
    });
  });

  describe("appendToArraySetting", () => {
    test("creates array setting if it doesn't exist", async () => {
      await manager.appendToArraySetting("files.exclude", ["*.log", "*.tmp"]);

      const content = JSON.parse(
        fs.readFileSync(path.join(configDir, "layered.json"), "utf8")
      );
      expect(content.settings["files.exclude"]).toEqual(["*.log", "*.tmp"]);
    });

    test("appends to existing array", async () => {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, "layered.json"),
        JSON.stringify({ settings: { "files.exclude": ["*.bak"] } })
      );

      await manager.appendToArraySetting("files.exclude", ["*.log"]);

      const content = JSON.parse(
        fs.readFileSync(path.join(configDir, "layered.json"), "utf8")
      );
      expect(content.settings["files.exclude"]).toEqual(["*.bak", "*.log"]);
    });

    test("does nothing for empty array", async () => {
      await manager.appendToArraySetting("files.exclude", []);

      expect(manager.layeredJsonExists()).toBe(false);
    });

    test("replaces non-array value with array", async () => {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, "layered.json"),
        JSON.stringify({ settings: { "files.exclude": "not-an-array" } })
      );

      await manager.appendToArraySetting("files.exclude", ["*.log"]);

      const content = JSON.parse(
        fs.readFileSync(path.join(configDir, "layered.json"), "utf8")
      );
      expect(content.settings["files.exclude"]).toEqual(["*.log"]);
    });
  });
});
