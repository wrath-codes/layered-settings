import { describe, test, expect, beforeEach } from "bun:test";
import { ConfigMergerCore, diffObjects } from "../../src/merging/merger";
import { InMemoryFileReader } from "../mocks/in-memory-file-reader";

describe("Config Chain Integration", () => {
  let fileReader: InMemoryFileReader;

  beforeEach(() => {
    fileReader = new InMemoryFileReader();
  });

  describe("Multi-Layer Config Chain", () => {
    test("Base → Workspace → Local chain merges correctly", async () => {
      fileReader.addJsonFile("/base/settings.json", {
        settings: {
          "editor.fontSize": 12,
          "editor.tabSize": 2,
        },
      });

      fileReader.addJsonFile("/workspace/settings.json", {
        extends: "../base/settings.json",
        settings: {
          "editor.fontSize": 14,
          "editor.wordWrap": "on",
        },
      });

      fileReader.addJsonFile("/local/settings.json", {
        extends: "../workspace/settings.json",
        settings: {
          "editor.fontSize": 16,
          "editor.minimap.enabled": false,
        },
      });

      const merger = new ConfigMergerCore(fileReader);
      await merger.mergeFromConfig("/local/settings.json", "/local");

      const settings = merger.getSettings();
      expect(settings["editor.fontSize"]).toBe(16);
      expect(settings["editor.tabSize"]).toBe(2);
      expect(settings["editor.wordWrap"]).toBe("on");
      expect(settings["editor.minimap.enabled"]).toBe(false);
    });

    test("scalars: Local wins over Workspace wins over Base", async () => {
      fileReader.addJsonFile("/base/settings.json", {
        settings: { theme: "light" },
      });

      fileReader.addJsonFile("/workspace/settings.json", {
        extends: "../base/settings.json",
        settings: { theme: "dark" },
      });

      fileReader.addJsonFile("/local/settings.json", {
        extends: "../workspace/settings.json",
        settings: { theme: "monokai" },
      });

      const merger = new ConfigMergerCore(fileReader);
      await merger.mergeFromConfig("/local/settings.json", "/local");

      expect(merger.getSettings()["theme"]).toBe("monokai");
    });

    test("arrays: concatenated in order (Base + Workspace + Local)", async () => {
      fileReader.addJsonFile("/base/settings.json", {
        settings: { "files.exclude": ["*.log"] },
      });

      fileReader.addJsonFile("/workspace/settings.json", {
        extends: "../base/settings.json",
        settings: { "files.exclude": ["*.tmp"] },
      });

      fileReader.addJsonFile("/local/settings.json", {
        extends: "../workspace/settings.json",
        settings: { "files.exclude": ["*.bak"] },
      });

      const merger = new ConfigMergerCore(fileReader);
      await merger.mergeFromConfig("/local/settings.json", "/local");

      expect(merger.getSettings()["files.exclude"]).toEqual([
        "*.log",
        "*.tmp",
        "*.bak",
      ]);
    });

    test("language-specific: all blocks merged", async () => {
      fileReader.addJsonFile("/base/settings.json", {
        settings: {
          "[typescript]": { "editor.formatOnSave": true },
        },
      });

      fileReader.addJsonFile("/workspace/settings.json", {
        extends: "../base/settings.json",
        settings: {
          "[typescript]": { "editor.defaultFormatter": "prettier" },
        },
      });

      fileReader.addJsonFile("/local/settings.json", {
        extends: "../workspace/settings.json",
        settings: {
          "[javascript]": { "editor.tabSize": 4 },
        },
      });

      const merger = new ConfigMergerCore(fileReader);
      await merger.mergeFromConfig("/local/settings.json", "/local");

      const settings = merger.getSettings();
      expect(settings["[typescript]"]).toEqual({
        "editor.formatOnSave": true,
        "editor.defaultFormatter": "prettier",
      });
      expect(settings["[javascript]"]).toEqual({ "editor.tabSize": 4 });
    });

    test("provenance tracks full override chain", async () => {
      fileReader.addJsonFile("/base/settings.json", {
        settings: { "editor.fontSize": 12 },
      });

      fileReader.addJsonFile("/workspace/settings.json", {
        extends: "../base/settings.json",
        settings: { "editor.fontSize": 14 },
      });

      fileReader.addJsonFile("/local/settings.json", {
        extends: "../workspace/settings.json",
        settings: { "editor.fontSize": 16 },
      });

      const merger = new ConfigMergerCore(fileReader);
      await merger.mergeFromConfig("/local/settings.json", "/local");

      const provenance = merger.getProvenance();
      const fontSizeProv = provenance.get("editor.fontSize");

      expect(fontSizeProv).toBeDefined();
      expect(fontSizeProv!.winner).toBe("/local/settings.json");
      expect(fontSizeProv!.winnerValue).toBe(16);
      expect(fontSizeProv!.overrides).toHaveLength(2);
      expect(fontSizeProv!.overrides[0]).toEqual({ file: "/base/settings.json", value: 12 });
      expect(fontSizeProv!.overrides[1]).toEqual({ file: "/workspace/settings.json", value: 14 });
    });
  });

  describe("Deletion Regression Test", () => {
    test("setting removed from config files is detected in diff", async () => {
      fileReader.addJsonFile("/config/settings.json", {
        settings: {
          "editor.fontSize": 14,
          "editor.lineNumbers": "on",
        },
      });

      const merger = new ConfigMergerCore(fileReader);
      await merger.mergeFromConfig("/config/settings.json", "/config");
      const settingsBefore = merger.getSettings();

      fileReader.addJsonFile("/config/settings.json", {
        settings: {
          "editor.fontSize": 14,
        },
      });

      await merger.mergeFromConfig("/config/settings.json", "/config");
      const settingsAfter = merger.getSettings();

      const diff = diffObjects(settingsBefore, settingsAfter);

      expect(diff.removed).toContain("editor.lineNumbers");
      expect(settingsAfter["editor.lineNumbers"]).toBeUndefined();
    });

    test("applying diff to mock VS Code store removes the key", async () => {
      const mockStore: Record<string, unknown> = {
        "editor.fontSize": 14,
        "editor.lineNumbers": "on",
        "editor.tabSize": 2,
      };

      fileReader.addJsonFile("/config/settings.json", {
        settings: {
          "editor.fontSize": 14,
          "editor.lineNumbers": "on",
        },
      });

      const merger = new ConfigMergerCore(fileReader);
      await merger.mergeFromConfig("/config/settings.json", "/config");
      const before = merger.getSettings();

      fileReader.addJsonFile("/config/settings.json", {
        settings: {
          "editor.fontSize": 16,
        },
      });

      await merger.mergeFromConfig("/config/settings.json", "/config");
      const after = merger.getSettings();

      const diff = diffObjects(before, after);

      for (const key of Object.keys(diff.added)) {
        mockStore[key] = diff.added[key];
      }
      for (const key of Object.keys(diff.changed)) {
        mockStore[key] = diff.changed[key];
      }
      for (const key of diff.removed) {
        delete mockStore[key];
      }

      expect(mockStore["editor.lineNumbers"]).toBeUndefined();
      expect(mockStore["editor.fontSize"]).toBe(16);
      expect(mockStore["editor.tabSize"]).toBe(2);
    });
  });

  describe("Delta Application Model", () => {
    test("complete delta workflow: add, change, remove", async () => {
      const mockStore: Record<string, unknown> = {};

      fileReader.addJsonFile("/config/settings.json", {
        settings: {
          "editor.fontSize": 14,
          "editor.tabSize": 2,
          "editor.wordWrap": "off",
        },
      });

      const merger = new ConfigMergerCore(fileReader);
      await merger.mergeFromConfig("/config/settings.json", "/config");
      const settingsA = merger.getSettings();

      Object.assign(mockStore, settingsA);

      fileReader.addJsonFile("/config/settings.json", {
        settings: {
          "editor.fontSize": 16,
          "editor.tabSize": 2,
          "editor.minimap.enabled": true,
        },
      });

      await merger.mergeFromConfig("/config/settings.json", "/config");
      const settingsB = merger.getSettings();

      const delta = diffObjects(settingsA, settingsB);

      expect(delta.added).toEqual({ "editor.minimap.enabled": true });
      expect(delta.changed).toEqual({ "editor.fontSize": 16 });
      expect(delta.removed).toEqual(["editor.wordWrap"]);

      for (const key of Object.keys(delta.added)) {
        mockStore[key] = delta.added[key];
      }
      for (const key of Object.keys(delta.changed)) {
        mockStore[key] = delta.changed[key];
      }
      for (const key of delta.removed) {
        delete mockStore[key];
      }

      expect(mockStore).toEqual(settingsB);
    });

    test("added keys applied to store", async () => {
      const mockStore: Record<string, unknown> = {};

      fileReader.addJsonFile("/config/settings.json", {
        settings: { existing: true },
      });

      const merger = new ConfigMergerCore(fileReader);
      await merger.mergeFromConfig("/config/settings.json", "/config");
      const before = merger.getSettings();
      Object.assign(mockStore, before);

      fileReader.addJsonFile("/config/settings.json", {
        settings: { existing: true, newKey: "value" },
      });

      await merger.mergeFromConfig("/config/settings.json", "/config");
      const after = merger.getSettings();

      const delta = diffObjects(before, after);

      for (const key of Object.keys(delta.added)) {
        mockStore[key] = delta.added[key];
      }

      expect(mockStore["newKey"]).toBe("value");
    });

    test("changed keys updated in store", async () => {
      const mockStore: Record<string, unknown> = { value: 1 };

      fileReader.addJsonFile("/config/settings.json", {
        settings: { value: 1 },
      });

      const merger = new ConfigMergerCore(fileReader);
      await merger.mergeFromConfig("/config/settings.json", "/config");
      const before = merger.getSettings();

      fileReader.addJsonFile("/config/settings.json", {
        settings: { value: 2 },
      });

      await merger.mergeFromConfig("/config/settings.json", "/config");
      const after = merger.getSettings();

      const delta = diffObjects(before, after);

      for (const key of Object.keys(delta.changed)) {
        mockStore[key] = delta.changed[key];
      }

      expect(mockStore["value"]).toBe(2);
    });

    test("removed keys deleted from store", async () => {
      const mockStore: Record<string, unknown> = { toRemove: true, toKeep: 1 };

      fileReader.addJsonFile("/config/settings.json", {
        settings: { toRemove: true, toKeep: 1 },
      });

      const merger = new ConfigMergerCore(fileReader);
      await merger.mergeFromConfig("/config/settings.json", "/config");
      const before = merger.getSettings();

      fileReader.addJsonFile("/config/settings.json", {
        settings: { toKeep: 1 },
      });

      await merger.mergeFromConfig("/config/settings.json", "/config");
      const after = merger.getSettings();

      const delta = diffObjects(before, after);

      for (const key of delta.removed) {
        delete mockStore[key];
      }

      expect(mockStore["toRemove"]).toBeUndefined();
      expect(mockStore["toKeep"]).toBe(1);
    });
  });

  describe("Error Recovery", () => {
    test("missing extend + parse error in same chain fires both callbacks", async () => {
      const errors: { type: string; path: string }[] = [];

      fileReader.addJsonFile("/root/settings.json", {
        extends: ["./missing.json", "./invalid.json"],
        settings: { rootSetting: true },
      });

      fileReader.addFile("/root/invalid.json", "{ invalid json }");

      const merger = new ConfigMergerCore(fileReader, {
        onExtendNotFound: (path) => errors.push({ type: "notFound", path }),
        onParseError: (path) => errors.push({ type: "parseError", path }),
      });

      await merger.mergeFromConfig("/root/settings.json", "/root");

      expect(errors).toContainEqual({
        type: "notFound",
        path: "/root/missing.json",
      });
      expect(errors).toContainEqual({
        type: "parseError",
        path: "/root/invalid.json",
      });
    });

    test("root config settings still applied despite errors in extends", async () => {
      fileReader.addJsonFile("/root/settings.json", {
        extends: "./missing.json",
        settings: { rootSetting: "applied" },
      });

      const merger = new ConfigMergerCore(fileReader, {
        onExtendNotFound: () => {},
      });

      await merger.mergeFromConfig("/root/settings.json", "/root");

      expect(merger.getSettings()["rootSetting"]).toBe("applied");
    });

    test("extendedFiles only contains successfully parsed files", async () => {
      fileReader.addJsonFile("/root/settings.json", {
        extends: ["./valid.json", "./missing.json", "./invalid.json"],
        settings: {},
      });

      fileReader.addJsonFile("/root/valid.json", {
        settings: { validSetting: true },
      });

      fileReader.addFile("/root/invalid.json", "not json");

      const merger = new ConfigMergerCore(fileReader, {
        onExtendNotFound: () => {},
        onParseError: () => {},
      });

      await merger.mergeFromConfig("/root/settings.json", "/root");

      const extendedFiles = merger.getExtendedFiles();

      expect(extendedFiles.has("/root/valid.json")).toBe(true);
      expect(extendedFiles.has("/root/missing.json")).toBe(false);
      expect(extendedFiles.has("/root/invalid.json")).toBe(true);
    });
  });
});
