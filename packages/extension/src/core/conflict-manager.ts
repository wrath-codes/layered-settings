import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ConflictData, ProvenanceMap } from "./types";
import { log } from "../utils/logger";

let diagnosticCollection: vscode.DiagnosticCollection | null = null;

export function initDiagnostics(collection: vscode.DiagnosticCollection): void {
  diagnosticCollection = collection;
}

export async function createConflictDiagnostics(
  conflicts: string[],
  provenance: ProvenanceMap,
  configDir: string
): Promise<void> {
  diagnosticCollection?.clear();

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

    for (const fileName of allFiles) {
      const filePath = path.join(configDir, fileName);
      const position = await findKeyPosition(filePath, key);

      const diagnostic = new vscode.Diagnostic(
        position,
        `"${key}" is also defined in: ${allFiles.filter((f) => f !== fileName).join(", ")}`,
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

  for (const [filePath, diagnostics] of diagnosticsByFile) {
    diagnosticCollection?.set(vscode.Uri.file(filePath), diagnostics);
  }
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
