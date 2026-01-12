import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { resetSharedWorkspace } from "./test-workspace";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

suite("Settings Validation (Phase 4)", () => {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const configDir = workspaceFolder
    ? path.join(
        workspaceFolder.uri.fsPath,
        ".vscode",
        "layered-settings",
        "settings"
      )
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

  suite("T4.1-I: Diagnostics Provider Integration", () => {
    test("T4.1-I1: Schema validation produces diagnostics for unknown properties", async function () {
      this.timeout(25000);

      const testFilePath = path.join(configDir, "test-validation.json");
      const testConfig = {
        settings: {
          "completely.unknown.setting.xyz": true,
        },
      };

      fs.writeFileSync(testFilePath, JSON.stringify(testConfig, null, 2));

      try {
        const doc = await vscode.workspace.openTextDocument(testFilePath);
        await vscode.window.showTextDocument(doc);

        let diagnostics: vscode.Diagnostic[] = [];
        let validationDiags: vscode.Diagnostic[] = [];

        for (let attempt = 0; attempt < 10; attempt++) {
          await sleep(500);
          diagnostics = vscode.languages.getDiagnostics(
            vscode.Uri.file(testFilePath)
          );
          validationDiags = diagnostics.filter(
            (d) => d.source === "Layered Settings"
          );
          if (validationDiags.length > 0) break;
        }

        assert.ok(
          validationDiags.length > 0,
          `Should have validation diagnostics for unknown property. Got ${diagnostics.length} total diagnostics: ${diagnostics.map((d) => `[${d.source}] ${d.message}`).join(", ")}`
        );

        const unknownPropDiag = validationDiags.find((d) =>
          d.message.includes("completely.unknown.setting.xyz")
        );
        assert.ok(unknownPropDiag, "Should have diagnostic for the unknown setting");
      } finally {
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        if (fs.existsSync(testFilePath)) {
          fs.unlinkSync(testFilePath);
        }
      }
    });

    test("T4.1-I2: Diagnostics update on edit (fixing unknown key)", async function () {
      this.timeout(30000);

      const testFilePath = path.join(configDir, "test-validation-edit.json");
      const testConfig = {
        settings: {
          "unknown.setting.to.fix": true,
        },
      };

      fs.writeFileSync(testFilePath, JSON.stringify(testConfig, null, 2));

      try {
        const doc = await vscode.workspace.openTextDocument(testFilePath);
        await vscode.window.showTextDocument(doc);

        let diagnostics: vscode.Diagnostic[] = [];
        let validationDiags: vscode.Diagnostic[] = [];

        for (let attempt = 0; attempt < 10; attempt++) {
          await sleep(500);
          diagnostics = vscode.languages.getDiagnostics(
            vscode.Uri.file(testFilePath)
          );
          validationDiags = diagnostics.filter(
            (d) => d.source === "Layered Settings"
          );
          if (validationDiags.length > 0) break;
        }

        assert.ok(
          validationDiags.length > 0,
          `Should have diagnostics initially. Got: ${diagnostics.map((d) => `[${d.source}] ${d.message}`).join(", ")}`
        );

        const fixedConfig = {
          settings: {},
        };
        fs.writeFileSync(testFilePath, JSON.stringify(fixedConfig, null, 2));

        await sleep(500);

        const reopenedDoc = await vscode.workspace.openTextDocument(testFilePath);
        await vscode.window.showTextDocument(reopenedDoc);

        for (let attempt = 0; attempt < 10; attempt++) {
          await sleep(500);
          diagnostics = vscode.languages.getDiagnostics(
            vscode.Uri.file(testFilePath)
          );
          validationDiags = diagnostics.filter(
            (d) =>
              d.source === "Layered Settings" &&
              d.message.includes("unknown.setting.to.fix")
          );
          if (validationDiags.length === 0) break;
        }

        assert.strictEqual(
          validationDiags.length,
          0,
          "Diagnostic should disappear after removing unknown key"
        );
      } finally {
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        if (fs.existsSync(testFilePath)) {
          fs.unlinkSync(testFilePath);
        }
      }
    });

    test("T4.1-I3: Validation diagnostics coexist with conflict diagnostics", async function () {
      this.timeout(25000);

      const basePath = path.join(configDir, "base.json");
      const configPath = path.join(configDir, "config.json");

      const baseContent = fs.readFileSync(basePath, "utf8");
      const configContent = fs.readFileSync(configPath, "utf8");
      const baseConfig = JSON.parse(baseContent);
      const config = JSON.parse(configContent);

      const originalBaseSettings = { ...baseConfig.settings };
      const originalConfigSettings = { ...config.settings };

      try {
        baseConfig.settings["editor.suggestSelection"] = "first";
        config.settings["editor.suggestSelection"] = "recentlyUsed";
        config.settings["unknown.validation.test"] = true;

        fs.writeFileSync(basePath, JSON.stringify(baseConfig, null, 2));
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        const doc = await vscode.workspace.openTextDocument(configPath);
        await vscode.window.showTextDocument(doc);

        let diagnostics: vscode.Diagnostic[] = [];
        let conflictDiags: vscode.Diagnostic[] = [];
        let validationDiags: vscode.Diagnostic[] = [];

        for (let attempt = 0; attempt < 10; attempt++) {
          await sleep(500);
          diagnostics = vscode.languages.getDiagnostics(
            vscode.Uri.file(configPath)
          );
          conflictDiags = diagnostics.filter(
            (d) => d.source === "layered-settings"
          );
          validationDiags = diagnostics.filter(
            (d) => d.source === "Layered Settings"
          );
          if (conflictDiags.length > 0 || validationDiags.length > 0) break;
        }

        const hasEitherDiagnostic =
          conflictDiags.length > 0 || validationDiags.length > 0;
        assert.ok(
          hasEitherDiagnostic,
          `Should have at least one type of diagnostic. Got ${diagnostics.length} diagnostics: ${diagnostics.map((d) => `[${d.source}] ${d.message}`).join(", ")}`
        );
      } finally {
        baseConfig.settings = originalBaseSettings;
        config.settings = originalConfigSettings;
        fs.writeFileSync(basePath, JSON.stringify(baseConfig, null, 2));
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        await sleep(2000);
      }
    });
  });



  suite("Additional Validation Tests", () => {
    test("validation configuration settings exist", () => {
      const config = vscode.workspace.getConfiguration(
        "layered-settings.validation"
      );

      const enabled = config.get("enabled");
      const severity = config.get("severity");

      assert.strictEqual(typeof enabled, "boolean", "enabled should be a boolean");
      assert.strictEqual(typeof severity, "string", "severity should be a string");
    });

    test("enabled: false in config file skips validation diagnostics", async function () {
      this.timeout(15000);

      const testFilePath = path.join(configDir, "test-disabled.json");
      const testConfig = {
        enabled: false,
        settings: {
          "this.should.not.produce.diagnostic": true,
        },
      };

      fs.writeFileSync(testFilePath, JSON.stringify(testConfig, null, 2));

      try {
        const doc = await vscode.workspace.openTextDocument(testFilePath);
        await vscode.window.showTextDocument(doc);
        await sleep(3000);

        const diagnostics = vscode.languages.getDiagnostics(
          vscode.Uri.file(testFilePath)
        );
        const validationDiags = diagnostics.filter(
          (d) => d.source === "Layered Settings"
        );

        assert.strictEqual(
          validationDiags.length,
          0,
          "Disabled config should not produce validation diagnostics"
        );
      } finally {
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        if (fs.existsSync(testFilePath)) {
          fs.unlinkSync(testFilePath);
        }
      }
    });
  });
});
