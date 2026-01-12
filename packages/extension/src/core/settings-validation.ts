import * as vscode from "vscode";
import * as jsonc from "jsonc-parser/lib/esm/main.js";
import {
  getJsonLanguageService,
  toLsTextDocument,
  getOrParseJsonDocument,
  evictJsonDocument,
  configureJsonLanguageService,
  jsoncDocumentSettings,
} from "./json-language-service";
import type { Diagnostic as LsDiagnostic } from "vscode-json-languageservice";

const LAYERED_SETTINGS_SELECTOR: vscode.DocumentSelector = [
  { language: "json", pattern: "**/.vscode/layered-settings/**/*.json" },
  { language: "jsonc", pattern: "**/.vscode/layered-settings/**/*.json" },
];

export function isLayeredSettingsDoc(doc: vscode.TextDocument): boolean {
  return vscode.languages.match(LAYERED_SETTINGS_SELECTOR, doc) > 0;
}

function getSeverityFromConfig(): vscode.DiagnosticSeverity {
  const config = vscode.workspace.getConfiguration("layered-settings.validation");
  const severity = config.get<string>("severity", "warning");

  switch (severity) {
    case "error":
      return vscode.DiagnosticSeverity.Error;
    case "warning":
      return vscode.DiagnosticSeverity.Warning;
    case "information":
      return vscode.DiagnosticSeverity.Information;
    case "hint":
      return vscode.DiagnosticSeverity.Hint;
    default:
      return vscode.DiagnosticSeverity.Warning;
  }
}

function mapLsDiagnosticSeverity(
  severity: LsDiagnostic["severity"]
): vscode.DiagnosticSeverity {
  const configuredSeverity = getSeverityFromConfig();

  switch (severity) {
    case 1:
      return configuredSeverity;
    case 2:
      return configuredSeverity;
    case 3:
      return vscode.DiagnosticSeverity.Information;
    case 4:
      return vscode.DiagnosticSeverity.Hint;
    default:
      return configuredSeverity;
  }
}

function mapDiagnostics(lsDiags: LsDiagnostic[]): vscode.Diagnostic[] {
  return lsDiags.map((d) => {
    const range = new vscode.Range(
      d.range.start.line,
      d.range.start.character,
      d.range.end.line,
      d.range.end.character
    );

    const diag = new vscode.Diagnostic(
      range,
      d.message,
      mapLsDiagnosticSeverity(d.severity)
    );
    diag.source = "Layered Settings";
    diag.code = d.code;
    return diag;
  });
}

export function activateValidation(
  context: vscode.ExtensionContext
): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection(
    "layered-settings-validation"
  );
  context.subscriptions.push(collection);

  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function getValidationConfig() {
    return vscode.workspace.getConfiguration("layered-settings.validation");
  }

  async function validateDocument(doc: vscode.TextDocument): Promise<void> {
    if (!isLayeredSettingsDoc(doc)) return;

    const config = getValidationConfig();
    if (!config.get<boolean>("enabled", true)) {
      collection.delete(doc.uri);
      return;
    }

    const text = doc.getText();
    const parsed = jsonc.parse(text, [], { allowTrailingComma: true });
    if (parsed && parsed.enabled === false) {
      collection.delete(doc.uri);
      return;
    }

    const ls = getJsonLanguageService();
    const lsDoc = toLsTextDocument(doc);
    const jsonDoc = getOrParseJsonDocument(doc);

    const lsDiagnostics = await ls.doValidation(
      lsDoc,
      jsonDoc,
      jsoncDocumentSettings
    );
    const vsDiagnostics = mapDiagnostics(lsDiagnostics);
    collection.set(doc.uri, vsDiagnostics);
  }

  function scheduleValidate(doc: vscode.TextDocument, debounceMs: number): void {
    if (!isLayeredSettingsDoc(doc)) return;

    const key = doc.uri.toString();
    const existing = pendingTimers.get(key);
    if (existing) clearTimeout(existing);

    const handle = setTimeout(() => {
      pendingTimers.delete(key);
      validateDocument(doc);
    }, debounceMs);

    pendingTimers.set(key, handle);
  }

  for (const doc of vscode.workspace.textDocuments) {
    scheduleValidate(doc, 0);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => scheduleValidate(doc, 50)),
    vscode.workspace.onDidChangeTextDocument((e) =>
      scheduleValidate(e.document, 250)
    ),
    vscode.workspace.onDidSaveTextDocument((doc) => scheduleValidate(doc, 50)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      const existing = pendingTimers.get(key);
      if (existing) clearTimeout(existing);
      pendingTimers.delete(key);
      collection.delete(doc.uri);
      evictJsonDocument(key);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("layered-settings.validation")) {
        configureJsonLanguageService();
        for (const doc of vscode.workspace.textDocuments) {
          scheduleValidate(doc, 100);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      configureJsonLanguageService();
      for (const doc of vscode.workspace.textDocuments) {
        scheduleValidate(doc, 500);
      }
    })
  );

  return collection;
}


