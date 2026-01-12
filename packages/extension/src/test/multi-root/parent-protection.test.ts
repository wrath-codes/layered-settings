import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { resetParentOwnedWorkspace } from "../test-workspace";

suite("Parent-Owned Config Protection", () => {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  
  const configDir = workspaceFolder
    ? path.join(workspaceFolder.uri.fsPath, ".vscode", "layered-settings", "settings")
    : "";
  
  // Parent config is OUTSIDE the workspace folder (in shared-configs sibling directory)
  const parentConfigDir = workspaceFolder
    ? path.resolve(workspaceFolder.uri.fsPath, "..", "shared-configs")
    : "";
    
  const settingsPath = workspaceFolder
    ? path.join(workspaceFolder.uri.fsPath, ".vscode", "settings.json")
    : "";

  function readConfig(dir: string, filename: string): Record<string, unknown> {
    const content = fs.readFileSync(path.join(dir, filename), "utf8");
    return JSON.parse(content);
  }

  function writeConfig(dir: string, filename: string, config: Record<string, unknown>): void {
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(config, null, 2));
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

  function resetWorkspace(): void {
    resetParentOwnedWorkspace(configDir, parentConfigDir, settingsPath);
  }

  suiteSetup(async function () {
    this.timeout(30000);
    resetWorkspace();
    const ext = vscode.extensions.getExtension("wrath-codes.@layered/extension");
    if (ext && !ext.isActive) {
      await ext.activate();
    }
    await sleep(3000);
  });

  setup(function () {
    resetWorkspace();
  });

  suiteTeardown(function () {
    resetWorkspace();
  });

  test("workspace folder exists", () => {
    assert.ok(workspaceFolder, "Workspace folder should exist");
  });

  test("parent config is outside workspace folder", () => {
    const workspacePath = workspaceFolder?.uri.fsPath ?? "";
    const parentConfigPath = path.join(parentConfigDir, "root-config.json");
    
    const relative = path.relative(workspacePath, parentConfigPath);
    console.log("Workspace path:", workspacePath);
    console.log("Parent config path:", parentConfigPath);
    console.log("Relative path:", relative);
    
    assert.ok(
      relative.startsWith(".."),
      "Parent config should be outside workspace folder"
    );
  });

  test("config extends parent config", () => {
    const config = readConfig(configDir, "config.json");
    const extendsArray = Array.isArray(config.extends)
      ? config.extends
      : config.extends ? [config.extends] : [];

    assert.ok(
      extendsArray.some((e: string) => e.includes("root-config.json")),
      "Config should extend root-config.json"
    );
  });

  test("merged array contains elements from both parent and child", async function () {
    this.timeout(10000);
    await sleep(2000);

    const settings = readSettings();
    const filesExclude = settings["files.exclude"] as string[] | undefined;

    console.log("settings.json:", JSON.stringify(settings, null, 2));

    assert.ok(Array.isArray(filesExclude), "files.exclude should be an array");
    assert.ok(filesExclude.includes("*.log"), "Should include parent element *.log");
    assert.ok(filesExclude.includes("node_modules"), "Should include child element node_modules");
  });

  suite("Parent Protection Tests", () => {
    test("removing parent-owned element is blocked and array is reverted", async function () {
      this.timeout(25000);

      // Ensure clean state
      await vscode.commands.executeCommand("layered-settings.refresh");
      await sleep(2000);
      
      const settingsBefore = readSettings();
      const originalArray = settingsBefore["files.exclude"] as string[];
      
      console.log("Before removal:", originalArray);

      assert.ok(
        originalArray.includes("*.log"),
        "Array should contain *.log (parent-owned) before test"
      );

      // Remove parent-owned element
      const modifiedArray = originalArray.filter((x) => x !== "*.log");
      writeSettings({ ...settingsBefore, "files.exclude": modifiedArray });
      
      console.log("Wrote modified settings, waiting for watcher...");
      await sleep(5000);

      const settingsAfter = readSettings();
      const arrayAfter = settingsAfter["files.exclude"] as string[];
      
      console.log("After removal attempt:", arrayAfter);

      assert.ok(
        arrayAfter.includes("*.log"),
        "*.log should be restored after blocked removal (parent-owned)"
      );
    });

    test("removing child-owned element succeeds", async function () {
      this.timeout(20000);

      const config = readConfig(configDir, "config.json");
      const originalSettings = { ...(config.settings as Record<string, unknown>) };

      // Add a child-only element
      (config.settings as Record<string, unknown>)["search.exclude"] = ["**/dist"];
      writeConfig(configDir, "config.json", config);
      await sleep(3000);

      // Remove it via settings.json
      const settings = readSettings();
      settings["search.exclude"] = [];
      writeSettings(settings);
      await sleep(3000);

      // Verify it was removed from config.json
      const configAfter = readConfig(configDir, "config.json");
      const arrayAfter = (configAfter.settings as Record<string, unknown>)?.[
        "search.exclude"
      ] as string[] | undefined;

      assert.ok(
        !arrayAfter?.includes("**/dist"),
        "**/dist should be removed from child config.json"
      );

      // Cleanup
      config.settings = originalSettings;
      writeConfig(configDir, "config.json", config);
      await sleep(2000);
    });

    test("mixed parent/child removal aborts ALL changes", async function () {
      this.timeout(25000);

      const config = readConfig(configDir, "config.json");
      const originalSettings = { ...(config.settings as Record<string, unknown>) };

      const parentConfig = readConfig(parentConfigDir, "root-config.json");
      const originalParentSettings = { ...(parentConfig.settings as Record<string, unknown>) };

      // Add array to both parent and child
      (parentConfig.settings as Record<string, unknown>)["editor.rulers"] = [80];
      writeConfig(parentConfigDir, "root-config.json", parentConfig);

      (config.settings as Record<string, unknown>)["editor.rulers"] = [120];
      writeConfig(configDir, "config.json", config);

      await vscode.commands.executeCommand("layered-settings.refresh");
      await sleep(3000);

      const settings = readSettings();
      const originalArray = settings["editor.rulers"] as number[];
      
      console.log("Before mixed removal:", originalArray);
      assert.ok(
        originalArray.includes(80) && originalArray.includes(120),
        "Both ruler values should be in merged array"
      );

      // Try to remove ALL elements (both parent and child owned)
      settings["editor.rulers"] = [];
      writeSettings(settings);
      await sleep(5000);

      const settingsAfter = readSettings();
      const arrayAfter = settingsAfter["editor.rulers"] as number[];
      
      console.log("After mixed removal attempt:", arrayAfter);

      assert.ok(
        arrayAfter.includes(80),
        "80 (parent-owned) should be restored (transaction aborted)"
      );
      assert.ok(
        arrayAfter.includes(120),
        "120 (child-owned) should also be restored (transaction aborted)"
      );

      // Cleanup
      config.settings = originalSettings;
      writeConfig(configDir, "config.json", config);
      parentConfig.settings = originalParentSettings;
      writeConfig(parentConfigDir, "root-config.json", parentConfig);
      await sleep(2000);
    });
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
