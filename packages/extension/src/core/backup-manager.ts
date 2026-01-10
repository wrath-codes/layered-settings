import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { LayeredConfig } from "./types";

const MAX_BACKUPS = 5;
const RESERVED_NAME = "layered.json";
const GITIGNORE_ENTRY = ".vscode/layered-settings/settings/layered.json";

export class BackupManager {
  constructor(private readonly storageUri: vscode.Uri) {}

  async backupLayeredJson(configDir: string): Promise<void> {
    const sourcePath = path.join(configDir, RESERVED_NAME);

    if (!fs.existsSync(sourcePath)) {
      return;
    }

    const backupDir = path.join(this.storageUri.fsPath, "backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = Date.now();
    const backupName = `layered-${timestamp}.json`;
    const backupPath = path.join(backupDir, backupName);

    fs.copyFileSync(sourcePath, backupPath);

    await this.cleanupOldBackups(backupDir);
  }

  private async cleanupOldBackups(backupDir: string): Promise<void> {
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith("layered-") && f.endsWith(".json"))
      .map((f) => ({
        name: f,
        time: Number.parseInt(
          f.replace("layered-", "").replace(".json", ""),
          10
        ),
      }))
      .sort((a, b) => b.time - a.time);

    files.slice(MAX_BACKUPS).forEach((file) => {
      fs.unlinkSync(path.join(backupDir, file.name));
    });
  }

  detectLayeredJsonDeletion(
    configDir: string,
    previousSettings: Record<string, unknown>
  ): boolean {
    const filePath = path.join(configDir, RESERVED_NAME);
    const previouslyHadSettings = Object.keys(previousSettings).length > 0;
    return previouslyHadSettings && !fs.existsSync(filePath);
  }

  warnLayeredJsonDeleted(): void {
    vscode.window.showWarningMessage(
      "layered.json was deleted. Some captured settings may have been lost. " +
        "Check extension storage for backups."
    );
  }

  async ensureGitignore(workspaceFolder: string): Promise<void> {
    const config = vscode.workspace.getConfiguration("layered-settings");
    const autoGitignore = config.get<boolean>("autoGitignore", true);

    if (!autoGitignore) {
      return;
    }

    const gitignorePath = path.join(workspaceFolder, ".gitignore");
    let content = "";

    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, "utf8");

      if (content.includes(GITIGNORE_ENTRY)) {
        return;
      }
    }

    const separator = content.endsWith("\n") || content === "" ? "" : "\n";
    const newContent = `${content}${separator}${GITIGNORE_ENTRY}\n`;

    fs.writeFileSync(gitignorePath, newContent);
  }

  getLayeredJsonSettings(configDir: string): Record<string, unknown> {
    const filePath = path.join(configDir, RESERVED_NAME);

    if (!fs.existsSync(filePath)) {
      return {};
    }

    try {
      const content = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(content) as LayeredConfig;
      return parsed.settings ?? {};
    } catch {
      return {};
    }
  }
}
