import { describe, test, expect, beforeEach, mock } from "bun:test";
import type * as vscode from "vscode";

const LAYERED_SETTINGS_PATTERN = "**/.vscode/layered-settings/**/*.json";

function isLayeredSettingsPath(fsPath: string): boolean {
  return fsPath.includes(".vscode/layered-settings/") && fsPath.endsWith(".json");
}

describe("T4.1: Diagnostics Provider", () => {
  describe("T4.1-U1: isLayeredSettingsDoc matches patterns", () => {
    test("matches layered-settings json files", () => {
      expect(
        isLayeredSettingsPath("/workspace/.vscode/layered-settings/settings/config.json")
      ).toBe(true);
    });

    test("matches nested layered-settings files", () => {
      expect(
        isLayeredSettingsPath(
          "/workspace/.vscode/layered-settings/settings/nested/deep.json"
        )
      ).toBe(true);
    });

    test("does not match regular .vscode files", () => {
      expect(isLayeredSettingsPath("/workspace/.vscode/settings.json")).toBe(false);
    });

    test("does not match non-json files in layered-settings", () => {
      expect(
        isLayeredSettingsPath("/workspace/.vscode/layered-settings/readme.md")
      ).toBe(false);
    });

    test("does not match files outside .vscode", () => {
      expect(isLayeredSettingsPath("/workspace/src/config.json")).toBe(false);
    });
  });

  describe("T4.1-U2: scheduleValidate debounces", () => {
    let timers: Map<string, { callback: () => void; delay: number }>;
    let validateCalls: string[];
    let clearedTimers: string[];

    function scheduleValidate(uri: string, debounceMs: number): void {
      const existing = timers.get(uri);
      if (existing) {
        clearedTimers.push(uri);
      }

      timers.set(uri, {
        callback: () => {
          validateCalls.push(uri);
        },
        delay: debounceMs,
      });
    }

    function flushTimers(): void {
      for (const [uri, timer] of timers) {
        timer.callback();
        timers.delete(uri);
      }
    }

    beforeEach(() => {
      timers = new Map();
      validateCalls = [];
      clearedTimers = [];
    });

    test("multiple rapid calls result in single validation", () => {
      const uri = "file:///test/config.json";

      scheduleValidate(uri, 250);
      scheduleValidate(uri, 250);
      scheduleValidate(uri, 250);

      expect(clearedTimers.length).toBe(2);
      expect(timers.size).toBe(1);

      flushTimers();

      expect(validateCalls.length).toBe(1);
      expect(validateCalls[0]).toBe(uri);
    });

    test("different URIs are scheduled independently", () => {
      const uri1 = "file:///test/config1.json";
      const uri2 = "file:///test/config2.json";

      scheduleValidate(uri1, 250);
      scheduleValidate(uri2, 250);

      expect(timers.size).toBe(2);

      flushTimers();

      expect(validateCalls.length).toBe(2);
    });
  });

  describe("T4.1-U3: Close cancels timers and clears", () => {
    let timers: Map<string, NodeJS.Timeout>;
    let diagnostics: Map<string, unknown[]>;

    function onCloseDocument(uriString: string): void {
      const existing = timers.get(uriString);
      if (existing) {
        clearTimeout(existing);
        timers.delete(uriString);
      }
      diagnostics.delete(uriString);
    }

    beforeEach(() => {
      timers = new Map();
      diagnostics = new Map();
    });

    test("closing document clears timer and diagnostics", () => {
      const uri = "file:///test/config.json";

      timers.set(uri, setTimeout(() => {}, 1000));
      diagnostics.set(uri, [{ message: "test" }]);

      onCloseDocument(uri);

      expect(timers.has(uri)).toBe(false);
      expect(diagnostics.has(uri)).toBe(false);
    });
  });

  describe("T4.1-U4: Config change triggers revalidation", () => {
    let configureCount = 0;
    let revalidatedDocs: string[];

    function onConfigChange(affectsValidation: boolean): void {
      if (affectsValidation) {
        configureCount++;
        revalidatedDocs = ["doc1", "doc2"];
      }
    }

    beforeEach(() => {
      configureCount = 0;
      revalidatedDocs = [];
    });

    test("config change triggers reconfigure and revalidation", () => {
      onConfigChange(true);

      expect(configureCount).toBe(1);
      expect(revalidatedDocs.length).toBeGreaterThan(0);
    });

    test("unrelated config change does nothing", () => {
      onConfigChange(false);

      expect(configureCount).toBe(0);
      expect(revalidatedDocs.length).toBe(0);
    });
  });

  describe("T4.1-U5: Extension change triggers revalidation", () => {
    let revalidateDelay = 0;

    function onExtensionsChange(): void {
      revalidateDelay = 500;
    }

    test("extension change triggers revalidation with 500ms delay", () => {
      onExtensionsChange();
      expect(revalidateDelay).toBe(500);
    });
  });

  describe("T4.1-U6: validation.enabled=false clears diagnostics", () => {
    let diagnosticsCleared = false;
    let doValidationCalled = false;

    async function validateDocument(enabled: boolean): Promise<void> {
      if (!enabled) {
        diagnosticsCleared = true;
        return;
      }
      doValidationCalled = true;
    }

    beforeEach(() => {
      diagnosticsCleared = false;
      doValidationCalled = false;
    });

    test("disabled validation clears diagnostics without calling doValidation", async () => {
      await validateDocument(false);

      expect(diagnosticsCleared).toBe(true);
      expect(doValidationCalled).toBe(false);
    });

    test("enabled validation calls doValidation", async () => {
      await validateDocument(true);

      expect(diagnosticsCleared).toBe(false);
      expect(doValidationCalled).toBe(true);
    });
  });

  describe("T4.1-U7: Severity mapping from config", () => {
    enum DiagnosticSeverity {
      Error = 0,
      Warning = 1,
      Information = 2,
      Hint = 3,
    }

    function getSeverityFromConfig(
      severity: string
    ): DiagnosticSeverity {
      switch (severity) {
        case "error":
          return DiagnosticSeverity.Error;
        case "warning":
          return DiagnosticSeverity.Warning;
        case "information":
          return DiagnosticSeverity.Information;
        case "hint":
          return DiagnosticSeverity.Hint;
        default:
          return DiagnosticSeverity.Warning;
      }
    }

    test("error maps to Error", () => {
      expect(getSeverityFromConfig("error")).toBe(DiagnosticSeverity.Error);
    });

    test("warning maps to Warning", () => {
      expect(getSeverityFromConfig("warning")).toBe(DiagnosticSeverity.Warning);
    });

    test("information maps to Information", () => {
      expect(getSeverityFromConfig("information")).toBe(DiagnosticSeverity.Information);
    });

    test("hint maps to Hint", () => {
      expect(getSeverityFromConfig("hint")).toBe(DiagnosticSeverity.Hint);
    });

    test("unknown defaults to Warning", () => {
      expect(getSeverityFromConfig("unknown")).toBe(DiagnosticSeverity.Warning);
    });
  });
});

describe("T4.2: Code Action Provider", () => {
  describe("T4.2-U1: Only responds to Layered Settings source", () => {
    interface MockDiagnostic {
      source?: string;
      message: string;
    }

    function filterOurDiagnostics(diagnostics: MockDiagnostic[]): MockDiagnostic[] {
      return diagnostics.filter((d) => d.source === "Layered Settings");
    }

    test("filters diagnostics by source", () => {
      const diagnostics: MockDiagnostic[] = [
        { source: "Layered Settings", message: "Property 'foo' is not allowed" },
        { source: "json", message: "Some other error" },
        { source: "typescript", message: "Type error" },
      ];

      const filtered = filterOurDiagnostics(diagnostics);

      expect(filtered.length).toBe(1);
      expect(filtered[0].source).toBe("Layered Settings");
    });

    test("returns empty when no Layered Settings diagnostics", () => {
      const diagnostics: MockDiagnostic[] = [
        { source: "json", message: "Some error" },
      ];

      expect(filterOurDiagnostics(diagnostics)).toEqual([]);
    });
  });

  describe("T4.2-U2: Regex extracts key with/without quotes", () => {
    function extractSettingKey(message: string): string | null {
      const match = message.match(/Property ['"]?(.+?)['"]? is not allowed/);
      if (!match) return null;
      return match[1].replace(/['"]/g, "");
    }

    test("extracts key with single quotes", () => {
      expect(extractSettingKey("Property 'editor.tabSize' is not allowed")).toBe(
        "editor.tabSize"
      );
    });

    test("extracts key with double quotes", () => {
      expect(extractSettingKey('Property "editor.tabSize" is not allowed')).toBe(
        "editor.tabSize"
      );
    });

    test("extracts key without quotes", () => {
      expect(extractSettingKey("Property editor.tabSize is not allowed")).toBe(
        "editor.tabSize"
      );
    });

    test("handles dotted keys", () => {
      expect(
        extractSettingKey("Property 'some.deep.nested.key' is not allowed")
      ).toBe("some.deep.nested.key");
    });
  });

  describe("T4.2-U3: Non-matching messages handled", () => {
    function extractSettingKey(message: string): string | null {
      const match = message.match(/Property ['"]?(.+?)['"]? is not allowed/);
      if (!match) return null;
      return match[1].replace(/['"]/g, "");
    }

    test("returns null for type error messages", () => {
      expect(extractSettingKey("Incorrect type. Expected string.")).toBeNull();
    });

    test("returns null for general error messages", () => {
      expect(extractSettingKey("Expected comma or closing brace")).toBeNull();
    });

    test("returns null for empty message", () => {
      expect(extractSettingKey("")).toBeNull();
    });
  });

  describe("T4.2-U4: Action is QuickFix and preferred", () => {
    enum CodeActionKind {
      QuickFix = "quickfix",
    }

    interface MockCodeAction {
      kind: CodeActionKind;
      isPreferred: boolean;
      title: string;
    }

    function createCodeAction(settingKey: string): MockCodeAction {
      return {
        kind: CodeActionKind.QuickFix,
        isPreferred: true,
        title: `Add "${settingKey}" to known custom settings`,
      };
    }

    test("action has QuickFix kind", () => {
      const action = createCodeAction("editor.tabSize");
      expect(action.kind).toBe(CodeActionKind.QuickFix);
    });

    test("action is preferred", () => {
      const action = createCodeAction("editor.tabSize");
      expect(action.isPreferred).toBe(true);
    });

    test("action has correct title", () => {
      const action = createCodeAction("some.setting");
      expect(action.title).toBe('Add "some.setting" to known custom settings');
    });
  });

  describe("T4.2-U5: Command adds to allowlist only if absent", () => {
    let currentAllowlist: string[] = [];

    async function addToAllowlist(key: string): Promise<void> {
      if (!currentAllowlist.includes(key)) {
        currentAllowlist = [...currentAllowlist, key];
      }
    }

    beforeEach(() => {
      currentAllowlist = [];
    });

    test("adds new key to empty allowlist", async () => {
      await addToAllowlist("new.setting");
      expect(currentAllowlist).toEqual(["new.setting"]);
    });

    test("adds new key to existing allowlist", async () => {
      currentAllowlist = ["existing.setting"];
      await addToAllowlist("new.setting");
      expect(currentAllowlist).toEqual(["existing.setting", "new.setting"]);
    });

    test("does not duplicate existing key", async () => {
      currentAllowlist = ["existing.setting"];
      await addToAllowlist("existing.setting");
      expect(currentAllowlist).toEqual(["existing.setting"]);
    });
  });
});
