import { describe, test, expect, beforeEach } from "bun:test";
import { ConfigMergerCore, type MergerCallbacks } from "../../src/merging/merger";
import { InMemoryFileReader } from "../mocks/in-memory-file-reader";

describe("ConfigMergerCore", () => {
  let fileReader: InMemoryFileReader;
  let callbacks: MergerCallbacks;
  let merger: ConfigMergerCore;

  beforeEach(() => {
    fileReader = new InMemoryFileReader();
    callbacks = {};
    merger = new ConfigMergerCore(fileReader, callbacks);
  });

  describe("Basic Operations", () => {
    test("single config file loading", async () => {
      fileReader.addJsonFile("/config.json", {
        settings: { tabSize: 4, theme: "dark" },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({ tabSize: 4, theme: "dark" });
    });

    test("config with no settings (only metadata)", async () => {
      fileReader.addJsonFile("/config.json", {
        name: "my-config",
        version: "1.0.0",
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({});
    });

    test("missing root file returns no settings (no callbacks fired)", async () => {
      const parseErrorCalled = { value: false };
      const extendNotFoundCalled = { value: false };
      callbacks.onParseError = () => { parseErrorCalled.value = true; };
      callbacks.onExtendNotFound = () => { extendNotFoundCalled.value = true; };

      await merger.mergeFromConfig("/missing.json", "/");

      expect(merger.getSettings()).toEqual({});
      expect(parseErrorCalled.value).toBe(false);
      expect(extendNotFoundCalled.value).toBe(false);
    });

    test("parse error triggers onParseError callback", async () => {
      const parseErrors: Array<{ path: string; error: unknown }> = [];
      callbacks.onParseError = (path, error) => {
        parseErrors.push({ path, error });
      };

      fileReader.addFile("/config.json", "{ invalid json }");

      await merger.mergeFromConfig("/config.json", "/");

      expect(parseErrors.length).toBe(1);
      expect(parseErrors[0].path).toBe("/config.json");
      expect(merger.getSettings()).toEqual({});
    });

    test("reset() clears all internal state", async () => {
      fileReader.addJsonFile("/config.json", {
        settings: { tabSize: 4 },
        extends: "./base.json",
      });
      fileReader.addJsonFile("/base.json", {
        settings: { theme: "light" },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(Object.keys(merger.getSettings()).length).toBeGreaterThan(0);
      expect(merger.getExtendedFiles().size).toBeGreaterThan(0);

      merger.reset();

      expect(merger.getSettings()).toEqual({});
      expect(merger.getProvenance().size).toBe(0);
      expect(merger.getOwnedKeys().size).toBe(0);
      expect(merger.getExtendedFiles().size).toBe(0);
    });
  });

  describe("Extends Chain", () => {
    test("single extends (string)", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: { tabSize: 4 },
      });
      fileReader.addJsonFile("/base.json", {
        settings: { theme: "dark" },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({ tabSize: 4, theme: "dark" });
    });

    test("multiple extends (array)", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: ["./base1.json", "./base2.json"],
        settings: { myKey: "root" },
      });
      fileReader.addJsonFile("/base1.json", {
        settings: { fromBase1: true },
      });
      fileReader.addJsonFile("/base2.json", {
        settings: { fromBase2: true },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({
        fromBase1: true,
        fromBase2: true,
        myKey: "root",
      });
    });

    test("multi-level extends (A → B → C) - C merged first, then B, then A", async () => {
      fileReader.addJsonFile("/A.json", {
        extends: "./B.json",
        settings: { level: "A" },
      });
      fileReader.addJsonFile("/B.json", {
        extends: "./C.json",
        settings: { level: "B" },
      });
      fileReader.addJsonFile("/C.json", {
        settings: { level: "C" },
      });

      await merger.mergeFromConfig("/A.json", "/");

      expect(merger.getSettings().level).toBe("A");

      const provenance = merger.getProvenance();
      const levelProv = provenance.get("level");
      expect(levelProv?.winner).toBe("A.json");
      expect(levelProv?.overrides.length).toBe(2);
      expect(levelProv?.overrides[0].file).toBe("C.json");
      expect(levelProv?.overrides[1].file).toBe("B.json");
    });

    test("DAG extends (A extends B and C; C also extends B)", async () => {
      fileReader.addJsonFile("/A.json", {
        extends: ["./B.json", "./C.json"],
        settings: { fromA: true },
      });
      fileReader.addJsonFile("/B.json", {
        settings: { shared: "B", fromB: true },
      });
      fileReader.addJsonFile("/C.json", {
        extends: "./B.json",
        settings: { shared: "C", fromC: true },
      });

      await merger.mergeFromConfig("/A.json", "/");

      const settings = merger.getSettings();
      expect(settings.fromA).toBe(true);
      expect(settings.fromB).toBe(true);
      expect(settings.fromC).toBe(true);
    });

    test("getExtendedFiles() contains all extended files (not root)", async () => {
      fileReader.addJsonFile("/root.json", {
        extends: ["./child1.json", "./child2.json"],
        settings: {},
      });
      fileReader.addJsonFile("/child1.json", {
        extends: "./grandchild.json",
        settings: {},
      });
      fileReader.addJsonFile("/child2.json", {
        settings: {},
      });
      fileReader.addJsonFile("/grandchild.json", {
        settings: {},
      });

      await merger.mergeFromConfig("/root.json", "/");

      const extendedFiles = merger.getExtendedFiles();
      expect(extendedFiles.has("/child1.json")).toBe(true);
      expect(extendedFiles.has("/child2.json")).toBe(true);
      expect(extendedFiles.has("/grandchild.json")).toBe(true);
      expect(extendedFiles.has("/root.json")).toBe(false);
    });
  });

  describe("Circular Dependency Detection", () => {
    test("self-extend (A extends A) - triggers onCircularDependency", async () => {
      const circularPaths: string[] = [];
      callbacks.onCircularDependency = (path) => {
        circularPaths.push(path);
      };

      fileReader.addJsonFile("/A.json", {
        extends: "./A.json",
        settings: { key: "value" },
      });

      await merger.mergeFromConfig("/A.json", "/");

      expect(circularPaths).toContain("/A.json");
    });

    test("two-file cycle (A extends B, B extends A) - triggers callback", async () => {
      const circularPaths: string[] = [];
      callbacks.onCircularDependency = (path) => {
        circularPaths.push(path);
      };

      fileReader.addJsonFile("/A.json", {
        extends: "./B.json",
        settings: { fromA: true },
      });
      fileReader.addJsonFile("/B.json", {
        extends: "./A.json",
        settings: { fromB: true },
      });

      await merger.mergeFromConfig("/A.json", "/");

      expect(circularPaths).toContain("/A.json");
    });

    test("merger still works after circular detection", async () => {
      callbacks.onCircularDependency = () => {};

      fileReader.addJsonFile("/A.json", {
        extends: "./B.json",
        settings: { fromA: true },
      });
      fileReader.addJsonFile("/B.json", {
        extends: "./A.json",
        settings: { fromB: true },
      });

      await merger.mergeFromConfig("/A.json", "/");

      const settings = merger.getSettings();
      expect(settings.fromB).toBe(true);
      expect(settings.fromA).toBe(true);
    });
  });

  describe("Invalid Extends Handling", () => {
    test("non-.json file triggers onInvalidExtend", async () => {
      const invalidMessages: string[] = [];
      callbacks.onInvalidExtend = (message) => {
        invalidMessages.push(message);
      };

      fileReader.addJsonFile("/config.json", {
        extends: "./base.yaml",
        settings: { key: "value" },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(invalidMessages.length).toBe(1);
      expect(invalidMessages[0]).toContain(".json");
    });

    test("HTTP/HTTPS URLs are silently skipped", async () => {
      const invalidMessages: string[] = [];
      const notFoundPaths: string[] = [];
      callbacks.onInvalidExtend = (message) => { invalidMessages.push(message); };
      callbacks.onExtendNotFound = (path) => { notFoundPaths.push(path); };

      fileReader.addJsonFile("/config.json", {
        extends: ["https://example.com/config.json", "http://example.com/config.json"],
        settings: { key: "value" },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(invalidMessages.length).toBe(0);
      expect(notFoundPaths.length).toBe(0);
      expect(merger.getSettings()).toEqual({ key: "value" });
    });

    test("missing extend file triggers onExtendNotFound", async () => {
      const notFoundPaths: string[] = [];
      callbacks.onExtendNotFound = (path) => {
        notFoundPaths.push(path);
      };

      fileReader.addJsonFile("/config.json", {
        extends: "./missing.json",
        settings: { key: "value" },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(notFoundPaths.length).toBe(1);
      expect(notFoundPaths[0]).toBe("/missing.json");
    });
  });

  describe("Settings Merge Behavior", () => {
    test("scalar override (later file wins)", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: { tabSize: 4 },
      });
      fileReader.addJsonFile("/base.json", {
        settings: { tabSize: 2 },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings().tabSize).toBe(4);
    });

    test("array concatenation (values combined in order)", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: { plugins: ["pluginC"] },
      });
      fileReader.addJsonFile("/base.json", {
        settings: { plugins: ["pluginA", "pluginB"] },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings().plugins).toEqual(["pluginA", "pluginB", "pluginC"]);
    });

    test("language-specific settings ([typescript]) shallow merge", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: {
          "[typescript]": { tabSize: 4 },
        },
      });
      fileReader.addJsonFile("/base.json", {
        settings: {
          "[typescript]": { insertSpaces: true },
        },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()["[typescript]"]).toEqual({
        insertSpaces: true,
        tabSize: 4,
      });
    });

    test("language-specific with non-object value (uses scalar branch)", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: {
          "[python]": "disabled",
        },
      });
      fileReader.addJsonFile("/base.json", {
        settings: {
          "[python]": "enabled",
        },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()["[python]"]).toBe("disabled");
    });

    test("object value overridden by scalar", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: { format: "simple" },
      });
      fileReader.addJsonFile("/base.json", {
        settings: { format: { type: "complex", options: {} } },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings().format).toBe("simple");
    });

    test("scalar overridden by array", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: { items: ["a", "b"] },
      });
      fileReader.addJsonFile("/base.json", {
        settings: { items: "legacy-value" },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings().items).toEqual(["a", "b"]);
    });
  });

  describe("Provenance Tracking", () => {
    test("single file - winner is that file, no overrides", async () => {
      fileReader.addJsonFile("/config.json", {
        settings: { theme: "dark" },
      });

      await merger.mergeFromConfig("/config.json", "/");

      const provenance = merger.getProvenance();
      const themeProv = provenance.get("theme");
      expect(themeProv?.winner).toBe("config.json");
      expect(themeProv?.winnerValue).toBe("dark");
      expect(themeProv?.overrides).toEqual([]);
    });

    test("two files with same key - winner is later file, overrides contains earlier", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: { theme: "dark" },
      });
      fileReader.addJsonFile("/base.json", {
        settings: { theme: "light" },
      });

      await merger.mergeFromConfig("/config.json", "/");

      const provenance = merger.getProvenance();
      const themeProv = provenance.get("theme");
      expect(themeProv?.winner).toBe("config.json");
      expect(themeProv?.overrides.length).toBe(1);
      expect(themeProv?.overrides[0]).toEqual({ file: "base.json", value: "light" });
    });

    test("three+ files with same key - overrides chain is correct", async () => {
      fileReader.addJsonFile("/A.json", {
        extends: "./B.json",
        settings: { key: "A" },
      });
      fileReader.addJsonFile("/B.json", {
        extends: "./C.json",
        settings: { key: "B" },
      });
      fileReader.addJsonFile("/C.json", {
        settings: { key: "C" },
      });

      await merger.mergeFromConfig("/A.json", "/");

      const provenance = merger.getProvenance();
      const keyProv = provenance.get("key");
      expect(keyProv?.winner).toBe("A.json");
      expect(keyProv?.overrides.length).toBe(2);
      expect(keyProv?.overrides[0]).toEqual({ file: "C.json", value: "C" });
      expect(keyProv?.overrides[1]).toEqual({ file: "B.json", value: "B" });
    });

    test("array keys - winner string concatenates file names", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: { plugins: ["c"] },
      });
      fileReader.addJsonFile("/base.json", {
        settings: { plugins: ["a", "b"] },
      });

      await merger.mergeFromConfig("/config.json", "/");

      const provenance = merger.getProvenance();
      const pluginsProv = provenance.get("plugins");
      expect(pluginsProv?.winner).toBe("base.json, config.json");
    });

    test("getConflictedKeys() returns keys with overrides", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: { theme: "dark", tabSize: 4 },
      });
      fileReader.addJsonFile("/base.json", {
        settings: { theme: "light", otherKey: "value" },
      });

      await merger.mergeFromConfig("/config.json", "/");

      const conflicted = merger.getConflictedKeys();
      expect(conflicted).toContain("theme");
      expect(conflicted).not.toContain("tabSize");
      expect(conflicted).not.toContain("otherKey");
    });

    test("getConflictedKeys() excludes array keys", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: { plugins: ["c"], scalar: "override" },
      });
      fileReader.addJsonFile("/base.json", {
        settings: { plugins: ["a", "b"], scalar: "base" },
      });

      await merger.mergeFromConfig("/config.json", "/");

      const conflicted = merger.getConflictedKeys();
      expect(conflicted).toContain("scalar");
      expect(conflicted).not.toContain("plugins");
    });
  });

  describe("Accessor Clone Semantics", () => {
    test("getSettings() returns a copy (mutations don't affect internal state)", async () => {
      fileReader.addJsonFile("/config.json", {
        settings: { theme: "dark" },
      });

      await merger.mergeFromConfig("/config.json", "/");

      const settings = merger.getSettings();
      settings.theme = "modified";
      settings.newKey = "added";

      expect(merger.getSettings().theme).toBe("dark");
      expect(merger.getSettings().newKey).toBeUndefined();
    });

    test("getProvenance() returns a copy", async () => {
      fileReader.addJsonFile("/config.json", {
        settings: { theme: "dark" },
      });

      await merger.mergeFromConfig("/config.json", "/");

      const provenance = merger.getProvenance();
      provenance.set("fake", { winner: "fake.json", winnerValue: "x", overrides: [] });
      provenance.delete("theme");

      expect(merger.getProvenance().has("theme")).toBe(true);
      expect(merger.getProvenance().has("fake")).toBe(false);
    });

    test("getOwnedKeys() returns a copy", async () => {
      fileReader.addJsonFile("/config.json", {
        settings: { theme: "dark" },
      });

      await merger.mergeFromConfig("/config.json", "/");

      const keys = merger.getOwnedKeys();
      keys.add("fake");
      keys.delete("theme");

      expect(merger.getOwnedKeys().has("theme")).toBe(true);
      expect(merger.getOwnedKeys().has("fake")).toBe(false);
    });

    test("getExtendedFiles() returns a copy", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: {},
      });
      fileReader.addJsonFile("/base.json", {
        settings: {},
      });

      await merger.mergeFromConfig("/config.json", "/");

      const files = merger.getExtendedFiles();
      files.add("/fake.json");
      files.delete("/base.json");

      expect(merger.getExtendedFiles().has("/base.json")).toBe(true);
      expect(merger.getExtendedFiles().has("/fake.json")).toBe(false);
    });
  });

  describe("Reset and Reuse", () => {
    test("second mergeFromConfig call doesn't leak state from first", async () => {
      fileReader.addJsonFile("/first.json", {
        extends: "./first-base.json",
        settings: { fromFirst: true, shared: "first" },
      });
      fileReader.addJsonFile("/first-base.json", {
        settings: { firstBase: true },
      });

      await merger.mergeFromConfig("/first.json", "/");

      expect(merger.getSettings().fromFirst).toBe(true);
      expect(merger.getSettings().firstBase).toBe(true);
      expect(merger.getExtendedFiles().has("/first-base.json")).toBe(true);

      fileReader.addJsonFile("/second.json", {
        settings: { fromSecond: true, shared: "second" },
      });

      await merger.mergeFromConfig("/second.json", "/");

      expect(merger.getSettings().fromSecond).toBe(true);
      expect(merger.getSettings().fromFirst).toBeUndefined();
      expect(merger.getSettings().firstBase).toBeUndefined();
      expect(merger.getSettings().shared).toBe("second");
      expect(merger.getExtendedFiles().size).toBe(0);
    });

    test("parse error then valid file - second merge succeeds cleanly", async () => {
      const parseErrors: string[] = [];
      callbacks.onParseError = (path) => { parseErrors.push(path); };

      fileReader.addFile("/bad.json", "{ invalid }");

      await merger.mergeFromConfig("/bad.json", "/");

      expect(parseErrors.length).toBe(1);
      expect(merger.getSettings()).toEqual({});

      fileReader.addJsonFile("/good.json", {
        settings: { valid: true },
      });

      await merger.mergeFromConfig("/good.json", "/");

      expect(merger.getSettings()).toEqual({ valid: true });
    });
  });
});
