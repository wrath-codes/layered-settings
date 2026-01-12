import { describe, test, expect, beforeEach } from "bun:test";
import { ConfigMergerCore, type MergerCallbacks } from "../../src/merging/merger";
import type { LayeredConfig } from "../../src/schemas/config";
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
      expect(levelProv?.winner).toBe("/A.json");
      expect(levelProv?.overrides.length).toBe(2);
      expect(levelProv?.overrides[0].file).toBe("/C.json");
      expect(levelProv?.overrides[1].file).toBe("/B.json");
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
      expect(themeProv?.winner).toBe("/config.json");
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
      expect(themeProv?.winner).toBe("/config.json");
      expect(themeProv?.overrides.length).toBe(1);
      expect(themeProv?.overrides[0]).toEqual({ file: "/base.json", value: "light" });
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
      expect(keyProv?.winner).toBe("/A.json");
      expect(keyProv?.overrides.length).toBe(2);
      expect(keyProv?.overrides[0]).toEqual({ file: "/C.json", value: "C" });
      expect(keyProv?.overrides[1]).toEqual({ file: "/B.json", value: "B" });
    });

    test("array keys - winner is last contributing file", async () => {
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
      expect(pluginsProv?.winner).toBe("/config.json");
    });

    test("array keys - arraySegments tracks per-file contributions", async () => {
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
      expect(pluginsProv?.arraySegments).toHaveLength(2);
      expect(pluginsProv?.arraySegments?.[0]).toEqual({
        sourceFile: "/base.json",
        start: 0,
        length: 2,
      });
      expect(pluginsProv?.arraySegments?.[1]).toEqual({
        sourceFile: "/config.json",
        start: 2,
        length: 1,
      });
    });

    test("array keys - winnerValue is full merged array", async () => {
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
      expect(pluginsProv?.winnerValue).toEqual(["a", "b", "c"]);
    });

    test("array segments with three files in chain", async () => {
      fileReader.addJsonFile("/A.json", {
        extends: "./B.json",
        settings: { items: ["fromA"] },
      });
      fileReader.addJsonFile("/B.json", {
        extends: "./C.json",
        settings: { items: ["fromB1", "fromB2"] },
      });
      fileReader.addJsonFile("/C.json", {
        settings: { items: ["fromC"] },
      });

      await merger.mergeFromConfig("/A.json", "/");

      const provenance = merger.getProvenance();
      const itemsProv = provenance.get("items");
      expect(itemsProv?.arraySegments).toHaveLength(3);
      expect(itemsProv?.arraySegments?.[0]).toEqual({
        sourceFile: "/C.json",
        start: 0,
        length: 1,
      });
      expect(itemsProv?.arraySegments?.[1]).toEqual({
        sourceFile: "/B.json",
        start: 1,
        length: 2,
      });
      expect(itemsProv?.arraySegments?.[2]).toEqual({
        sourceFile: "/A.json",
        start: 3,
        length: 1,
      });
      expect(itemsProv?.winnerValue).toEqual(["fromC", "fromB1", "fromB2", "fromA"]);
    });

    test("empty array - segment with length 0", async () => {
      fileReader.addJsonFile("/config.json", {
        settings: { items: [] },
      });

      await merger.mergeFromConfig("/config.json", "/");

      const provenance = merger.getProvenance();
      const itemsProv = provenance.get("items");
      expect(itemsProv?.arraySegments).toHaveLength(1);
      expect(itemsProv?.arraySegments?.[0]).toEqual({
        sourceFile: "/config.json",
        start: 0,
        length: 0,
      });
    });

    test("single file array - one segment covering full array", async () => {
      fileReader.addJsonFile("/config.json", {
        settings: { items: ["a", "b", "c"] },
      });

      await merger.mergeFromConfig("/config.json", "/");

      const provenance = merger.getProvenance();
      const itemsProv = provenance.get("items");
      expect(itemsProv?.arraySegments).toHaveLength(1);
      expect(itemsProv?.arraySegments?.[0]).toEqual({
        sourceFile: "/config.json",
        start: 0,
        length: 3,
      });
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

  describe("mergeFromConfigChain", () => {
    test("chain of 3 configs merges in order (parent → child)", async () => {
      fileReader.addJsonFile("/parent/config.json", {
        settings: { level: "parent", parentOnly: true },
      });
      fileReader.addJsonFile("/middle/config.json", {
        settings: { level: "middle", middleOnly: true },
      });
      fileReader.addJsonFile("/child/config.json", {
        settings: { level: "child", childOnly: true },
      });

      await merger.mergeFromConfigChain([
        { configPath: "/parent/config.json", baseDir: "/parent" },
        { configPath: "/middle/config.json", baseDir: "/middle" },
        { configPath: "/child/config.json", baseDir: "/child" },
      ]);

      const settings = merger.getSettings();
      expect(settings.level).toBe("child");
      expect(settings.parentOnly).toBe(true);
      expect(settings.middleOnly).toBe(true);
      expect(settings.childOnly).toBe(true);

      const provenance = merger.getProvenance();
      const levelProv = provenance.get("level");
      expect(levelProv?.winner).toBe("/child/config.json");
      expect(levelProv?.overrides).toHaveLength(2);
      expect(levelProv?.overrides[0].file).toBe("/parent/config.json");
      expect(levelProv?.overrides[1].file).toBe("/middle/config.json");
    });

    test("empty chain is no-op, returns empty settings", async () => {
      await merger.mergeFromConfigChain([]);

      expect(merger.getSettings()).toEqual({});
      expect(merger.getProvenance().size).toBe(0);
    });

    test("each config's extends resolves within its layer", async () => {
      fileReader.addJsonFile("/parent/config.json", {
        extends: "./base.json",
        settings: { fromParentConfig: true },
      });
      fileReader.addJsonFile("/parent/base.json", {
        settings: { fromParentBase: true },
      });
      fileReader.addJsonFile("/child/config.json", {
        extends: "./base.json",
        settings: { fromChildConfig: true },
      });
      fileReader.addJsonFile("/child/base.json", {
        settings: { fromChildBase: true },
      });

      await merger.mergeFromConfigChain([
        { configPath: "/parent/config.json", baseDir: "/parent" },
        { configPath: "/child/config.json", baseDir: "/child" },
      ]);

      const settings = merger.getSettings();
      expect(settings.fromParentBase).toBe(true);
      expect(settings.fromParentConfig).toBe(true);
      expect(settings.fromChildBase).toBe(true);
      expect(settings.fromChildConfig).toBe(true);
    });

    test("parse error in one config still applies others, fires callback", async () => {
      const parseErrors: string[] = [];
      callbacks.onParseError = (path) => parseErrors.push(path);

      fileReader.addJsonFile("/good1/config.json", {
        settings: { fromGood1: true },
      });
      fileReader.addFile("/bad/config.json", "{ invalid json }");
      fileReader.addJsonFile("/good2/config.json", {
        settings: { fromGood2: true },
      });

      await merger.mergeFromConfigChain([
        { configPath: "/good1/config.json", baseDir: "/good1" },
        { configPath: "/bad/config.json", baseDir: "/bad" },
        { configPath: "/good2/config.json", baseDir: "/good2" },
      ]);

      expect(parseErrors).toContain("/bad/config.json");
      expect(merger.getSettings().fromGood1).toBe(true);
      expect(merger.getSettings().fromGood2).toBe(true);
    });

    test("two config.json files in different directories are distinguishable in provenance", async () => {
      fileReader.addJsonFile("/projectA/config.json", {
        settings: { shared: "A" },
      });
      fileReader.addJsonFile("/projectB/config.json", {
        settings: { shared: "B" },
      });

      await merger.mergeFromConfigChain([
        { configPath: "/projectA/config.json", baseDir: "/projectA" },
        { configPath: "/projectB/config.json", baseDir: "/projectB" },
      ]);

      const provenance = merger.getProvenance();
      const sharedProv = provenance.get("shared");
      expect(sharedProv?.winner).toBe("/projectB/config.json");
      expect(sharedProv?.overrides[0].file).toBe("/projectA/config.json");
    });

    test("path normalization converts backslashes to forward slashes", async () => {
      fileReader.addJsonFile("/win/path/config.json", {
        settings: { key: "value" },
      });

      const originalResolve = fileReader.resolvePath.bind(fileReader);
      fileReader.resolvePath = (base: string, relative: string) => {
        const result = originalResolve(base, relative);
        return result.replace(/\//g, "\\");
      };

      await merger.mergeFromConfig("/win/path/config.json", "/win/path");

      const provenance = merger.getProvenance();
      const keyProv = provenance.get("key");
      expect(keyProv?.winner).not.toContain("\\");
      expect(keyProv?.winner).toContain("/");
    });

    test("provenance stores absolute paths, not basenames", async () => {
      fileReader.addJsonFile("/project/dir/config.json", {
        extends: "./base.json",
        settings: { fromConfig: true, shared: "config" },
      });
      fileReader.addJsonFile("/project/dir/base.json", {
        settings: { fromBase: true, shared: "base" },
      });

      await merger.mergeFromConfig("/project/dir/config.json", "/project/dir");

      const provenance = merger.getProvenance();

      // Winner should be absolute path, not just "config.json"
      const sharedProv = provenance.get("shared");
      expect(sharedProv?.winner).toBe("/project/dir/config.json");
      expect(sharedProv?.winner).not.toBe("config.json");

      // Overrides should also be absolute paths
      expect(sharedProv?.overrides[0].file).toBe("/project/dir/base.json");
      expect(sharedProv?.overrides[0].file).not.toBe("base.json");

      // All provenance entries should have absolute paths
      const fromConfigProv = provenance.get("fromConfig");
      expect(fromConfigProv?.winner.startsWith("/")).toBe(true);

      const fromBaseProv = provenance.get("fromBase");
      expect(fromBaseProv?.winner.startsWith("/")).toBe(true);
    });
  });

  describe("LayeredConfig Type", () => {
    test("root property is correctly typed as optional boolean", () => {
      const configWithRoot: LayeredConfig = {
        root: true,
        settings: { key: "value" },
      };
      expect(configWithRoot.root).toBe(true);

      const configWithoutRoot: LayeredConfig = {
        settings: { key: "value" },
      };
      expect(configWithoutRoot.root).toBeUndefined();

      const configWithFalseRoot: LayeredConfig = {
        root: false,
        extends: "./base.json",
        settings: {},
      };
      expect(configWithFalseRoot.root).toBe(false);
    });
  });

  describe("Enabled Flag", () => {
    test("enabled: false skips config file", async () => {
      fileReader.addJsonFile("/config.json", {
        enabled: false,
        settings: { tabSize: 4 },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({});
    });

    test("enabled: false skips extends chain", async () => {
      fileReader.addJsonFile("/config.json", {
        enabled: false,
        extends: ["./base.json"],
        settings: { tabSize: 4 },
      });
      fileReader.addJsonFile("/base.json", {
        settings: { fromBase: true },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({});
    });

    test("enabled: true processes normally", async () => {
      fileReader.addJsonFile("/config.json", {
        enabled: true,
        settings: { tabSize: 4 },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({ tabSize: 4 });
    });

    test("omitted enabled defaults to true (processes normally)", async () => {
      fileReader.addJsonFile("/config.json", {
        settings: { tabSize: 4 },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({ tabSize: 4 });
    });

    test("disabled child in extends array only skips that child", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: ["./a.json", "./b.json"],
        settings: { main: true },
      });
      fileReader.addJsonFile("/a.json", {
        enabled: false,
        settings: { fromA: true },
      });
      fileReader.addJsonFile("/b.json", {
        settings: { fromB: true },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({
        fromB: true,
        main: true,
      });
    });

    test("disabled grandparent skips entire chain below it", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: "./middle.json",
        settings: { fromConfig: true },
      });
      fileReader.addJsonFile("/middle.json", {
        enabled: false,
        extends: "./base.json",
        settings: { fromMiddle: true },
      });
      fileReader.addJsonFile("/base.json", {
        settings: { fromBase: true },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({ fromConfig: true });
      expect(merger.getSettings().fromMiddle).toBeUndefined();
      expect(merger.getSettings().fromBase).toBeUndefined();
    });

    test("enabled file extending disabled file only skips disabled", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: "./disabled.json",
        settings: { fromConfig: true },
      });
      fileReader.addJsonFile("/disabled.json", {
        enabled: false,
        extends: "./base.json",
        settings: { fromDisabled: true },
      });
      fileReader.addJsonFile("/base.json", {
        settings: { fromBase: true },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({ fromConfig: true });
    });

    test("disabled file not added to extendedFiles", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: ["./enabled.json", "./disabled.json"],
        settings: {},
      });
      fileReader.addJsonFile("/enabled.json", {
        settings: { fromEnabled: true },
      });
      fileReader.addJsonFile("/disabled.json", {
        enabled: false,
        settings: { fromDisabled: true },
      });

      await merger.mergeFromConfig("/config.json", "/");

      const extendedFiles = merger.getExtendedFiles();
      expect(extendedFiles.has("/enabled.json")).toBe(true);
      expect(extendedFiles.has("/disabled.json")).toBe(true);
    });

    test("re-enabling a file causes conflicts to be detected", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: ["./base.json", "./override.json"],
        settings: {},
      });
      fileReader.addJsonFile("/base.json", {
        settings: { shared: "base", onlyBase: true },
      });
      fileReader.addJsonFile("/override.json", {
        enabled: false,
        settings: { shared: "override", onlyOverride: true },
      });

      await merger.mergeFromConfig("/config.json", "/");
      expect(merger.getSettings().shared).toBe("base");
      expect(merger.getConflictedKeys()).not.toContain("shared");

      fileReader.addJsonFile("/override.json", {
        enabled: true,
        settings: { shared: "override", onlyOverride: true },
      });

      await merger.mergeFromConfig("/config.json", "/");
      expect(merger.getSettings().shared).toBe("override");
      expect(merger.getConflictedKeys()).toContain("shared");

      const provenance = merger.getProvenance();
      const sharedProv = provenance.get("shared");
      expect(sharedProv?.winner).toBe("/override.json");
      expect(sharedProv?.overrides[0].file).toBe("/base.json");
    });

    test("re-enabling restores full extends chain", async () => {
      fileReader.addJsonFile("/config.json", {
        extends: "./middle.json",
        settings: { fromConfig: true },
      });
      fileReader.addJsonFile("/middle.json", {
        enabled: false,
        extends: "./base.json",
        settings: { fromMiddle: true },
      });
      fileReader.addJsonFile("/base.json", {
        settings: { fromBase: true },
      });

      await merger.mergeFromConfig("/config.json", "/");
      expect(merger.getSettings().fromMiddle).toBeUndefined();
      expect(merger.getSettings().fromBase).toBeUndefined();

      fileReader.addJsonFile("/middle.json", {
        enabled: true,
        extends: "./base.json",
        settings: { fromMiddle: true },
      });

      await merger.mergeFromConfig("/config.json", "/");
      expect(merger.getSettings()).toEqual({
        fromBase: true,
        fromMiddle: true,
        fromConfig: true,
      });
    });
  });

  describe("JSONC Support", () => {
    test("config with single-line comments parses correctly", async () => {
      fileReader.addFile(
        "/config.json",
        `{
        // This is a comment
        "settings": {
          "tabSize": 4 // inline comment
        }
      }`
      );

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({ tabSize: 4 });
    });

    test("config with block comments parses correctly", async () => {
      fileReader.addFile(
        "/config.json",
        `{
        /* Block comment */
        "settings": {
          "theme": "dark"
        }
      }`
      );

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({ theme: "dark" });
    });

    test("config with trailing commas parses correctly", async () => {
      fileReader.addFile(
        "/config.json",
        `{
        "extends": ["./base.json",],
        "settings": {
          "tabSize": 4,
          "theme": "dark",
        },
      }`
      );
      fileReader.addJsonFile("/base.json", { settings: { fromBase: true } });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({
        fromBase: true,
        tabSize: 4,
        theme: "dark",
      });
    });

    test("config with mixed comments and trailing commas", async () => {
      fileReader.addFile(
        "/config.json",
        `{
        // Root config
        "extends": [
          "./base.json", // Base settings
        ],
        "settings": {
          /* Editor settings */
          "tabSize": 2,
          "insertSpaces": true, // Always use spaces
        },
      }`
      );
      fileReader.addJsonFile("/base.json", { settings: { theme: "light" } });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({
        theme: "light",
        tabSize: 2,
        insertSpaces: true,
      });
    });

    test("parse error in JSONC still triggers callback", async () => {
      const parseErrors: string[] = [];
      callbacks.onParseError = (path) => parseErrors.push(path);

      fileReader.addFile(
        "/config.json",
        `{
        "settings": { "unclosed": }
      }`
      );

      await merger.mergeFromConfig("/config.json", "/");

      expect(parseErrors).toContain("/config.json");
      expect(merger.getSettings()).toEqual({});
    });

    test("JSONC parse error includes offset information", async () => {
      let capturedError: unknown = null;
      callbacks.onParseError = (_path, error) => {
        capturedError = error;
      };

      fileReader.addFile("/config.json", `{ "key": }`);

      await merger.mergeFromConfig("/config.json", "/");

      expect(capturedError).toBeInstanceOf(Error);
      expect((capturedError as Error).message).toContain("offset");
    });
  });

  describe("Nested Object Merging", () => {
    test("nested objects are deep merged (child extends parent)", async () => {
      fileReader.addJsonFile("/base.json", {
        settings: {
          "editor.codeActionsOnSave": {
            "source.fixAll": true,
            "source.sortImports": false,
          },
        },
      });
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: {
          "editor.codeActionsOnSave": {
            "source.organizeImports": true,
          },
        },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({
        "editor.codeActionsOnSave": {
          "source.fixAll": true,
          "source.sortImports": false,
          "source.organizeImports": true,
        },
      });
    });

    test("nested object child overrides parent value for same key", async () => {
      fileReader.addJsonFile("/base.json", {
        settings: {
          "editor.codeActionsOnSave": {
            "source.fixAll": true,
          },
        },
      });
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: {
          "editor.codeActionsOnSave": {
            "source.fixAll": false,
          },
        },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({
        "editor.codeActionsOnSave": {
          "source.fixAll": false,
        },
      });
    });

    test("deeply nested objects merge at all levels", async () => {
      fileReader.addJsonFile("/base.json", {
        settings: {
          "custom.config": {
            level1: {
              a: 1,
              level2: {
                b: 2,
              },
            },
          },
        },
      });
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: {
          "custom.config": {
            level1: {
              c: 3,
              level2: {
                d: 4,
              },
            },
          },
        },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({
        "custom.config": {
          level1: {
            a: 1,
            c: 3,
            level2: {
              b: 2,
              d: 4,
            },
          },
        },
      });
    });

    test("nested arrays inside objects are concatenated", async () => {
      fileReader.addJsonFile("/base.json", {
        settings: {
          "editor.rulers": {
            columns: [80],
          },
        },
      });
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: {
          "editor.rulers": {
            columns: [120],
          },
        },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({
        "editor.rulers": {
          columns: [80, 120],
        },
      });
    });

    test("child can set nested key to null to explicitly clear", async () => {
      fileReader.addJsonFile("/base.json", {
        settings: {
          "editor.codeActionsOnSave": {
            "source.fixAll": true,
          },
        },
      });
      fileReader.addJsonFile("/config.json", {
        extends: "./base.json",
        settings: {
          "editor.codeActionsOnSave": null,
        },
      });

      await merger.mergeFromConfig("/config.json", "/");

      expect(merger.getSettings()).toEqual({
        "editor.codeActionsOnSave": null,
      });
    });
  });
});
