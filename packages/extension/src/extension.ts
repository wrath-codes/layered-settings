import * as vscode from "vscode";
import {
  ConflictCodeActionProvider,
  initDiagnostics,
} from "./core/conflict-manager";
import { SettingsProvider } from "./providers/settings-provider";
import { initLogger } from "./utils/logger";

const settingsProviders = new Map<string, SettingsProvider>();
let statusBarItem: vscode.StatusBarItem;
let activeProvider: SettingsProvider | null = null;
let outputChannel: vscode.OutputChannel;
let diagnosticCollection: vscode.DiagnosticCollection;

function folderKey(folder: vscode.WorkspaceFolder): string {
  return folder.uri.toString();
}

function updateStatusBarForProvider(provider: SettingsProvider): void {
  const name = provider.getFolderName();
  const count = provider.getSettingsCount();
  const kind = provider.getStatusKind();

  switch (kind) {
    case "refreshing":
      statusBarItem.text = `$(sync~spin) ${name}: refreshing...`;
      break;
    case "no-config":
      statusBarItem.text = `$(info) ${name}: no config`;
      break;
    case "ok":
      statusBarItem.text = `$(gear) ${name}: ${count} settings`;
      break;
  }
  statusBarItem.show();
}

function handleProviderStatusChange(provider: SettingsProvider): void {
  if (provider === activeProvider) {
    updateStatusBarForProvider(provider);
  }
}

function createProviderForFolder(
  folder: vscode.WorkspaceFolder,
  context: vscode.ExtensionContext
): void {
  const key = folderKey(folder);
  if (settingsProviders.has(key)) return;

  outputChannel.appendLine(`Creating provider for: ${folder.uri.fsPath}`);

  const provider = new SettingsProvider(
    folder,
    handleProviderStatusChange,
    context.storageUri
  );
  settingsProviders.set(key, provider);

  provider.initialize().catch((err) => {
    outputChannel.appendLine(`Error initializing ${folder.name}: ${err}`);
  });

  context.subscriptions.push({
    dispose: () => provider.dispose(),
  });
}

function getProviderForUri(uri?: vscode.Uri): SettingsProvider | undefined {
  if (!uri) {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 1) {
      return settingsProviders.get(folderKey(folders[0]));
    }
    return undefined;
  }

  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return undefined;
  return settingsProviders.get(folderKey(folder));
}

async function getProviderWithPrompt(): Promise<SettingsProvider | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];

  if (folders.length === 0) return undefined;
  if (folders.length === 1) return settingsProviders.get(folderKey(folders[0]));

  const uri = vscode.window.activeTextEditor?.document.uri;
  if (uri) {
    const provider = getProviderForUri(uri);
    if (provider) return provider;
  }

  const items = folders.map((f) => ({
    label: f.name,
    description: f.uri.fsPath,
    folder: f,
  }));

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "Select workspace folder for Layered Settings",
  });

  return pick ? settingsProviders.get(folderKey(pick.folder)) : undefined;
}

function isRootConfigFile(uri: vscode.Uri): boolean {
  const fsPath = uri.fsPath.replace(/\\/g, "/");

  if (!fsPath.includes(".vscode/layered-settings/")) {
    return false;
  }

  const folder = vscode.workspace.getWorkspaceFolder(uri);
  return !folder;
}

function updateStatusBarForRoot(): void {
  let totalSettings = 0;
  let workspaceCount = 0;

  for (const provider of settingsProviders.values()) {
    const count = provider.getSettingsCount();
    if (count > 0) {
      totalSettings += count;
      workspaceCount++;
    }
  }

  if (workspaceCount === 0) {
    statusBarItem.text = "$(gear) Root: no workspaces";
  } else {
    statusBarItem.text = `$(gear) Root → ${workspaceCount} workspaces (${totalSettings} applied)`;
  }

  statusBarItem.show();
}

function updateStatusBarForActiveEditor(): void {
  const uri = vscode.window.activeTextEditor?.document.uri;

  if (uri && isRootConfigFile(uri)) {
    updateStatusBarForRoot();
    return;
  }

  const provider = getProviderForUri(uri);

  if (provider) {
    activeProvider = provider;
    updateStatusBarForProvider(provider);
  } else if (settingsProviders.size > 0) {
    activeProvider = settingsProviders.values().next().value ?? null;
    if (activeProvider) {
      updateStatusBarForProvider(activeProvider);
    } else {
      statusBarItem.hide();
    }
  } else {
    activeProvider = null;
    statusBarItem.hide();
  }
}

function registerEventHandlers(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      for (const folder of event.added) {
        outputChannel.appendLine(`Folder added: ${folder.uri.fsPath}`);
        createProviderForFolder(folder, context);
      }

      for (const folder of event.removed) {
        const key = folderKey(folder);
        const provider = settingsProviders.get(key);
        if (provider) {
          if (provider === activeProvider) {
            activeProvider = null;
          }
          provider.dispose();
          settingsProviders.delete(key);
          outputChannel.appendLine(`Folder removed: ${folder.uri.fsPath}`);
        }
      }

      updateStatusBarForActiveEditor();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      updateStatusBarForActiveEditor();
    })
  );
}

function registerCommands(context: vscode.ExtensionContext): void {
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    { pattern: "**/.vscode/layered-settings/**/*.json" },
    new ConflictCodeActionProvider(),
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  );
  context.subscriptions.push(codeActionProvider);

  const resolveCommand = vscode.commands.registerCommand(
    "layered-settings.resolveConflict",
    async (key: string, chosenFile: string, allFiles: string[]) => {
      const provider = activeProvider ?? (await getProviderWithPrompt());
      if (provider) {
        await provider.resolveConflictAction(key, chosenFile, allFiles);
      }
    }
  );
  context.subscriptions.push(resolveCommand);

  const refreshCommand = vscode.commands.registerCommand(
    "layered-settings.refresh",
    async () => {
      const provider = await getProviderWithPrompt();
      if (!provider) {
        vscode.window.showWarningMessage("No workspace folder found");
        return;
      }

      statusBarItem.text = `$(sync~spin) ${provider.getFolderName()}: refreshing...`;
      await provider.refresh();
      vscode.window.showInformationMessage(
        `Layered Settings refreshed for ${provider.getFolderName()}`
      );
    }
  );
  context.subscriptions.push(refreshCommand);

  const showStatusCommand = vscode.commands.registerCommand(
    "layered-settings.showStatus",
    async () => {
      const provider = await getProviderWithPrompt();
      if (!provider) {
        vscode.window.showInformationMessage("No workspace folder found");
        return;
      }

      vscode.window.showInformationMessage(
        `Layered Settings [${provider.getFolderName()}]: ${provider.getSettingsCount()} settings applied`
      );
    }
  );
  context.subscriptions.push(showStatusCommand);

  const openConfigCommand = vscode.commands.registerCommand(
    "layered-settings.openConfig",
    async () => {
      const provider = await getProviderWithPrompt();
      if (!provider) {
        vscode.window.showWarningMessage("No workspace folder found");
        return;
      }

      const folderUri = provider.getFolderUri();
      const baseDir = vscode.Uri.joinPath(
        folderUri,
        ".vscode",
        "layered-settings"
      );
      const settingsDir = vscode.Uri.joinPath(baseDir, "settings");
      const configPath = vscode.Uri.joinPath(settingsDir, "config.json");

      try {
        const doc = await vscode.workspace.openTextDocument(configPath);
        await vscode.window.showTextDocument(doc);
      } catch {
        const create = await vscode.window.showInformationMessage(
          `Layered settings config not found for ${provider.getFolderName()}. Create it?`,
          "Yes",
          "No"
        );

        if (create === "Yes") {
          await vscode.workspace.fs.createDirectory(baseDir);
          await vscode.workspace.fs.createDirectory(settingsDir);
          await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(baseDir, "keybindings")
          );
          await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(baseDir, "mcp")
          );

          const template = {
            root: true,
            extends: [],
            settings: {},
          };

          await vscode.workspace.fs.writeFile(
            configPath,
            Buffer.from(JSON.stringify(template, null, 2))
          );

          const doc = await vscode.workspace.openTextDocument(configPath);
          await vscode.window.showTextDocument(doc);
        }
      }
    }
  );
  context.subscriptions.push(openConfigCommand);
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("Layered Settings");
  context.subscriptions.push(outputChannel);
  initLogger(outputChannel);

  diagnosticCollection =
    vscode.languages.createDiagnosticCollection("layered-settings");
  context.subscriptions.push(diagnosticCollection);
  initDiagnostics(diagnosticCollection);

  outputChannel.appendLine("Layered Settings: Activating...");

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "layered-settings.refresh";
  statusBarItem.tooltip = "Click to refresh layered settings";
  context.subscriptions.push(statusBarItem);

  const { workspaceFolders } = vscode.workspace;

  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      createProviderForFolder(folder, context);
    }
  }

  registerCommands(context);
  registerEventHandlers(context);

  updateStatusBarForActiveEditor();
}

export function deactivate(): void {
  for (const provider of settingsProviders.values()) {
    provider.dispose();
  }
  settingsProviders.clear();
  activeProvider = null;
}
