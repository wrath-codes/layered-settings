import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

suite("Layered Settings Extension", () => {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const configDir = workspaceFolder
    ? path.join(workspaceFolder.uri.fsPath, ".vscode", "layered-settings", "settings")
    : "";
  const settingsPath = workspaceFolder
    ? path.join(workspaceFolder.uri.fsPath, ".vscode", "settings.json")
    : "";

  suiteSetup(async function () {
    this.timeout(30000);
    // Wait for extension to activate
    const ext = vscode.extensions.getExtension("wrath-codes.@layered/extension");
    if (ext && !ext.isActive) {
      await ext.activate();
    }
    // Give it time to process
    await sleep(2000);
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
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
