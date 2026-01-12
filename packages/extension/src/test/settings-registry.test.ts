import * as assert from "assert";
import * as vscode from "vscode";
import { SettingsRegistry } from "../core/settings-registry";

suite("Settings Registry", () => {
  suiteSetup(async function () {
    this.timeout(10000);
    const ext = vscode.extensions.getExtension("wrath-codes.@layered/extension");
    if (ext && !ext.isActive) {
      await ext.activate();
    }
  });

  test("registry should contain our own extension settings", () => {
    SettingsRegistry.rebuild();

    assert.ok(
      SettingsRegistry.isKnownKey("layered-settings.autoGitignore"),
      "layered-settings.autoGitignore should be a known setting"
    );
  });

  test("isKnownKey returns false for unknown settings", () => {
    SettingsRegistry.rebuild();

    assert.strictEqual(
      SettingsRegistry.isKnownKey("completely.made.up.setting.xyz"),
      false,
      "Made-up setting should not be known"
    );
  });

  test("getMetadata returns description for known settings", () => {
    SettingsRegistry.rebuild();

    const meta = SettingsRegistry.getMetadata("layered-settings.autoGitignore");
    assert.ok(meta, "Metadata should exist for layered-settings.autoGitignore");
    assert.ok(
      meta.description || meta.markdownDescription,
      "Setting should have a description"
    );
  });

  test("getMetadata returns extensionId for known settings", () => {
    SettingsRegistry.rebuild();

    const meta = SettingsRegistry.getMetadata("layered-settings.autoGitignore");
    assert.ok(meta, "Metadata should exist for layered-settings.autoGitignore");
    assert.ok(meta.extensionId, "Setting should have an extensionId");
  });

  test("getMetadata returns extensionUri for known settings", () => {
    SettingsRegistry.rebuild();

    const meta = SettingsRegistry.getMetadata("layered-settings.autoGitignore");
    assert.ok(meta, "Metadata should exist for layered-settings.autoGitignore");
    assert.ok(meta.extensionUri, "Setting should have an extensionUri");
    assert.ok(
      meta.extensionUri instanceof vscode.Uri,
      "extensionUri should be a Uri"
    );
  });

  test("getMetadata returns sourceFile for known settings", () => {
    SettingsRegistry.rebuild();

    const meta = SettingsRegistry.getMetadata("layered-settings.autoGitignore");
    assert.ok(meta, "Metadata should exist for layered-settings.autoGitignore");
    assert.ok(meta.sourceFile, "Setting should have a sourceFile");
    assert.ok(
      meta.sourceFile.fsPath.endsWith("package.json"),
      "sourceFile should point to package.json"
    );
  });

  test("getMetadata returns undefined for unknown settings", () => {
    SettingsRegistry.rebuild();

    const meta = SettingsRegistry.getMetadata("completely.made.up.setting.xyz");
    assert.strictEqual(meta, undefined, "Unknown setting should return undefined");
  });

  test("getAllKeys returns an array", () => {
    SettingsRegistry.rebuild();

    const keys = SettingsRegistry.getAllKeys();
    assert.ok(Array.isArray(keys), "getAllKeys should return an array");
    assert.ok(keys.length >= 1, "Should have at least our own setting registered");
  });

  test("getSettingsCount returns a positive number", () => {
    SettingsRegistry.rebuild();

    const count = SettingsRegistry.getSettingsCount();
    assert.ok(count >= 1, "Should have at least our own setting registered");
  });

  test("getAllSettings returns iterable with metadata objects", () => {
    SettingsRegistry.rebuild();

    let count = 0;
    for (const meta of SettingsRegistry.getAllSettings()) {
      assert.ok(meta.key, "Each metadata should have a key");
      assert.ok(meta.extensionId, "Each metadata should have an extensionId");
      count++;
      if (count >= 1) break;
    }
    assert.ok(count >= 1, "Should iterate over settings");
  });

  test("settings have type information when available", () => {
    SettingsRegistry.rebuild();

    const meta = SettingsRegistry.getMetadata("layered-settings.autoGitignore");
    assert.ok(meta, "Metadata should exist for layered-settings.autoGitignore");
    assert.ok(meta.type, "layered-settings.autoGitignore should have a type");
    assert.strictEqual(meta.type, "boolean", "Type should be boolean");
  });

  test("settings have default values when defined", () => {
    SettingsRegistry.rebuild();

    const meta = SettingsRegistry.getMetadata("layered-settings.autoGitignore");
    assert.ok(meta, "Metadata should exist for layered-settings.autoGitignore");
    assert.strictEqual(meta.default, true, "Default should be true");
  });
});
