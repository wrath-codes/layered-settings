import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { resetSharedWorkspace } from "./test-workspace";

suite("Layered Settings Extension", () => {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const configDir = workspaceFolder
    ? path.join(workspaceFolder.uri.fsPath, ".vscode", "layered-settings", "settings")
    : "";
  const settingsPath = workspaceFolder
    ? path.join(workspaceFolder.uri.fsPath, ".vscode", "settings.json")
    : "";

  function resetWorkspace(): void {
    resetSharedWorkspace(configDir, settingsPath);
  }

  suiteSetup(async function () {
    this.timeout(30000);
    resetWorkspace();
    const ext = vscode.extensions.getExtension("wrath-codes.@layered/extension");
    if (ext && !ext.isActive) {
      await ext.activate();
    }
    await sleep(2000);
  });

  setup(function () {
    resetWorkspace();
  });

  suiteTeardown(function () {
    resetWorkspace();
  });

  test("extension should be present", () => {
    const ext = vscode.extensions.getExtension("wrath-codes.@layered/extension");
    assert.ok(ext, "Extension should be installed");
  });

  test("extension should activate", async () => {
    const ext = vscode.extensions.getExtension("wrath-codes.@layered/extension");
    assert.ok(ext, "Extension should be installed");
    assert.ok(ext.isActive, "Extension should be active");
  });

  test("settings from config chain should be applied", async function () {
    this.timeout(10000);
    await sleep(1000);

    const config = vscode.workspace.getConfiguration();

    // From config.json
    assert.strictEqual(config.get("editor.fontSize"), 14);
    assert.strictEqual(config.get("editor.tabSize"), 2);

    // From base.json
    assert.strictEqual(config.get("editor.wordWrap"), "on");
    assert.strictEqual(config.get("editor.minimap.enabled"), false);
    assert.strictEqual(config.get("files.autoSave"), "afterDelay");
  });

  test("editing config file should update settings.json", async function () {
    this.timeout(15000);

    // Read current config
    const configPath = path.join(configDir, "config.json");
    const content = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(content);

    // Add a new setting
    config.settings["editor.lineNumbers"] = "relative";
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Wait for file watcher to trigger rebuild
    await sleep(3000);

    // Check if setting was applied
    const vsConfig = vscode.workspace.getConfiguration();
    assert.strictEqual(vsConfig.get("editor.lineNumbers"), "relative");

    // Clean up - remove the added setting
    delete config.settings["editor.lineNumbers"];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    await sleep(2000);
  });

  test("deleting a setting from config should remove it from settings.json", async function () {
    this.timeout(15000);

    // First, add a setting
    const configPath = path.join(configDir, "config.json");
    const content = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(content);

    config.settings["editor.cursorStyle"] = "block";
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    await sleep(3000);

    // Verify it was added
    let vsConfig = vscode.workspace.getConfiguration();
    assert.strictEqual(vsConfig.get("editor.cursorStyle"), "block");

    // Now delete it
    delete config.settings["editor.cursorStyle"];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    await sleep(3000);

    // Verify it was removed (should be default or undefined)
    vsConfig = vscode.workspace.getConfiguration();
    const cursorStyle = vsConfig.get("editor.cursorStyle");
    // Default is "line", not "block"
    assert.notStrictEqual(cursorStyle, "block", "Setting should have been removed");
  });

  test("refresh command should be available", async () => {
    const commands = await vscode.commands.getCommands();
    assert.ok(
      commands.includes("layered-settings.refresh"),
      "Refresh command should be registered"
    );
  });

  test("showStatus command should be available", async () => {
    const commands = await vscode.commands.getCommands();
    assert.ok(
      commands.includes("layered-settings.showStatus"),
      "Show Status command should be registered"
    );
  });

  test("array settings should be concatenated from multiple files", async function () {
    this.timeout(15000);

    // Add array to base.json
    const basePath = path.join(configDir, "base.json");
    const baseContent = fs.readFileSync(basePath, "utf8");
    const baseConfig = JSON.parse(baseContent);
    baseConfig.settings["files.exclude"] = ["*.log", "*.tmp"];
    fs.writeFileSync(basePath, JSON.stringify(baseConfig, null, 2));

    // Add array to config.json
    const configPath = path.join(configDir, "config.json");
    const configContent = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(configContent);
    config.settings["files.exclude"] = ["node_modules"];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    await sleep(3000);

    // Verify arrays are concatenated
    const vsConfig = vscode.workspace.getConfiguration();
    const filesExclude = vsConfig.get<string[]>("files.exclude");
    assert.ok(Array.isArray(filesExclude), "files.exclude should be an array");
    assert.ok(filesExclude.includes("*.log"), "Should include base array items");
    assert.ok(filesExclude.includes("node_modules"), "Should include config array items");

    // Clean up
    delete baseConfig.settings["files.exclude"];
    delete config.settings["files.exclude"];
    fs.writeFileSync(basePath, JSON.stringify(baseConfig, null, 2));
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    await sleep(2000);
  });

  test("language-specific settings should be merged", async function () {
    this.timeout(15000);

    // Add language-specific setting to base.json
    const basePath = path.join(configDir, "base.json");
    const baseContent = fs.readFileSync(basePath, "utf8");
    const baseConfig = JSON.parse(baseContent);
    baseConfig.settings["[typescript]"] = { "editor.formatOnSave": true };
    fs.writeFileSync(basePath, JSON.stringify(baseConfig, null, 2));

    // Add different language-specific setting to config.json
    const configPath = path.join(configDir, "config.json");
    const configContent = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(configContent);
    config.settings["[typescript]"] = { "editor.defaultFormatter": "esbenp.prettier-vscode" };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    await sleep(3000);

    // Verify both settings are present (shallow merged)
    const vsConfig = vscode.workspace.getConfiguration();
    const tsSettings = vsConfig.get<Record<string, unknown>>("[typescript]");
    assert.ok(tsSettings, "[typescript] settings should exist");
    assert.strictEqual(tsSettings["editor.formatOnSave"], true, "Should have base setting");
    assert.strictEqual(tsSettings["editor.defaultFormatter"], "esbenp.prettier-vscode", "Should have config setting");

    // Clean up
    delete baseConfig.settings["[typescript]"];
    delete config.settings["[typescript]"];
    fs.writeFileSync(basePath, JSON.stringify(baseConfig, null, 2));
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    await sleep(2000);
  });

  test("conflicting keys should create diagnostics", async function () {
    this.timeout(15000);

    // Add same key to both files (creates conflict)
    const basePath = path.join(configDir, "base.json");
    const baseContent = fs.readFileSync(basePath, "utf8");
    const baseConfig = JSON.parse(baseContent);
    baseConfig.settings["editor.insertSpaces"] = false;
    fs.writeFileSync(basePath, JSON.stringify(baseConfig, null, 2));

    const configPath = path.join(configDir, "config.json");
    const configContent = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(configContent);
    config.settings["editor.insertSpaces"] = true;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    await sleep(3000);

    // Check for diagnostics
    const baseUri = vscode.Uri.file(basePath);
    const configUri = vscode.Uri.file(configPath);
    const baseDiagnostics = vscode.languages.getDiagnostics(baseUri);
    const configDiagnostics = vscode.languages.getDiagnostics(configUri);

    // At least one file should have a diagnostic about the conflict
    const hasConflictDiagnostic =
      baseDiagnostics.some(d => d.source === "layered-settings") ||
      configDiagnostics.some(d => d.source === "layered-settings");

    assert.ok(hasConflictDiagnostic, "Should create diagnostics for conflicting keys");

    // Clean up
    delete baseConfig.settings["editor.insertSpaces"];
    delete config.settings["editor.insertSpaces"];
    fs.writeFileSync(basePath, JSON.stringify(baseConfig, null, 2));
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    await sleep(2000);
  });

  test("openConfig command should be available", async () => {
    const commands = await vscode.commands.getCommands();
    assert.ok(
      commands.includes("layered-settings.openConfig"),
      "Open Config command should be registered"
    );
  });

  test("resolveConflict command should be available", async () => {
    const commands = await vscode.commands.getCommands();
    assert.ok(
      commands.includes("layered-settings.resolveConflict"),
      "Resolve Conflict command should be registered"
    );
  });

  test("single folder with root: true works unchanged", async function () {
    this.timeout(10000);

    // Read current config to verify root property
    const configPath = path.join(configDir, "config.json");
    const content = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(content);

    // Config should have root: true (existing fixture)
    assert.strictEqual(config.root, true, "Config should have root: true");

    // Settings should still be applied
    const vsConfig = vscode.workspace.getConfiguration();
    assert.strictEqual(vsConfig.get("editor.fontSize"), 14);
  });

  test("child config overrides parent's settings", async function () {
    this.timeout(15000);

    // Add a setting to base.json that will be overridden
    const basePath = path.join(configDir, "base.json");
    const baseContent = fs.readFileSync(basePath, "utf8");
    const baseConfig = JSON.parse(baseContent);
    baseConfig.settings["editor.renderWhitespace"] = "none";
    fs.writeFileSync(basePath, JSON.stringify(baseConfig, null, 2));

    // Override in config.json
    const configPath = path.join(configDir, "config.json");
    const configContent = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(configContent);
    config.settings["editor.renderWhitespace"] = "all";
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    await sleep(3000);

    // Verify child wins
    const vsConfig = vscode.workspace.getConfiguration();
    assert.strictEqual(
      vsConfig.get("editor.renderWhitespace"),
      "all",
      "Child config should override parent"
    );

    // Clean up
    delete baseConfig.settings["editor.renderWhitespace"];
    delete config.settings["editor.renderWhitespace"];
    fs.writeFileSync(basePath, JSON.stringify(baseConfig, null, 2));
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    await sleep(2000);
  });

  test("config deletion removes all previously-owned settings", async function () {
    this.timeout(20000);

    // Add a unique setting
    const configPath = path.join(configDir, "config.json");
    const content = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(content);
    const originalSettings = { ...config.settings };

    config.settings["editor.scrollBeyondLastLine"] = false;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    await sleep(3000);

    // Verify it was applied
    let vsConfig = vscode.workspace.getConfiguration();
    assert.strictEqual(vsConfig.get("editor.scrollBeyondLastLine"), false);

    // Now remove all settings from config
    config.settings = {};
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    await sleep(3000);

    // Setting should be removed (reverts to default)
    vsConfig = vscode.workspace.getConfiguration();
    const scrollBeyond = vsConfig.get("editor.scrollBeyondLastLine");
    assert.notStrictEqual(scrollBeyond, false, "Setting should have been removed");

    // Restore original settings
    config.settings = originalSettings;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    await sleep(2000);
  });

  test("arrays skip auto-writeback to avoid ambiguity", async function () {
    this.timeout(15000);

    // Add arrays to both files
    const basePath = path.join(configDir, "base.json");
    const baseContent = fs.readFileSync(basePath, "utf8");
    const baseConfig = JSON.parse(baseContent);
    baseConfig.settings["search.exclude"] = ["**/node_modules"];
    fs.writeFileSync(basePath, JSON.stringify(baseConfig, null, 2));

    const configPath = path.join(configDir, "config.json");
    const configContent = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(configContent);
    config.settings["search.exclude"] = ["**/dist"];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    await sleep(3000);

    // Read the settings.json and modify the array
    const settingsContent = fs.readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(settingsContent);
    const originalArray = settings["search.exclude"];

    // Modify in settings.json (simulating user edit)
    settings["search.exclude"] = [...(originalArray || []), "**/build"];
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    await sleep(3000);

    // Verify source files were NOT modified (arrays skip writeback)
    const baseAfter = JSON.parse(fs.readFileSync(basePath, "utf8"));
    const configAfter = JSON.parse(fs.readFileSync(configPath, "utf8"));

    assert.deepStrictEqual(
      baseAfter.settings["search.exclude"],
      ["**/node_modules"],
      "Base file should not be modified for array settings"
    );
    assert.deepStrictEqual(
      configAfter.settings["search.exclude"],
      ["**/dist"],
      "Config file should not be modified for array settings"
    );

    // Clean up
    delete baseConfig.settings["search.exclude"];
    delete config.settings["search.exclude"];
    fs.writeFileSync(basePath, JSON.stringify(baseConfig, null, 2));
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    await sleep(2000);
  });

  test("scalar setting change in settings.json writes back to source file", async function () {
    this.timeout(15000);

    // Add a scalar setting
    const configPath = path.join(configDir, "config.json");
    const configContent = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(configContent);
    config.settings["editor.cursorBlinking"] = "blink";
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    await sleep(3000);

    // Read current settings.json
    const settingsContent = fs.readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(settingsContent);

    // Modify the scalar value in settings.json
    settings["editor.cursorBlinking"] = "smooth";
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    await sleep(3000);

    // Verify source file was updated
    const configAfter = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(
      configAfter.settings["editor.cursorBlinking"],
      "smooth",
      "Source file should be updated with new value"
    );

    // Clean up
    delete config.settings["editor.cursorBlinking"];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    await sleep(2000);
  });

  test("provider exposes folder name correctly", async function () {
    this.timeout(5000);

    // The workspace folder name should be available through the extension
    assert.ok(workspaceFolder, "Workspace folder should exist");
    assert.ok(workspaceFolder.name, "Workspace folder should have a name");
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
