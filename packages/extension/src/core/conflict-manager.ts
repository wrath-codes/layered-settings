import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ConflictData, ProvenanceMap } from "./types";
import { log } from "../utils/logger";

let diagnosticCollection: vscode.DiagnosticCollection | null = null;
const diagnosticsByConfigDir = new Map<string, vscode.Uri[]>();

export function initDiagnostics(collection: vscode.DiagnosticCollection): void {
  diagnosticCollection = collection;
}

export async function createConflictDiagnostics(
  conflicts: string[],
  provenance: ProvenanceMap,
  configDir: string
): Promise<void> {
  // Clear only THIS folder's previous diagnostics
  const previousUris = diagnosticsByConfigDir.get(configDir) ?? [];
  for (const uri of previousUris) {
    diagnosticCollection?.set(uri, []);
  }
  diagnosticsByConfigDir.set(configDir, []);

  if (conflicts.length === 0) {
    log("No conflicts detected");
    return;
  }

  log(`Found ${conflicts.length} conflict(s): ${conflicts.join(", ")}`);

  const diagnosticsByFile = new Map<string, vscode.Diagnostic[]>();

  for (const key of conflicts) {
    const prov = provenance.get(key);
    if (!prov) continue;

    const allFiles = [prov.winner, ...prov.overrides.map((o: { file: string; value: unknown }) => o.file)];

    for (const filePath of allFiles) {
      // Provenance now stores absolute paths, use directly
      if (!fs.existsSync(filePath)) continue;
      const position = await findKeyPosition(filePath, key);

      const otherFiles = allFiles
        .filter((f) => f !== filePath)
        .map((f) => path.basename(f));
      const diagnostic = new vscode.Diagnostic(
        position,
        `"${key}" is also defined in: ${otherFiles.join(", ")}`,
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic.source = "layered-settings";
      (diagnostic as { data?: ConflictData }).data = {
        key,
        allFiles,
      };

      const existing = diagnosticsByFile.get(filePath) || [];
      existing.push(diagnostic);
      diagnosticsByFile.set(filePath, existing);
    }
  }

  const newUris: vscode.Uri[] = [];
  for (const [filePath, diagnostics] of diagnosticsByFile) {
    const uri = vscode.Uri.file(filePath);
    diagnosticCollection?.set(uri, diagnostics);
    newUris.push(uri);
  }

  diagnosticsByConfigDir.set(configDir, newUris);
}

export function clearDiagnosticsForConfigDir(configDir: string): void {
  const uris = diagnosticsByConfigDir.get(configDir) ?? [];
  for (const uri of uris) {
    diagnosticCollection?.set(uri, []);
  }
  diagnosticsByConfigDir.delete(configDir);
}

async function findKeyPosition(
  filePath: string,
  key: string
): Promise<vscode.Range> {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const keyPattern = new RegExp(`"${key}"\\s*:`);

    const lineIndex = lines.findIndex((line) => keyPattern.test(line));
    if (lineIndex !== -1) {
      const match = lines[lineIndex]?.match(keyPattern);
      if (match?.index !== undefined) {
        return new vscode.Range(lineIndex, match.index, lineIndex, match.index + key.length + 2);
      }
    }
  } catch {
    // File read error
  }

  return new vscode.Range(0, 0, 0, 0);
}

export class ConflictCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    _document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    return context.diagnostics
      .filter((d) => d.source === "layered-settings")
      .flatMap((diagnostic) => {
        const data = (diagnostic as { data?: ConflictData }).data;
        if (!data) return [];

        return data.allFiles.map((file) => {
          const action = new vscode.CodeAction(
            `Keep "${data.key}" in ${file}`,
            vscode.CodeActionKind.QuickFix
          );
          action.command = {
            command: "layered-settings.resolveConflict",
            title: `Resolve conflict for ${data.key}`,
            arguments: [data.key, file, data.allFiles],
          };
          action.diagnostics = [diagnostic];
          action.isPreferred = file === data.allFiles[0];
          return action;
        });
      });
  }
}
